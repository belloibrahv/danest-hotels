import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const DB_PATH = process.env.DANEST_DB ?? resolve(import.meta.dirname, '../data/danest.db');

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

  // 2 — real-hotel configuration, housekeeping, maintenance, closing the day
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  ALTER TABLE room_types ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE rooms ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE rooms ADD COLUMN assigned_to INTEGER REFERENCES users(id);

  CREATE TABLE facility_items (
    id INTEGER PRIMARY KEY,
    facility TEXT NOT NULL CHECK (facility IN ('gym','pool','lounge')),
    name TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0),
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE users_v2 (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('manager','frontdesk','bar','housekeeping')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    totp_last_step INTEGER NOT NULL DEFAULT 0,
    last_login_at TEXT
  );
  INSERT INTO users_v2 (id, name, username, password_hash, role, active, created_at, totp_secret, totp_enabled, totp_last_step, last_login_at)
    SELECT id, name, username, password_hash, role, active, created_at, totp_secret, totp_enabled, totp_last_step, last_login_at FROM users;
  DROP TABLE users;
  ALTER TABLE users_v2 RENAME TO users;

  CREATE TABLE housekeeping_log (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id),
    action TEXT NOT NULL CHECK (action IN ('dirty','assigned','cleaned','out_of_order','back_in_service')),
    user_id INTEGER REFERENCES users(id),
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_hk_room ON housekeeping_log(room_id, id);

  CREATE TABLE maintenance_tickets (
    id INTEGER PRIMARY KEY,
    room_id INTEGER REFERENCES rooms(id),
    area TEXT,
    title TEXT NOT NULL,
    details TEXT,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','urgent')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
    blocks_room INTEGER NOT NULL DEFAULT 0,
    reported_by INTEGER REFERENCES users(id),
    resolved_by INTEGER REFERENCES users(id),
    resolution TEXT,
    cost INTEGER,
    expense_id INTEGER REFERENCES expenses(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  );
  CREATE INDEX idx_mt_status ON maintenance_tickets(status);

  CREATE TABLE day_closures (
    date TEXT PRIMARY KEY,
    closed_by INTEGER NOT NULL REFERENCES users(id),
    closed_at TEXT NOT NULL DEFAULT (datetime('now')),
    expected_cash INTEGER NOT NULL,
    counted_cash INTEGER NOT NULL,
    expected_transfer INTEGER NOT NULL,
    expected_pos INTEGER NOT NULL,
    variance INTEGER NOT NULL,
    notes TEXT,
    summary TEXT NOT NULL
  );
  `,

  // 3 — nightly pricing & rate rules, corporate accounts (city ledger), online payments, guest messages
  `
  CREATE TABLE reservation_nights (
    reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    rate INTEGER NOT NULL CHECK (rate >= 0),
    PRIMARY KEY (reservation_id, date)
  );
  CREATE INDEX idx_rn_date ON reservation_nights(date);
  INSERT INTO reservation_nights (reservation_id, date, rate)
    WITH RECURSIVE n(id, d, out, rate) AS (
      SELECT id, check_in, check_out, rate FROM reservations
      UNION ALL SELECT id, date(d, '+1 day'), out, rate FROM n WHERE date(d, '+1 day') < out
    )
    SELECT id, d, rate FROM n;

  CREATE TABLE rate_rules (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    room_type_id INTEGER REFERENCES room_types(id),
    start_date TEXT,
    end_date TEXT,
    weekdays TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('percent','amount','fixed')),
    value INTEGER NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE companies (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    contact_name TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    discount_pct INTEGER NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 90),
    credit_limit INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ALTER TABLE reservations ADD COLUMN company_id INTEGER REFERENCES companies(id);
  ALTER TABLE reservations ADD COLUMN bill_to_company INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE reservations ADD COLUMN rate_note TEXT;

  CREATE TABLE payments_v2 (
    id INTEGER PRIMARY KEY,
    reservation_id INTEGER NOT NULL REFERENCES reservations(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL CHECK (method IN ('cash','transfer','pos','online','company')),
    reference TEXT UNIQUE,
    date TEXT NOT NULL,
    received_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO payments_v2 (id, reservation_id, amount, method, date, received_by, created_at)
    SELECT id, reservation_id, amount, method, date, received_by, created_at FROM payments;
  DROP TABLE payments;
  ALTER TABLE payments_v2 RENAME TO payments;
  CREATE INDEX idx_payments_date ON payments(date);
  CREATE INDEX idx_payments_res ON payments(reservation_id);

  CREATE TABLE company_payments (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL CHECK (method IN ('cash','transfer','pos')),
    reference TEXT,
    date TEXT NOT NULL,
    received_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_cp_date ON company_payments(date);

  CREATE TABLE online_payments (
    reference TEXT PRIMARY KEY,
    reservation_id INTEGER NOT NULL REFERENCES reservations(id),
    amount INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('initialized','success','failed')),
    gateway_response TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    verified_at TEXT
  );

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    reservation_id INTEGER REFERENCES reservations(id),
    template TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('sms','whatsapp')),
    to_phone TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('sent','failed','manual')),
    provider_ref TEXT,
    error TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_messages_res ON messages(reservation_id);
  `,

  // 4 — refunds, and deposits kept when a booking is cancelled or a guest doesn't arrive
  `
  CREATE TABLE refunds (
    id INTEGER PRIMARY KEY,
    reservation_id INTEGER NOT NULL REFERENCES reservations(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL CHECK (method IN ('cash','transfer','pos')),
    reason TEXT NOT NULL,
    date TEXT NOT NULL,
    refunded_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_refunds_date ON refunds(date);
  CREATE INDEX idx_refunds_res ON refunds(reservation_id);

  ALTER TABLE reservations ADD COLUMN cancelled_on TEXT;
  ALTER TABLE reservations ADD COLUMN retained INTEGER NOT NULL DEFAULT 0 CHECK (retained >= 0);
  `,

  // 5 — owner, accountant and auditor roles; suppliers, purchase orders and bills on credit;
  //     a product catalogue with codes and photos; monthly targets and budgets; auditor queries
  `
  CREATE TABLE users_v3 (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ceo','manager','accountant','auditor','frontdesk','bar','housekeeping')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    totp_last_step INTEGER NOT NULL DEFAULT 0,
    last_login_at TEXT
  );
  INSERT INTO users_v3 SELECT id, name, username, password_hash, role, active, created_at, totp_secret, totp_enabled, totp_last_step, last_login_at FROM users;
  DROP TABLE users;
  ALTER TABLE users_v3 RENAME TO users;

  CREATE TABLE suppliers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    contact_name TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    terms_days INTEGER NOT NULL DEFAULT 0 CHECK (terms_days BETWEEN 0 AND 180),
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO suppliers (name) SELECT MIN(supplier) FROM purchases GROUP BY supplier COLLATE NOCASE;

  -- A purchase is ordered, then received (stock and cost change only on receipt). Older purchases were received on entry.
  -- terms: how it was paid when it arrived; 'credit' leaves a supplier bill to pay. NULL = recorded before bills were tracked (paid).
  ALTER TABLE purchases ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id);
  ALTER TABLE purchases ADD COLUMN status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('ordered','received','cancelled'));
  ALTER TABLE purchases ADD COLUMN terms TEXT CHECK (terms IN ('cash','transfer','pos','credit'));
  ALTER TABLE purchases ADD COLUMN invoice_no TEXT;
  ALTER TABLE purchases ADD COLUMN due_date TEXT;
  ALTER TABLE purchases ADD COLUMN received_at TEXT;
  ALTER TABLE purchases ADD COLUMN received_by INTEGER REFERENCES users(id);
  UPDATE purchases SET supplier_id = (SELECT s.id FROM suppliers s WHERE s.name = purchases.supplier), received_at = created_at, received_by = recorded_by;
  CREATE INDEX idx_purchases_supplier ON purchases(supplier_id);

  CREATE TABLE supplier_payments (
    id INTEGER PRIMARY KEY,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL CHECK (method IN ('cash','transfer','pos')),
    reference TEXT,
    date TEXT NOT NULL,
    paid_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_sp_purchase ON supplier_payments(purchase_id);
  CREATE INDEX idx_sp_date ON supplier_payments(date);

  ALTER TABLE products ADD COLUMN sku TEXT;
  ALTER TABLE products ADD COLUMN barcode TEXT;
  ALTER TABLE products ADD COLUMN description TEXT;
  ALTER TABLE products ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id);
  ALTER TABLE products ADD COLUMN image_v INTEGER NOT NULL DEFAULT 0;
  CREATE UNIQUE INDEX idx_products_sku ON products(sku COLLATE NOCASE) WHERE sku IS NOT NULL;
  CREATE UNIQUE INDEX idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;

  CREATE TABLE product_images (
    product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    mime TEXT NOT NULL CHECK (mime IN ('image/webp','image/jpeg','image/png')),
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- key: a TARGET_KEYS entry (owner's monthly targets) or 'expense:<category>' (accountant's budget). month: 'YYYY-MM'.
  CREATE TABLE targets (
    month TEXT NOT NULL,
    key TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount >= 0),
    set_by INTEGER REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (month, key)
  );

  CREATE TABLE audit_queries (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    ref_id INTEGER,
    ref_label TEXT,
    amount INTEGER,
    question TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
    raised_by INTEGER NOT NULL REFERENCES users(id),
    raised_at TEXT NOT NULL DEFAULT (datetime('now')),
    answer TEXT,
    answered_by INTEGER REFERENCES users(id),
    answered_at TEXT,
    closed_by INTEGER REFERENCES users(id),
    closed_at TEXT
  );
  CREATE INDEX idx_aq_status ON audit_queries(status);
  CREATE INDEX idx_audit_created ON audit_log(created_at);
  `,

  // 6 — the website's own photos: main banner, gallery, each room type and each facility
  `
  CREATE TABLE site_images (
    id INTEGER PRIMARY KEY,
    slot TEXT NOT NULL,
    mime TEXT NOT NULL CHECK (mime IN ('image/webp','image/jpeg','image/png')),
    data BLOB NOT NULL,
    alt TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_site_images_slot ON site_images(slot, sort, id);
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

let auditListener: ((entity: string) => void) | null = null;
/** Called after every audited change (live updates subscribe here). */
export const onAudit = (fn: (entity: string) => void) => {
  auditListener = fn;
};

export function audit(userId: number | null, action: string, entity: string, entityId: number | null, detail?: unknown) {
  run(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?,?,?,?,?)',
    userId,
    action,
    entity,
    entityId,
    detail === undefined ? null : JSON.stringify(detail),
  );
  auditListener?.(entity);
}
