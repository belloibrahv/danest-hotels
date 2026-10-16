import { Router } from 'express';
import {
  ID_TYPES,
  PAYMENT_METHODS,
  RESERVATION_SOURCES,
  RESERVATION_STATUSES,
  ROOM_STATUSES,
  type ReservationStatus,
} from '../../shared/constants.ts';
import { allow, currentUser } from '../auth.ts';
import { assertOpen } from '../days.ts';
import { priceStay, saveNights, trimNights } from '../pricing.ts';
import { logRoom } from './housekeeping.ts';
import { all, audit, get, run, tx } from '../db.ts';
import { EMAIL_RE, HttpError, PHONE_RE, addDays, bad, body, code, date, daysBetween, h, int, isDate, oneOf, str, today } from '../lib.ts';

export const reservations = Router();
const desk = allow('manager', 'frontdesk');

// ---------- availability (shared with the public booking form) ----------

/** Statuses that hold a physical room. Website requests ("pending") don't block inventory until confirmed. */
const HOLDING = `('confirmed','checked_in')`;

/**
 * When a stay really ends: an in-house guest who is past their departure date still
 * occupies the room until they are checked out, so they hold it through tonight.
 */
const EFFECTIVE_OUT = `CASE WHEN x.status = 'checked_in' AND x.check_out <= :today THEN date(:today, '+1 day') ELSE x.check_out END`;

export function freeRooms(roomTypeId: number | null, checkIn: string, checkOut: string, excludeReservation = 0) {
  return all<{ id: number; number: string; room_type_id: number; status: string }>(
    `SELECT r.id, r.number, r.room_type_id, r.status FROM rooms r
      WHERE (:type IS NULL OR r.room_type_id = :type)
        AND r.active = 1 AND r.status <> 'maintenance'
        AND NOT EXISTS (
          SELECT 1 FROM reservations x
           WHERE x.room_id = r.id AND x.status IN ${HOLDING} AND x.id <> :exclude
             AND x.check_in < :out AND ${EFFECTIVE_OUT} > :in)
      ORDER BY r.number`,
    { type: roomTypeId, exclude: excludeReservation, out: checkOut, in: checkIn, today: today() },
  );
}

/** Rooms of each type still sellable for the stay, net of confirmed bookings not yet given a room. */
export function availabilityByType(checkIn: string, checkOut: string, excludeReservation = 0): Map<number, number> {
  const free = new Map<number, number>();
  for (const r of freeRooms(null, checkIn, checkOut, excludeReservation)) free.set(r.room_type_id, (free.get(r.room_type_id) ?? 0) + 1);
  const unassigned = all<{ room_type_id: number; n: number }>(
    `SELECT room_type_id, COUNT(*) n FROM reservations
      WHERE room_id IS NULL AND status = 'confirmed' AND check_in < ? AND check_out > ? AND id <> ?
      GROUP BY room_type_id`,
    checkOut,
    checkIn,
    excludeReservation,
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
  if (room.status === 'maintenance') throw new HttpError(409, `Room ${room.number} is out of order`);
  const free = freeRooms(room.room_type_id, checkIn, checkOut, reservationId).some((r) => r.id === roomId);
  if (!free) throw new HttpError(409, `Room ${room.number} is already booked for those dates`);
  return room;
}

// ---------- folio: everything a stay owes, and everything paid against it ----------

/** Bar and facility sales posted to the room. */
export const CHARGES_SQL = `(COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.reservation_id = r.id), 0)
  + COALESCE((SELECT SUM(f.amount) FROM facility_income f WHERE f.reservation_id = r.id), 0))`;
export const PAID_SQL = `COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.reservation_id = r.id), 0)`;

export const balanceOf = (id: number) =>
  get<{ balance: number }>(`SELECT r.total + ${CHARGES_SQL} - ${PAID_SQL} AS balance FROM reservations r WHERE r.id = ?`, id)?.balance ?? 0;

type ResRow = { id: number; status: ReservationStatus; room_id: number | null; room_type_id: number; check_in: string; check_out: string; code: string; total: number; rate: number; nights: number };

function load(id: number): Stay {
  if (!Number.isInteger(id)) throw new HttpError(404, 'Reservation not found');
  const r = get<Stay>('SELECT id, status, room_id, room_type_id, check_in, check_out, code, total, rate, nights, company_id, rate_note FROM reservations WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Reservation not found');
  return r;
}

type Stay = ResRow & { company_id: number | null; rate_note: string | null };

/** Add nights to the end of a stay, priced as they would be sold today (same company, same manager rate). */
function extendNights(r: Stay, newOut: string) {
  const override = r.rate_note === 'Manager rate' ? r.rate : null;
  const quote = priceStay(r.room_type_id, r.check_out, newOut, { companyId: r.company_id, override });
  saveNights(r.id, quote.nights);
}

const LIST_SQL = `
  SELECT r.id, r.code, r.check_in, r.check_out, r.nights, r.rate, r.total, r.status, r.source, r.adults, r.notes, r.created_at,
         r.checked_in_at, r.checked_out_at,
         g.id AS guest_id, g.name AS guest_name, g.phone AS guest_phone, g.email AS guest_email, g.vip AS guest_vip,
         t.name AS room_type, rm.number AS room_number, r.room_id, r.room_type_id,
         r.company_id, r.bill_to_company, r.rate_note, co.name AS company_name,
         ${CHARGES_SQL} AS charges,
         ${PAID_SQL} AS paid
    FROM reservations r
    JOIN guests g ON g.id = r.guest_id
    JOIN room_types t ON t.id = r.room_type_id
    LEFT JOIN rooms rm ON rm.id = r.room_id
    LEFT JOIN companies co ON co.id = r.company_id`;

// ---------- room types & rooms ----------

reservations.get(
  '/room-types',
  allow('manager', 'frontdesk', 'bar'),
  h((_req, res) => {
    res.json(all('SELECT id, name, slug, rate, capacity, description FROM room_types WHERE active = 1 ORDER BY rate'));
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
                cur.id AS reservation_id, cur.code, cur.check_out, g.name AS guest_name, g.vip AS guest_vip,
                (SELECT COUNT(*) FROM reservations a WHERE a.room_id = rm.id AND a.status = 'confirmed' AND a.check_in = ?) AS arriving_today
           FROM rooms rm
           JOIN room_types t ON t.id = rm.room_type_id
           LEFT JOIN reservations cur ON cur.room_id = rm.id AND cur.status = 'checked_in'
           LEFT JOIN guests g ON g.id = cur.guest_id
          WHERE rm.active = 1
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
    if (status === 'available' && get("SELECT 1 FROM maintenance_tickets WHERE room_id = ? AND blocks_room = 1 AND status <> 'resolved'", id)) {
      throw new HttpError(409, 'This room has an open repair. Resolve it under Housekeeping first.');
    }
    if (!run('UPDATE rooms SET status = ? WHERE id = ?', status, id).changes) throw new HttpError(404, 'Room not found');
    logRoom(id, status === 'cleaning' ? 'dirty' : status === 'maintenance' ? 'out_of_order' : status === 'available' ? 'cleaned' : 'back_in_service', currentUser(req).id);
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

/** In-house guests, for posting bar/facility charges to a room. Deliberately minimal: no phone, no balance. */
reservations.get(
  '/inhouse',
  allow('manager', 'frontdesk', 'bar'),
  h((_req, res) => {
    res.json(
      all(
        `SELECT r.id AS reservation_id, rm.number AS room_number, g.name AS guest_name
           FROM reservations r JOIN guests g ON g.id = r.guest_id JOIN rooms rm ON rm.id = r.room_id
          WHERE r.status = 'checked_in' ORDER BY rm.number`,
      ),
    );
  }),
);

// ---------- tape chart ----------

reservations.get(
  '/calendar',
  desk,
  h((req, res) => {
    const from = isDate(req.query.from) ? req.query.from : addDays(today(), -2);
    const days = Math.min(Math.max(Number(req.query.days) || 14, 7), 42);
    const to = addDays(from, days);
    const rooms = all('SELECT rm.id, rm.number, rm.floor, rm.status, t.name AS room_type, t.id AS room_type_id FROM rooms rm JOIN room_types t ON t.id = rm.room_type_id WHERE rm.active = 1 ORDER BY rm.number');
    const stays = all(
      `SELECT r.id, r.code, r.room_id, r.room_type_id, r.check_in, r.check_out, r.status, r.source, g.name AS guest_name, g.vip AS guest_vip,
              r.total + ${CHARGES_SQL} - ${PAID_SQL} AS balance
         FROM reservations r JOIN guests g ON g.id = r.guest_id
        WHERE r.status IN ('pending','confirmed','checked_in','checked_out') AND r.check_in < ? AND r.check_out > ?
        ORDER BY r.check_in`,
      to,
      from,
    );
    res.json({ from, days, today: today(), rooms, stays });
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
    if (view === 'balances') where.push(`r.status IN ('checked_in','checked_out') AND r.total + ${CHARGES_SQL} - ${PAID_SQL} > 0`);
    if (typeof req.query.guest_id === 'string' && /^\d+$/.test(req.query.guest_id)) where.push('g.id = ?'), params.push(Number(req.query.guest_id));
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
    const id = Number(req.params.id);
    const r = get<{ check_in: string; check_out: string; rate: number; room_number: string | null; room_type: string; status: string }>(`${LIST_SQL} WHERE r.id = ?`, id);
    if (!r) throw new HttpError(404, 'Reservation not found');
    const payments = all(
      `SELECT p.id, p.amount, p.method, p.date, u.name AS received_by
         FROM payments p LEFT JOIN users u ON u.id = p.received_by WHERE p.reservation_id = ? ORDER BY p.id`,
      id,
    );
    // The folio, line by line, the way a guest sees it on their bill.
    const lines: { date: string; kind: string; description: string; amount: number }[] = [];
    for (const n of all<{ date: string; rate: number }>('SELECT date, rate FROM reservation_nights WHERE reservation_id = ? ORDER BY date', id)) {
      lines.push({ date: n.date, kind: 'room', description: `${r.room_type}${r.room_number ? ` · Room ${r.room_number}` : ''}`, amount: n.rate });
    }
    for (const s of all<{ id: number; date: string; receipt_no: string; total: number; items: string }>(
      `SELECT s.id, s.date, s.receipt_no, s.total,
              (SELECT GROUP_CONCAT(si.qty || '× ' || p.name, ', ') FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = s.id) AS items
         FROM sales s WHERE s.reservation_id = ? ORDER BY s.id`,
      id,
    )) {
      lines.push({ date: s.date, kind: 'bar', description: `Bar & shop — ${s.items}`, amount: s.total });
    }
    for (const f of all<{ date: string; facility: string; item: string; amount: number }>('SELECT date, facility, item, amount FROM facility_income WHERE reservation_id = ? ORDER BY id', id)) {
      lines.push({ date: f.date, kind: f.facility, description: f.item, amount: f.amount });
    }
    lines.sort((a, b) => a.date.localeCompare(b.date));
    res.json({ ...r, payments, folio: lines });
  }),
);

function guestFields(guest: Record<string, unknown>) {
  return {
    name: str(guest, 'name', { max: 120 }),
    phone: str(guest, 'phone', { max: 20, pattern: PHONE_RE }),
    email: str(guest, 'email', { max: 254, optional: true, pattern: EMAIL_RE }),
    id_type: guest.id_type ? oneOf(guest, 'id_type', ID_TYPES) : '',
    id_number: str(guest, 'id_number', { max: 40, optional: true, pattern: /^[A-Za-z0-9 -]+$/ }),
    address: str(guest, 'address', { max: 200, optional: true }),
  };
}

/** One profile per phone number: repeat guests build up a stay history automatically. */
function upsertGuest(g: ReturnType<typeof guestFields>): number {
  const existing = get<{ id: number }>('SELECT id FROM guests WHERE phone = ? ORDER BY id LIMIT 1', g.phone);
  if (existing) {
    run(
      `UPDATE guests SET name = ?, email = COALESCE(NULLIF(?, ''), email), id_type = COALESCE(NULLIF(?, ''), id_type),
              id_number = COALESCE(NULLIF(?, ''), id_number), address = COALESCE(NULLIF(?, ''), address) WHERE id = ?`,
      g.name, g.email, g.id_type, g.id_number, g.address, existing.id,
    );
    return existing.id;
  }
  return run('INSERT INTO guests (name, phone, email, id_type, id_number, address) VALUES (?,?,?,?,?,?)', g.name, g.phone, g.email || null, g.id_type || null, g.id_number || null, g.address || null).id;
}

reservations.post(
  '/reservations',
  desk,
  h((req, res) => {
    const user = currentUser(req);
    const b = body(req);
    const guest = guestFields((b.guest ?? {}) as Record<string, unknown>);
    const checkIn = date(b, 'check_in');
    const checkOut = date(b, 'check_out');
    validateStay(checkIn, checkOut);
    const typeId = int(b, 'room_type_id', { min: 1 });
    const adults = int(b, 'adults', { min: 1, max: 6 });
    const source = oneOf(b, 'source', RESERVATION_SOURCES);
    const companyId = b.company_id ? int(b, 'company_id', { min: 1 }) : null;
    const billToCompany = !!companyId && b.bill_to_company === true;
    const notes = str(b, 'notes', { max: 500, optional: true });
    const roomId = int(b, 'room_id', { min: 1, optional: true });
    const checkInNow = b.check_in_now === true;
    const type = get<{ rate: number }>('SELECT rate FROM room_types WHERE id = ? AND active = 1', typeId);
    if (!type) throw bad('Unknown room type');

    // Only a manager may set the price by hand; everyone else sells at the computed rate.
    let override: number | null = null;
    if (b.rate !== undefined && b.rate !== '' && b.rate !== null) {
      override = int(b, 'rate', { min: 1000, max: 5_000_000 });
      if (user.role !== 'manager') throw new HttpError(403, 'Only a manager can change the room rate');
    }
    const quote = priceStay(typeId, checkIn, checkOut, { companyId, override });
    const deposit = b.deposit ? int(b, 'deposit', { min: 1 }) : 0;
    const depositMethod = deposit ? oneOf(b, 'deposit_method', PAYMENT_METHODS) : 'cash';
    if (deposit > quote.total) throw bad('Payment is more than the total for the stay');
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
      const guestId = upsertGuest(guest);
      const status = checkInNow ? 'checked_in' : 'confirmed';
      const { id } = run(
        `INSERT INTO reservations (code, guest_id, room_type_id, room_id, check_in, check_out, nights, rate, total, adults, status, source, notes, created_by, checked_in_at, company_id, bill_to_company, rate_note)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        code('DH'), guestId, typeId, Number.isNaN(roomId) ? null : roomId, checkIn, checkOut, quote.nights.length, quote.average, quote.total, adults, status, source, notes || null, user.id,
        checkInNow ? new Date().toISOString() : null, companyId, billToCompany ? 1 : 0, quote.note,
      );
      saveNights(id, quote.nights);
      if (checkInNow) run("UPDATE rooms SET status = 'occupied' WHERE id = ?", roomId);
      if (deposit) assertOpen(today());
      if (deposit) run('INSERT INTO payments (reservation_id, amount, method, date, received_by) VALUES (?,?,?,?,?)', id, deposit, depositMethod, today(), user.id);
      audit(user.id, 'create', 'reservation', id, { status, total: quote.total, nights: quote.nights.length, rate_note: quote.note ?? undefined });
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
      run("UPDATE reservations SET status = 'checked_in', room_id = ?, checked_in_at = ? WHERE id = ?", roomId, new Date().toISOString(), id);
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
      // Leaving early: the guest pays for the nights actually used (at least one).
      const t = today();
      if (t < r.check_out) {
        const out = t > r.check_in ? t : addDays(r.check_in, 1);
        if (out < r.check_out) trimNights(id, out);
      }
      let balance = balanceOf(id);
      // Corporate guests: the bill moves to the company's account instead of being paid at the desk.
      const billing = get<{ bill_to_company: number; company_id: number | null }>('SELECT bill_to_company, company_id FROM reservations WHERE id = ?', id)!;
      if (balance > 0 && billing.bill_to_company && billing.company_id) {
        const c = get<{ name: string; credit_limit: number }>('SELECT name, credit_limit FROM companies WHERE id = ?', billing.company_id)!;
        const owed = companyBalance(billing.company_id);
        if (c.credit_limit && owed + balance > c.credit_limit && !(force && user.role === 'manager')) {
          throw new HttpError(409, `${c.name} would go over its ₦${c.credit_limit.toLocaleString('en-NG')} credit limit (owes ₦${owed.toLocaleString('en-NG')}). A manager can override.`);
        }
        assertOpen(today());
        run("INSERT INTO payments (reservation_id, amount, method, date, received_by) VALUES (?,?, 'company', ?, ?)", id, balance, today(), user.id);
        audit(user.id, 'bill_to_company', 'reservation', id, { company: c.name, amount: balance });
        balance = 0;
      }
      if (balance > 0 && !(force && user.role === 'manager')) {
        throw new HttpError(409, `Outstanding balance of ₦${balance.toLocaleString('en-NG')} — record payment first`);
      }
      run("UPDATE reservations SET status = 'checked_out', checked_out_at = ? WHERE id = ?", new Date().toISOString(), id);
      run("UPDATE rooms SET status = 'cleaning' WHERE id = ?", r.room_id);
      if (r.room_id) logRoom(r.room_id, 'dirty', user.id, 'Guest checked out');
      audit(user.id, balance > 0 ? 'check_out_with_balance' : 'check_out', 'reservation', id, balance > 0 ? { balance } : undefined);
    });
    res.json({ ok: true });
  }),
);

reservations.post(
  '/reservations/:id/extend',
  desk,
  h((req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const newOut = date(body(req), 'check_out');
    tx(() => {
      const r = load(id);
      if (!['pending', 'confirmed', 'checked_in'].includes(r.status)) throw new HttpError(409, 'Only upcoming or in-house stays can be changed');
      validateStay(r.check_in, newOut, true);
      if (r.status === 'checked_in' && newOut <= today()) throw bad('An in-house stay must end after today');
      if (newOut > r.check_out) {
        if (r.room_id) assertRoomFree(r.room_id, r.check_in, newOut, id);
        else if (r.status === 'confirmed' && (availabilityByType(r.check_out, newOut, id).get(r.room_type_id) ?? 0) < 1) {
          throw new HttpError(409, 'No rooms of that type are free for the extra nights');
        }
      }
      if (newOut > r.check_out) extendNights(r, newOut);
      else trimNights(id, newOut);
      audit(user.id, 'change_dates', 'reservation', id, { from: r.check_out, to: newOut });
    });
    res.json({ ok: true });
  }),
);

reservations.post(
  '/reservations/:id/move',
  desk,
  h((req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const roomId = int(body(req), 'room_id', { min: 1 });
    tx(() => {
      const r = load(id);
      if (!['confirmed', 'checked_in'].includes(r.status)) throw new HttpError(409, 'Only confirmed or in-house stays can change room');
      if (r.room_id === roomId) throw bad('The guest is already in that room');
      const from = r.status === 'checked_in' ? today() : r.check_in;
      // A move keeps the agreed rate: upgrades are a courtesy, not a re-sale.
      const room = assertRoomFree(roomId, from, r.check_out, id);
      if (r.status === 'checked_in') {
        if (room.status !== 'available') throw new HttpError(409, `Room ${room.number} is not ready (${room.status})`);
        run("UPDATE rooms SET status = 'cleaning' WHERE id = ?", r.room_id);
        run("UPDATE rooms SET status = 'occupied' WHERE id = ?", roomId);
        if (r.room_id) logRoom(r.room_id, 'dirty', user.id, 'Guest moved rooms');
      }
      run('UPDATE reservations SET room_id = ? WHERE id = ?', roomId, id);
      audit(user.id, 'room_move', 'reservation', id, { room: room.number });
    });
    res.json({ ok: true });
  }),
);

/** A guest who never arrived. Kept as a cancellation, marked so reports can count no-shows. */
reservations.post(
  '/reservations/:id/no-show',
  desk,
  h((req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    tx(() => {
      const r = load(id);
      if (r.status !== 'pending' && r.status !== 'confirmed') throw new HttpError(409, 'Only bookings that have not arrived can be marked as no-show');
      if (r.check_in > today()) throw new HttpError(409, 'The guest is not due yet');
      run("UPDATE reservations SET status = 'cancelled', notes = '[No-show] ' || COALESCE(notes, '') WHERE id = ?", id);
      audit(user.id, 'no_show', 'reservation', id);
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
      assertOpen(today());
      const balance = balanceOf(id);
      if (amount > balance) throw bad(`Amount is more than the outstanding balance (₦${balance.toLocaleString('en-NG')})`);
      const p = run('INSERT INTO payments (reservation_id, amount, method, date, received_by) VALUES (?,?,?,?,?)', id, amount, method, today(), user.id);
      audit(user.id, 'payment', 'reservation', id, { amount, method, payment_id: p.id });
    });
    res.status(201).json({ ok: true });
  }),
);

// ---------- guest profiles ----------

const STAY_STATS = `
  (SELECT COUNT(*) FROM reservations r WHERE r.guest_id = g.id AND r.status IN ('checked_in','checked_out')) AS stays,
  (SELECT COALESCE(SUM(r.nights),0) FROM reservations r WHERE r.guest_id = g.id AND r.status IN ('checked_in','checked_out')) AS nights,
  (SELECT COALESCE(SUM(r.total + ${CHARGES_SQL}),0) FROM reservations r WHERE r.guest_id = g.id AND r.status IN ('checked_in','checked_out')) AS spend,
  (SELECT MAX(r.check_in) FROM reservations r WHERE r.guest_id = g.id AND r.status IN ('checked_in','checked_out')) AS last_stay,
  (SELECT MIN(r.check_in) FROM reservations r WHERE r.guest_id = g.id AND r.status IN ('pending','confirmed') AND r.check_in >= date('now')) AS next_stay`;

reservations.get(
  '/guests',
  desk,
  h((req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    const sort = req.query.sort === 'recent' ? 'last_stay DESC' : req.query.sort === 'name' ? 'g.name' : 'spend DESC';
    res.json(
      all(
        `SELECT * FROM (SELECT g.id, g.name, g.phone, g.email, g.vip, ${STAY_STATS} FROM guests g
          WHERE (? = '' OR g.name LIKE ? OR g.phone LIKE ? OR g.email LIKE ?)) g
          ${req.query.vip === '1' ? 'WHERE g.vip = 1' : ''}
          ORDER BY ${sort} LIMIT 200`,
        q, `%${q}%`, `%${q}%`, `%${q}%`,
      ),
    );
  }),
);

reservations.get(
  '/guests/:id',
  desk,
  h((req, res) => {
    const id = Number(req.params.id);
    const g = get(`SELECT g.*, ${STAY_STATS} FROM guests g WHERE g.id = ?`, id);
    if (!g) throw new HttpError(404, 'Guest not found');
    const favourite = get(
      `SELECT t.name, COUNT(*) n FROM reservations r JOIN room_types t ON t.id = r.room_type_id
        WHERE r.guest_id = ? AND r.status IN ('checked_in','checked_out') GROUP BY t.id ORDER BY n DESC LIMIT 1`,
      id,
    );
    res.json({ ...g, favourite_room: favourite ?? null, stays_list: all(`${LIST_SQL} WHERE g.id = ? ORDER BY r.check_in DESC LIMIT 50`, id) });
  }),
);

reservations.patch(
  '/guests/:id',
  desk,
  h((req, res) => {
    const id = Number(req.params.id);
    const b = body(req);
    if (!get('SELECT 1 FROM guests WHERE id = ?', id)) throw new HttpError(404, 'Guest not found');
    const g = guestFields(b);
    const clash = get<{ id: number }>('SELECT id FROM guests WHERE phone = ? AND id <> ?', g.phone, id);
    if (clash) throw new HttpError(409, 'Another guest profile already uses that phone number');
    run(
      'UPDATE guests SET name=?, phone=?, email=?, id_type=?, id_number=?, address=?, vip=?, notes=? WHERE id=?',
      g.name, g.phone, g.email || null, g.id_type || null, g.id_number || null, g.address || null, b.vip === true ? 1 : 0, str(b, 'notes', { max: 1000, optional: true }) || null, id,
    );
    audit(currentUser(req).id, 'update', 'guest', id);
    res.json({ ok: true });
  }),
);

// ---------- global search (command palette) ----------

reservations.get(
  '/search',
  allow('manager', 'frontdesk', 'bar'),
  h((req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : '';
    if (q.length < 2 || req.user!.role === 'bar') return res.json({ guests: [], reservations: [], rooms: [] });
    const like = `%${q}%`;
    res.json({
      guests: all('SELECT id, name, phone, vip FROM guests WHERE name LIKE ? OR phone LIKE ? ORDER BY vip DESC, id DESC LIMIT 5', like, like),
      reservations: all(
        `SELECT r.id, r.code, r.status, r.check_in, r.check_out, g.name AS guest_name, rm.number AS room_number
           FROM reservations r JOIN guests g ON g.id = r.guest_id LEFT JOIN rooms rm ON rm.id = r.room_id
          WHERE r.code LIKE ? OR g.name LIKE ? ORDER BY ABS(julianday(r.check_in) - julianday('now')) LIMIT 6`,
        like, like,
      ),
      rooms: all(
        `SELECT rm.id, rm.number, rm.status, t.name AS room_type, cur.id AS reservation_id FROM rooms rm JOIN room_types t ON t.id = rm.room_type_id
           LEFT JOIN reservations cur ON cur.room_id = rm.id AND cur.status = 'checked_in' WHERE rm.number LIKE ? LIMIT 4`,
        `${q}%`,
      ),
    });
  }),
);

// ---------- pricing quote (front desk) ----------

/** What a stay would cost, night by night, before it is booked. */
reservations.get(
  '/quote',
  desk,
  h((req, res) => {
    const q = { check_in: req.query.check_in, check_out: req.query.check_out };
    const checkIn = date(q, 'check_in');
    const checkOut = date(q, 'check_out');
    validateStay(checkIn, checkOut, true);
    const typeId = Number(req.query.room_type_id);
    const companyId = req.query.company_id ? Number(req.query.company_id) : null;
    res.json(priceStay(typeId, checkIn, checkOut, { companyId }));
  }),
);

/** Put a stay on (or take it off) a company account. The agreed price is not changed. */
reservations.post(
  '/reservations/:id/company',
  desk,
  h((req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const b = body(req);
    const companyId = b.company_id ? int(b, 'company_id', { min: 1 }) : null;
    tx(() => {
      const r = load(id);
      if (r.status === 'checked_out' || r.status === 'cancelled') throw new HttpError(409, 'This stay is closed');
      if (companyId && !get('SELECT 1 FROM companies WHERE id = ? AND active = 1', companyId)) throw bad('That company account is not active');
      run('UPDATE reservations SET company_id = ?, bill_to_company = ? WHERE id = ?', companyId, companyId && b.bill_to_company === true ? 1 : 0, id);
      audit(user.id, 'set_company', 'reservation', id, { company_id: companyId, bill_to_company: b.bill_to_company === true });
    });
    res.json({ ok: true });
  }),
);

/** What a company owes: everything billed to its account, less what it has paid. */
export function companyBalance(companyId: number) {
  return get<{ v: number }>(
    `SELECT COALESCE((SELECT SUM(p.amount) FROM payments p JOIN reservations r ON r.id = p.reservation_id WHERE p.method = 'company' AND r.company_id = ?1), 0)
          - COALESCE((SELECT SUM(amount) FROM company_payments WHERE company_id = ?1), 0) AS v`,
    companyId,
  )!.v;
}
