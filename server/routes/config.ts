import { Router } from 'express';
import { DEFAULT_SETTINGS, FACILITIES, ROLES, type HotelSettings } from '../../shared/constants.ts';
import { allow, createSession, currentUser, hashPassword, passwordProblem, rateLimit } from '../auth.ts';
import { all, audit, get, run, tx } from '../db.ts';
import { EMAIL_RE, HttpError, PHONE_RE, bad, body, h, int, oneOf, str } from '../lib.ts';
import { checkSetupCode, getSettings, needsSetup, saveSettings } from '../settings.ts';
import { paystackEnabled } from '../paystack.ts';
import { publicImages } from './website.ts';

/** First-run setup, hotel settings, room types, rooms and the facility price list. */
export const config = Router();
const manager = allow('manager');

// ---------- first-run: create the owner's account ----------

config.get(
  '/setup/status',
  h((_req, res) => {
    res.json({ needs_setup: needsSetup() });
  }),
);

config.post(
  '/setup/owner',
  h((req, res) => {
    rateLimit(`setup:${req.ip}`, 10, 60 * 60_000);
    if (!needsSetup()) throw new HttpError(409, 'This hotel is already set up. Sign in instead.');
    const b = body(req);
    if (typeof b.code !== 'string' || !checkSetupCode(b.code)) throw new HttpError(403, 'That setup code is not right. It is in the server log or the DANEST_SETUP_CODE setting.');
    const name = str(b, 'name', { max: 80, min: 3 });
    const username = str(b, 'username', { max: 32, min: 3, pattern: /^[a-z0-9._-]+$/i }).toLowerCase();
    const password = typeof b.password === 'string' ? b.password : '';
    const problem = passwordProblem(password);
    if (problem) throw bad(problem);
    const id = tx(() => {
      if (!needsSetup()) throw new HttpError(409, 'This hotel is already set up.');
      // The person setting the hotel up is its owner: everything a manager can do, plus the executive view.
      const { id } = run("INSERT INTO users (name, username, role, password_hash) VALUES (?,?, 'ceo', ?)", name, username, hashPassword(password));
      audit(id, 'setup_owner', 'user', id);
      return id;
    });
    createSession(req, res, id);
    res.status(201).json({ id, name, username, role: 'ceo', mfa: false });
  }),
);

// ---------- hotel profile ----------

/** Public: what the website and invoices show. Only what the owner has filled in. */
config.get(
  '/public/hotel',
  h((_req, res) => {
    const s = getSettings();
    const items = all('SELECT id, facility, name, price FROM facility_items WHERE active = 1 ORDER BY facility, price');
    const rooms = get<{ n: number }>('SELECT COUNT(*) n FROM rooms r JOIN room_types t ON t.id = r.room_type_id WHERE r.active = 1 AND t.active = 1')!.n;
    const img = publicImages();
    res.json({
      ...s, bank_details: undefined, facility_items: items, bookable: rooms > 0, online_payments: paystackEnabled() && s.deposit_percent > 0,
      images: { hero: img.hero, gallery: img.gallery, facilities: img.facilities },
    });
  }),
);

config.get(
  '/settings',
  allow(...ROLES),
  h((_req, res) => {
    res.json(getSettings());
  }),
);

config.put(
  '/settings',
  manager,
  h((req, res) => {
    const b = body(req);
    const opt = (k: string, max = 200) => str(b, k, { max, optional: true });
    const time = (k: string) => {
      const v = str(b, k, { max: 5, pattern: /^([01]\d|2[0-3]):[0-5]\d$/ });
      return v;
    };
    const highlights = Array.isArray(b.highlights) ? b.highlights : [];
    if (highlights.length > 6) throw bad('Up to 6 highlights');
    const reviews = Array.isArray(b.reviews) ? b.reviews : [];
    if (reviews.length > 9) throw bad('Up to 9 reviews');
    const next: HotelSettings = {
      name: str(b, 'name', { max: 80 }),
      tagline: opt('tagline', 120),
      address: str(b, 'address', { max: 200 }),
      phone: str(b, 'phone', { max: 20, optional: true, pattern: PHONE_RE }),
      whatsapp: str(b, 'whatsapp', { max: 20, optional: true, pattern: PHONE_RE }),
      email: str(b, 'email', { max: 254, optional: true, pattern: EMAIL_RE }),
      check_in_time: time('check_in_time'),
      check_out_time: time('check_out_time'),
      bank_details: opt('bank_details', 300),
      invoice_note: opt('invoice_note', 300),
      deposit_percent: b.deposit_percent === undefined || b.deposit_percent === '' ? 0 : int(b, 'deposit_percent', { min: 0, max: 100 }),
      highlights: highlights.map((x: unknown) => {
        const o = (x ?? {}) as Record<string, unknown>;
        return { title: str(o, 'title', { max: 40 }), text: str(o, 'text', { max: 90, optional: true }) };
      }),
      reviews: reviews.map((x: unknown) => {
        const o = (x ?? {}) as Record<string, unknown>;
        return { quote: str(o, 'quote', { min: 10, max: 400 }), name: str(o, 'name', { max: 60 }), detail: str(o, 'detail', { max: 60, optional: true }) };
      }),
    };
    saveSettings(next);
    audit(currentUser(req).id, 'update', 'settings', null);
    res.json(next);
  }),
);

// ---------- room types ----------

function typeFields(b: Record<string, unknown>) {
  const amenities = Array.isArray(b.amenities) ? b.amenities : [];
  if (amenities.length > 12) throw bad('Up to 12 amenities');
  return {
    name: str(b, 'name', { max: 60 }),
    rate: int(b, 'rate', { min: 1000, max: 5_000_000 }),
    capacity: int(b, 'capacity', { min: 1, max: 12 }),
    description: str(b, 'description', { max: 300, optional: true }),
    amenities: amenities.map((a: unknown, i: number) => str({ a }, 'a', { max: 40 }) || `Amenity ${i + 1}`),
  };
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'room';

config.get(
  '/settings/room-types',
  manager,
  h((_req, res) => {
    res.json(
      all<{ amenities: string }>(
        `SELECT t.*, (SELECT COUNT(*) FROM rooms r WHERE r.room_type_id = t.id AND r.active = 1) AS rooms
           FROM room_types t ORDER BY t.active DESC, t.rate`,
      ).map((t) => ({ ...t, amenities: JSON.parse(t.amenities) })),
    );
  }),
);

config.post(
  '/settings/room-types',
  manager,
  h((req, res) => {
    const f = typeFields(body(req));
    let slug = slugify(f.name);
    while (get('SELECT 1 FROM room_types WHERE slug = ?', slug)) slug = `${slug}-${Math.floor(Math.random() * 90 + 10)}`;
    const { id } = run(
      'INSERT INTO room_types (name, slug, rate, capacity, description, amenities) VALUES (?,?,?,?,?,?)',
      f.name, slug, f.rate, f.capacity, f.description, JSON.stringify(f.amenities),
    );
    audit(currentUser(req).id, 'create', 'room_type', id, { name: f.name, rate: f.rate });
    res.status(201).json({ id });
  }),
);

config.put(
  '/settings/room-types/:id',
  manager,
  h((req, res) => {
    const id = Number(req.params.id);
    const before = get<{ rate: number; name: string }>('SELECT rate, name FROM room_types WHERE id = ?', id);
    if (!before) throw new HttpError(404, 'Room type not found');
    const b = body(req);
    const f = typeFields(b);
    run(
      'UPDATE room_types SET name=?, rate=?, capacity=?, description=?, amenities=?, active=? WHERE id=?',
      f.name, f.rate, f.capacity, f.description, JSON.stringify(f.amenities), b.active === false ? 0 : 1, id,
    );
    // Existing bookings keep the rate they were sold at; only new bookings use the new rate.
    audit(currentUser(req).id, before.rate !== f.rate ? 'rate_change' : 'update', 'room_type', id, { name: f.name, from: before.rate, to: f.rate });
    res.json({ ok: true });
  }),
);

// ---------- rooms ----------

config.get(
  '/settings/rooms',
  manager,
  h((_req, res) => {
    res.json(
      all(
        `SELECT r.id, r.number, r.floor, r.status, r.active, r.room_type_id, t.name AS room_type,
                (SELECT COUNT(*) FROM reservations x WHERE x.room_id = r.id) AS bookings
           FROM rooms r JOIN room_types t ON t.id = r.room_type_id ORDER BY r.active DESC, r.number`,
      ),
    );
  }),
);

/** Accepts "101-108, 110, 201" so a whole floor can be added at once. */
function parseNumbers(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d{1,4})-(\d{1,4})$/);
    if (m) {
      const [a, z] = [Number(m[1]), Number(m[2])];
      if (z < a || z - a > 60) throw bad(`Range ${part} is not valid`);
      for (let n = a; n <= z; n++) out.push(String(n).padStart(m[1].length, '0'));
    } else if (/^[A-Za-z0-9-]{1,8}$/.test(part)) out.push(part.toUpperCase());
    else throw bad(`"${part}" is not a room number`);
  }
  if (!out.length) throw bad('Enter at least one room number');
  if (out.length > 120) throw bad('Too many rooms at once');
  return [...new Set(out)];
}

config.post(
  '/settings/rooms',
  manager,
  h((req, res) => {
    const b = body(req);
    const typeId = int(b, 'room_type_id', { min: 1 });
    if (!get('SELECT 1 FROM room_types WHERE id = ?', typeId)) throw bad('Choose a room type');
    const numbers = parseNumbers(str(b, 'numbers', { max: 400 }));
    const floorOverride = b.floor === undefined || b.floor === '' ? null : int(b, 'floor', { min: 0, max: 50 });
    const created = tx(() =>
      numbers.map((n) => {
        if (get('SELECT 1 FROM rooms WHERE number = ?', n)) throw new HttpError(409, `Room ${n} already exists`);
        const floor = floorOverride ?? (n.length >= 3 && /^\d+$/.test(n) ? Number(n.slice(0, n.length - 2)) : 0);
        return run('INSERT INTO rooms (number, room_type_id, floor) VALUES (?,?,?)', n, typeId, floor).id;
      }),
    );
    audit(currentUser(req).id, 'create', 'room', null, { numbers });
    res.status(201).json({ created: created.length });
  }),
);

config.put(
  '/settings/rooms/:id',
  manager,
  h((req, res) => {
    const id = Number(req.params.id);
    const b = body(req);
    const room = get<{ id: number; room_type_id: number }>('SELECT id, room_type_id FROM rooms WHERE id = ?', id);
    if (!room) throw new HttpError(404, 'Room not found');
    const typeId = int(b, 'room_type_id', { min: 1 });
    if (!get('SELECT 1 FROM room_types WHERE id = ?', typeId)) throw bad('Choose a room type');
    const floor = int(b, 'floor', { min: 0, max: 50 });
    const active = b.active === false ? 0 : 1;
    // Guests booked into this room were sold its current type, so the room keeps it until they are moved.
    const booked = get("SELECT 1 FROM reservations WHERE room_id = ? AND status IN ('confirmed','checked_in')", id);
    if (booked && !active) throw new HttpError(409, 'This room has a guest or an upcoming booking. Move them first.');
    if (booked && typeId !== room.room_type_id) throw new HttpError(409, 'This room has a guest or an upcoming booking of its current type. Move them first.');
    run('UPDATE rooms SET room_type_id = ?, floor = ?, active = ? WHERE id = ?', typeId, floor, active, id);
    audit(currentUser(req).id, 'update', 'room', id, { room_type_id: typeId, active });
    res.json({ ok: true });
  }),
);

config.delete(
  '/settings/rooms/:id',
  manager,
  h((req, res) => {
    const id = Number(req.params.id);
    if (get('SELECT 1 FROM reservations WHERE room_id = ?', id)) throw new HttpError(409, 'This room has booking history. Switch it off instead of deleting it.');
    if (!run('DELETE FROM rooms WHERE id = ?', id).changes) throw new HttpError(404, 'Room not found');
    audit(currentUser(req).id, 'delete', 'room', id);
    res.json({ ok: true });
  }),
);

// ---------- facility price list (gym, pool, lounge) ----------

config.get(
  '/settings/facility-items',
  allow('manager', 'frontdesk'),
  h((req, res) => {
    res.json(all(`SELECT id, facility, name, price, active FROM facility_items ${req.query.all === '1' ? '' : 'WHERE active = 1'} ORDER BY facility, price`));
  }),
);

config.post(
  '/settings/facility-items',
  manager,
  h((req, res) => {
    const b = body(req);
    const { id } = run(
      'INSERT INTO facility_items (facility, name, price) VALUES (?,?,?)',
      oneOf(b, 'facility', FACILITIES), str(b, 'name', { max: 80 }), int(b, 'price', { min: 0, max: 50_000_000 }),
    );
    audit(currentUser(req).id, 'create', 'facility_item', id);
    res.status(201).json({ id });
  }),
);

config.put(
  '/settings/facility-items/:id',
  manager,
  h((req, res) => {
    const b = body(req);
    const id = Number(req.params.id);
    const n = run(
      'UPDATE facility_items SET facility = ?, name = ?, price = ?, active = ? WHERE id = ?',
      oneOf(b, 'facility', FACILITIES), str(b, 'name', { max: 80 }), int(b, 'price', { min: 0, max: 50_000_000 }), b.active === false ? 0 : 1, id,
    ).changes;
    if (!n) throw new HttpError(404, 'Item not found');
    audit(currentUser(req).id, 'update', 'facility_item', id);
    res.json({ ok: true });
  }),
);

/** How far the owner has got with setting the hotel up, for the onboarding checklist. */
config.get(
  '/setup/checklist',
  manager,
  h((_req, res) => {
    const s = getSettings();
    const count = (sql: string) => get<{ n: number }>(sql)!.n;
    res.json({
      profile: !!(s.phone && s.address && s.name !== '' && JSON.stringify(s) !== JSON.stringify(DEFAULT_SETTINGS)),
      room_types: count('SELECT COUNT(*) n FROM room_types WHERE active = 1') > 0,
      rooms: count('SELECT COUNT(*) n FROM rooms WHERE active = 1') > 0,
      products: count('SELECT COUNT(*) n FROM products WHERE active = 1') > 0,
      facility_items: count('SELECT COUNT(*) n FROM facility_items WHERE active = 1') > 0,
      team: count("SELECT COUNT(*) n FROM users WHERE active = 1 AND role NOT IN ('ceo','manager')") > 0,
      // Everyone who can see the money signs in with two steps.
      mfa: count("SELECT COUNT(*) n FROM users WHERE role IN ('ceo','manager','accountant','auditor') AND active = 1 AND totp_enabled = 0") === 0,
    });
  }),
);
