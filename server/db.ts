import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = process.env.DANEST_DB ?? resolve(import.meta.dirname, '../data/danest.db');

if (DB_PATH !== ':memory:') mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// All money is stored as whole naira (integers). Dates are 'YYYY-MM-DD' in Lagos time.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager','frontdesk','bar')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,               -- sha256 of the cookie token, never the token itself
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS room_types (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  rate INTEGER NOT NULL CHECK (rate >= 0),
  capacity INTEGER NOT NULL,
  description TEXT NOT NULL,
  amenities TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  room_type_id INTEGER NOT NULL REFERENCES room_types(id),
  floor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','occupied','cleaning','maintenance'))
);

CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  guest_id INTEGER NOT NULL REFERENCES guests(id),
  room_type_id INTEGER NOT NULL REFERENCES room_types(id),
  room_id INTEGER REFERENCES rooms(id),
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  nights INTEGER NOT NULL CHECK (nights > 0),
  rate INTEGER NOT NULL,
  total INTEGER NOT NULL,
  adults INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','checked_in','checked_out','cancelled')),
  source TEXT NOT NULL CHECK (source IN ('walk_in','phone','website')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (check_out > check_in)
);
CREATE INDEX IF NOT EXISTS idx_res_dates ON reservations(check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_res_room ON reservations(room_id, status);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','transfer','pos')),
  date TEXT NOT NULL,
  received_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('drinks','confectionery')),
  unit TEXT NOT NULL DEFAULT 'bottle',
  price INTEGER NOT NULL CHECK (price >= 0),
  avg_cost INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 12,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash','transfer','pos')),
  total INTEGER NOT NULL,
  cost_total INTEGER NOT NULL,
  staff_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS facility_income (
  id INTEGER PRIMARY KEY,
  facility TEXT NOT NULL CHECK (facility IN ('gym','pool','lounge')),
  item TEXT NOT NULL,
  customer TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','transfer','pos')),
  date TEXT NOT NULL,
  recorded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fac_date ON facility_income(date);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  supplier TEXT NOT NULL,
  date TEXT NOT NULL,
  total INTEGER NOT NULL,
  notes TEXT,
  recorded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0)
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  paid_to TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','transfer','pos')),
  recorded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
`;

db.exec(SCHEMA);

/**
 * Forward-only migrations, tracked with PRAGMA user_version. Never edit a shipped
 * migration — append a new one. Each runs in its own transaction.
 */
const MIGRATIONS: string[] = [
  // 1 — folios, guest profiles, two-factor sign-in, session metadata
  `
  ALTER TABLE guests ADD COLUMN vip INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE guests ADD COLUMN notes TEXT;
  ALTER TABLE guests ADD COLUMN id_type TEXT;
  ALTER TABLE guests ADD COLUMN id_number TEXT;
  ALTER TABLE guests ADD COLUMN address TEXT;
  CREATE INDEX IF NOT EXISTS idx_guests_phone ON guests(phone);

  ALTER TABLE reservations ADD COLUMN checked_in_at TEXT;
  ALTER TABLE reservations ADD COLUMN checked_out_at TEXT;

  CREATE TABLE sales_v2 (
    id INTEGER PRIMARY KEY,
    receipt_no TEXT NOT NULL UNIQUE,
    date TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('cash','transfer','pos','room')),
    reservation_id INTEGER REFERENCES reservations(id),
    total INTEGER NOT NULL,
    cost_total INTEGER NOT NULL,
    staff_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((method = 'room') = (reservation_id IS NOT NULL))
  );
  INSERT INTO sales_v2 (id, receipt_no, date, method, total, cost_total, staff_id, created_at)
    SELECT id, receipt_no, date, method, total, cost_total, staff_id, created_at FROM sales;
  DROP TABLE sales;
  ALTER TABLE sales_v2 RENAME TO sales;
  CREATE INDEX idx_sales_date ON sales(date);
  CREATE INDEX idx_sales_res ON sales(reservation_id);

  CREATE TABLE facility_income_v2 (
    id INTEGER PRIMARY KEY,
    facility TEXT NOT NULL CHECK (facility IN ('gym','pool','lounge')),
    item TEXT NOT NULL,
    customer TEXT,
    amount INTEGER NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL CHECK (method IN ('cash','transfer','pos','room')),
    reservation_id INTEGER REFERENCES reservations(id),
    date TEXT NOT NULL,
    recorded_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((method = 'room') = (reservation_id IS NOT NULL))
  );
  INSERT INTO facility_income_v2 (id, facility, item, customer, amount, method, date, recorded_by, created_at)
    SELECT id, facility, item, customer, amount, method, date, recorded_by, created_at FROM facility_income;
  DROP TABLE facility_income;
  ALTER TABLE facility_income_v2 RENAME TO facility_income;
  CREATE INDEX idx_fac_date ON facility_income(date);
  CREATE INDEX idx_fac_res ON facility_income(reservation_id);

  ALTER TABLE users ADD COLUMN totp_secret TEXT;
  ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN last_login_at TEXT;

  CREATE TABLE recovery_codes (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TEXT
  );
  CREATE TABLE mfa_challenges (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
  );

  ALTER TABLE sessions ADD COLUMN user_agent TEXT;
  ALTER TABLE sessions ADD COLUMN ip TEXT;
  ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
  `,
];

{
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    // Table rebuilds must not cascade deletes into child tables, so FKs are off for the duration.
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[v]);
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length) throw new Error(`Migration ${v + 1} broke ${broken.length} foreign keys`);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

/** Run fn inside a transaction; rolls back on any throw. Not re-entrant. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

type Value = string | number | bigint | null | Uint8Array;
/** Positional values, or a single object of :named values. */
type Param = Value | Record<string, Value>;

export function all<T = Record<string, unknown>>(sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined;
}

export function run(sql: string, ...params: Param[]) {
  const r = db.prepare(sql).run(...(params as never[]));
  return { id: Number(r.lastInsertRowid), changes: Number(r.changes) };
}

export function audit(userId: number | null, action: string, entity: string, entityId: number | null, detail?: unknown) {
  run(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?,?,?,?,?)',
    userId,
    action,
    entity,
    entityId,
    detail === undefined ? null : JSON.stringify(detail),
  );
}
