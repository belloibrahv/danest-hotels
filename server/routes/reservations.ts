import { Router } from 'express';
import {
  PAYMENT_METHODS,
  RESERVATION_SOURCES,
  RESERVATION_STATUSES,
  ROOM_STATUSES,
  type ReservationStatus,
} from '../../shared/constants.ts';
import { allow, currentUser } from '../auth.ts';
import { all, audit, get, run, tx } from '../db.ts';
import { EMAIL_RE, HttpError, PHONE_RE, bad, body, code, date, daysBetween, h, int, oneOf, str, today } from '../lib.ts';

export const reservations = Router();
const desk = allow('manager', 'frontdesk');

// ---------- availability (shared with the public booking form) ----------

/** Statuses that hold a physical room. Website requests ("pending") don't block inventory until confirmed. */
const HOLDING = `('confirmed','checked_in')`;

export function freeRooms(roomTypeId: number | null, checkIn: string, checkOut: string, excludeReservation = 0) {
  return all<{ id: number; number: string; room_type_id: number; status: string }>(
    `SELECT r.id, r.number, r.room_type_id, r.status FROM rooms r
      WHERE (? IS NULL OR r.room_type_id = ?)
        AND r.status <> 'maintenance'
        AND NOT EXISTS (
          SELECT 1 FROM reservations x
           WHERE x.room_id = r.id AND x.status IN ${HOLDING} AND x.id <> ?
             AND x.check_in < ? AND x.check_out > ?)
      ORDER BY r.number`,
    roomTypeId,
    roomTypeId,
    excludeReservation,
    checkOut,
    checkIn,
  );
}

/** Rooms of each type still sellable for the stay, net of confirmed bookings not yet given a room. */
export function availabilityByType(checkIn: string, checkOut: string): Map<number, number> {
  const free = new Map<number, number>();
  for (const r of freeRooms(null, checkIn, checkOut)) free.set(r.room_type_id, (free.get(r.room_type_id) ?? 0) + 1);
  const unassigned = all<{ room_type_id: number; n: number }>(
    `SELECT room_type_id, COUNT(*) n FROM reservations
      WHERE room_id IS NULL AND status = 'confirmed' AND check_in < ? AND check_out > ?
      GROUP BY room_type_id`,
    checkOut,
    checkIn,
  );
  for (const u of unassigned) free.set(u.room_type_id, Math.max(0, (free.get(u.room_type_id) ?? 0) - u.n));
  return free;
}

export function validateStay(checkIn: string, checkOut: string, allowPast = false) {
  const nights = daysBetween(checkIn, checkOut);
  if (nights < 1) throw bad('Check-out must be after check-in');
  if (nights > 90) throw bad('Stays longer than 90 nights must be arranged with the manager');
  if (!allowPast && checkIn < today()) throw bad('Check-in date is in the past');
  return nights;
}

function assertRoomFree(roomId: number, checkIn: string, checkOut: string, reservationId = 0) {
  const room = get<{ id: number; room_type_id: number; status: string; number: string }>('SELECT * FROM rooms WHERE id = ?', roomId);
  if (!room) throw bad('Room not found');
  if (room.status === 'maintenance') throw new HttpError(409, `Room ${room.number} is under maintenance`);
  const free = freeRooms(room.room_type_id, checkIn, checkOut, reservationId).some((r) => r.id === roomId);
  if (!free) throw new HttpError(409, `Room ${room.number} is already booked for those dates`);
  return room;
}

const balanceOf = (id: number) =>
  get<{ balance: number }>(
    'SELECT r.total - COALESCE((SELECT SUM(amount) FROM payments WHERE reservation_id = r.id), 0) AS balance FROM reservations r WHERE r.id = ?',
    id,
  )?.balance ?? 0;

type ResRow = { id: number; status: ReservationStatus; room_id: number | null; room_type_id: number; check_in: string; check_out: string; code: string; total: number };

function load(id: number): ResRow {
  const r = get<ResRow>('SELECT id, status, room_id, room_type_id, check_in, check_out, code, total FROM reservations WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Reservation not found');
  return r;
}

const LIST_SQL = `
  SELECT r.id, r.code, r.check_in, r.check_out, r.nights, r.rate, r.total, r.status, r.source, r.adults, r.notes, r.created_at,
         g.name AS guest_name, g.phone AS guest_phone, g.email AS guest_email,
         t.name AS room_type, rm.number AS room_number, r.room_id, r.room_type_id,
         COALESCE((SELECT SUM(amount) FROM payments p WHERE p.reservation_id = r.id), 0) AS paid
    FROM reservations r
    JOIN guests g ON g.id = r.guest_id
    JOIN room_types t ON t.id = r.room_type_id
    LEFT JOIN rooms rm ON rm.id = r.room_id`;

// ---------- room types & rooms ----------

reservations.get(
  '/room-types',
  allow('manager', 'frontdesk', 'bar'),
  h((_req, res) => {
    res.json(all('SELECT id, name, slug, rate, capacity, description FROM room_types ORDER BY rate'));
  }),
);

reservations.patch(
  '/room-types/:id',
  allow('manager'),
  h((req, res) => {
    const rate = int(body(req), 'rate', { min: 1000, max: 5_000_000 });
    const id = Number(req.params.id);
    const before = get<{ rate: number }>('SELECT rate FROM room_types WHERE id = ?', id);
    if (!before) throw new HttpError(404, 'Room type not found');
    run('UPDATE room_types SET rate = ? WHERE id = ?', rate, id);
    audit(currentUser(req).id, 'rate_change', 'room_type', id, { from: before.rate, to: rate });
    res.json({ ok: true });
  }),
);

reservations.get(
  '/rooms',
  desk,
  h((_req, res) => {
    const t = today();
    res.json(
      all(
        `SELECT rm.id, rm.number, rm.floor, rm.status, t.name AS room_type, t.rate, rm.room_type_id,
                cur.id AS reservation_id, cur.code, cur.check_out, g.name AS guest_name,
                (SELECT COUNT(*) FROM reservations a WHERE a.room_id = rm.id AND a.status = 'confirmed' AND a.check_in = ?) AS arriving_today
           FROM rooms rm
           JOIN room_types t ON t.id = rm.room_type_id
           LEFT JOIN reservations cur ON cur.room_id = rm.id AND cur.status = 'checked_in'
           LEFT JOIN guests g ON g.id = cur.guest_id
          ORDER BY rm.number`,
        t,
      ),
    );
  }),
);

reservations.patch(
  '/rooms/:id/status',
  desk,
  h((req, res) => {
    const status = oneOf(body(req), 'status', ROOM_STATUSES);
    const id = Number(req.params.id);
    const occupied = get('SELECT 1 FROM reservations WHERE room_id = ? AND status = ?', id, 'checked_in');
    if (occupied && status !== 'occupied') throw new HttpError(409, 'A guest is checked into this room — check them out first');
    if (!occupied && status === 'occupied') throw new HttpError(409, 'Rooms become occupied by checking a guest in');
    if (!run('UPDATE rooms SET status = ? WHERE id = ?', status, id).changes) throw new HttpError(404, 'Room not found');
    audit(currentUser(req).id, 'room_status', 'room', id, { status });
    res.json({ ok: true });
  }),
);

reservations.get(
  '/availability',
  desk,
  h((req, res) => {
    const b = { check_in: req.query.check_in, check_out: req.query.check_out };
    const checkIn = date(b, 'check_in');
    const checkOut = date(b, 'check_out');
    validateStay(checkIn, checkOut, true);
    const typeId = req.query.room_type_id ? Number(req.query.room_type_id) : null;
    res.json(freeRooms(typeId, checkIn, checkOut, Number(req.query.exclude) || 0));
  }),
);

// ---------- reservations ----------

reservations.get(
  '/reservations',
  desk,
  h((req, res) => {
    const where: string[] = [];
    const params: (string | number)[] = [];
    const status = req.query.status;
    if (typeof status === 'string' && (RESERVATION_STATUSES as readonly string[]).includes(status)) {
      where.push('r.status = ?');
      params.push(status);
    }
    const view = req.query.view;
    const t = today();
    if (view === 'arrivals') where.push(`r.check_in = ? AND r.status IN ('confirmed','pending')`), params.push(t);
    if (view === 'departures') where.push(`r.check_out <= ? AND r.status = 'checked_in'`), params.push(t);
    if (view === 'inhouse') where.push(`r.status = 'checked_in'`);
    if (view === 'upcoming') where.push(`r.check_in >= ? AND r.status IN ('confirmed','pending')`), params.push(t);
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    if (q) {
      where.push('(g.name LIKE ? OR g.phone LIKE ? OR r.code LIKE ? OR rm.number = ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, q);
    }
    const order = view === 'upcoming' || view === 'arrivals' ? 'r.check_in ASC' : 'r.check_in DESC, r.id DESC';
    res.json(all(`${LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 200`, ...params));
  }),
);

reservations.get(
  '/reservations/:id',
  desk,
  h((req, res) => {
    const r = get(`${LIST_SQL} WHERE r.id = ?`, Number(req.params.id));
    if (!r) throw new HttpError(404, 'Reservation not found');
    const payments = all(
      `SELECT p.id, p.amount, p.method, p.date, u.name AS received_by
         FROM payments p LEFT JOIN users u ON u.id = p.received_by WHERE p.reservation_id = ? ORDER BY p.id`,
      Number(req.params.id),
    );
    res.json({ ...r, payments });
  }),
);

reservations.post(
  '/reservations',
  desk,
  h((req, res) => {
    const user = currentUser(req);
    const b = body(req);
    const guest = (b.guest ?? {}) as Record<string, unknown>;
    const name = str(guest, 'name', { max: 120 });
    const phone = str(guest, 'phone', { max: 20, pattern: PHONE_RE });
    const email = str(guest, 'email', { max: 254, optional: true, pattern: EMAIL_RE });
    const checkIn = date(b, 'check_in');
    const checkOut = date(b, 'check_out');
    const nights = validateStay(checkIn, checkOut);
    const typeId = int(b, 'room_type_id', { min: 1 });
    const adults = int(b, 'adults', { min: 1, max: 6 });
    const source = oneOf(b, 'source', RESERVATION_SOURCES);
    const notes = str(b, 'notes', { max: 500, optional: true });
    const roomId = int(b, 'room_id', { min: 1, optional: true });
    const checkInNow = b.check_in_now === true;
    const type = get<{ rate: number }>('SELECT rate FROM room_types WHERE id = ?', typeId);
    if (!type) throw bad('Unknown room type');

    // Only a manager may sell below or above the published rate.
    let rate = type.rate;
    if (b.rate !== undefined && b.rate !== '' && b.rate !== null) {
      const custom = int(b, 'rate', { min: 1000, max: 5_000_000 });
      if (custom !== type.rate && user.role !== 'manager') throw new HttpError(403, 'Only a manager can change the room rate');
      rate = custom;
    }
    const deposit = b.deposit ? int(b, 'deposit', { min: 1 }) : 0;
    const depositMethod = deposit ? oneOf(b, 'deposit_method', PAYMENT_METHODS) : 'cash';
    if (deposit > rate * nights) throw bad('Deposit is more than the total for the stay');
    if (checkInNow && checkIn !== today()) throw bad('Only a stay starting today can be checked in now');
    if (checkInNow && Number.isNaN(roomId)) throw bad('Choose a room to check the guest into');

    const result = tx(() => {
      if (!Number.isNaN(roomId)) {
        const room = assertRoomFree(roomId, checkIn, checkOut);
        if (room.room_type_id !== typeId) throw bad('That room is not of the selected type');
        if (checkInNow && room.status !== 'available') throw new HttpError(409, `Room ${room.number} is not ready (${room.status})`);
      } else if ((availabilityByType(checkIn, checkOut).get(typeId) ?? 0) < 1) {
        throw new HttpError(409, 'No rooms of that type are free for those dates');
      }
      const existing = get<{ id: number }>('SELECT id FROM guests WHERE phone = ? AND name = ? COLLATE NOCASE', phone, name);
      const guestId = existing?.id ?? run('INSERT INTO guests (name, phone, email) VALUES (?,?,?)', name, phone, email || null).id;
      const status = checkInNow ? 'checked_in' : 'confirmed';
      const { id } = run(
        `INSERT INTO reservations (code, guest_id, room_type_id, room_id, check_in, check_out, nights, rate, total, adults, status, source, notes, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        code('DH'), guestId, typeId, Number.isNaN(roomId) ? null : roomId, checkIn, checkOut, nights, rate, rate * nights, adults, status, source, notes || null, user.id,
      );
      if (checkInNow) run("UPDATE rooms SET status = 'occupied' WHERE id = ?", roomId);
      if (deposit) run('INSERT INTO payments (reservation_id, amount, method, date, received_by) VALUES (?,?,?,?,?)', id, deposit, depositMethod, today(), user.id);
      audit(user.id, 'create', 'reservation', id, { status, rate, nights });
      return { id };
    });
    res.status(201).json(result);
  }),
);

reservations.post(
  '/reservations/:id/confirm',
  desk,
  h((req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const roomId = int(body(req), 'room_id', { min: 1, optional: true });
    tx(() => {
      const r = load(id);
      if (r.status !== 'pending') throw new HttpError(409, 'Only booking requests can be confirmed');
      if (!Number.isNaN(roomId)) {
        const room = assertRoomFree(roomId, r.check_in, r.check_out, id);
        if (room.room_type_id !== r.room_type_id) throw bad('That room is not of the requested type');
      } else if ((availabilityByType(r.check_in, r.check_out).get(r.room_type_id) ?? 0) < 1) {
        throw new HttpError(409, 'No rooms of that type are free for those dates');
      }
      run("UPDATE reservations SET status = 'confirmed', room_id = ? WHERE id = ?", Number.isNaN(roomId) ? null : roomId, id);
      audit(user.id, 'confirm', 'reservation', id);
    });
    res.json({ ok: true });
  }),
);

reservations.post(
  '/reservations/:id/check-in',
  desk,
  h((req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const b = body(req);
    tx(() => {
      const r = load(id);
      if (r.status !== 'confirmed' && r.status !== 'pending') throw new HttpError(409, 'This reservation cannot be checked in');
      if (r.check_in > today()) throw new HttpError(409, `Arrival is on ${r.check_in} — it can't be checked in early`);
      if (r.check_out <= today()) throw new HttpError(409, 'This stay has already ended');
      const roomId = b.room_id ? int(b, 'room_id', { min: 1 }) : r.room_id;
      if (!roomId) throw bad('Choose a room');
      const room = assertRoomFree(roomId, today(), r.check_out, id);
      if (room.room_type_id !== r.room_type_id) throw bad('That room is not of the booked type');
      if (room.status !== 'available') throw new HttpError(409, `Room ${room.number} is not ready (${room.status})`);
      run("UPDATE reservations SET status = 'checked_in', room_id = ? WHERE id = ?", roomId, id);
      run("UPDATE rooms SET status = 'occupied' WHERE id = ?", roomId);
      audit(user.id, 'check_in', 'reservation', id, { room: room.number });
    });
    res.json({ ok: true });
  }),
);

reservations.post(
  '/reservations/:id/check-out',
  desk,
  h((req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const force = body(req).force === true;
    tx(() => {
      const r = load(id);
      if (r.status !== 'checked_in') throw new HttpError(409, 'Guest is not checked in');
      const balance = balanceOf(id);
      if (balance > 0 && !(force && user.role === 'manager')) {
        throw new HttpError(409, `Outstanding balance of ₦${balance.toLocaleString('en-NG')} — record payment first`);
      }
      run("UPDATE reservations SET status = 'checked_out' WHERE id = ?", id);
      run("UPDATE rooms SET status = 'cleaning' WHERE id = ?", r.room_id);
      audit(user.id, balance > 0 ? 'check_out_with_balance' : 'check_out', 'reservation', id, balance > 0 ? { balance } : undefined);
    });
    res.json({ ok: true });
  }),
);

reservations.post(
  '/reservations/:id/cancel',
  desk,
  h((req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const reason = str(body(req), 'reason', { max: 300, optional: true });
    tx(() => {
      const r = load(id);
      if (r.status !== 'pending' && r.status !== 'confirmed') throw new HttpError(409, 'Only upcoming reservations can be cancelled');
      run("UPDATE reservations SET status = 'cancelled' WHERE id = ?", id);
      audit(user.id, 'cancel', 'reservation', id, reason ? { reason } : undefined);
    });
    res.json({ ok: true });
  }),
);

reservations.post(
  '/reservations/:id/payments',
  desk,
  h((req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const b = body(req);
    const amount = int(b, 'amount', { min: 1 });
    const method = oneOf(b, 'method', PAYMENT_METHODS);
    tx(() => {
      const r = load(id);
      if (r.status === 'cancelled') throw new HttpError(409, 'Reservation is cancelled');
      const balance = balanceOf(id);
      if (amount > balance) throw bad(`Amount is more than the outstanding balance (₦${balance.toLocaleString('en-NG')})`);
      const p = run('INSERT INTO payments (reservation_id, amount, method, date, received_by) VALUES (?,?,?,?,?)', id, amount, method, today(), user.id);
      audit(user.id, 'payment', 'reservation', id, { amount, method, payment_id: p.id });
    });
    res.status(201).json({ ok: true });
  }),
);
