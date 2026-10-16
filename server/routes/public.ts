import { Router } from 'express';
import { all, audit, get, run, tx } from '../db.ts';
import { rateLimit } from '../auth.ts';
import { EMAIL_RE, HttpError, PHONE_RE, bad, body, code, date, h, int, isDate, str, today, addDays } from '../lib.ts';
import { availabilityByType, validateStay } from './reservations.ts';
import { priceStay, saveNights } from '../pricing.ts';
import { paystackEnabled } from '../paystack.ts';
import { getSettings } from '../settings.ts';

/** Unauthenticated endpoints used by the guest website. Read-mostly; the one write is rate limited. */
export const publicApi = Router();

publicApi.get(
  '/room-types',
  h((req, res) => {
    const checkIn = isDate(req.query.check_in) ? req.query.check_in : today();
    const checkOut = isDate(req.query.check_out) && req.query.check_out > checkIn ? req.query.check_out : addDays(checkIn, 1);
    const free = availabilityByType(checkIn, checkOut);
    const types = all<{ id: number; amenities: string; rate: number }>(
      `SELECT id, name, slug, rate, capacity, description, amenities FROM room_types t
        WHERE t.active = 1 AND EXISTS (SELECT 1 FROM rooms r WHERE r.room_type_id = t.id AND r.active = 1) ORDER BY rate`,
    );
    // Price the exact stay, so weekend and seasonal rates show before the guest books.
    res.json(
      types.map((t) => {
        const q = priceStay(t.id, checkIn, checkOut);
        return { ...t, amenities: JSON.parse(t.amenities), available: free.get(t.id) ?? 0, total: q.total, average: q.average, rate_note: q.note };
      }),
    );
  }),
);

publicApi.post(
  '/booking-requests',
  h((req, res) => {
    rateLimit(`book:${req.ip}`, 5, 60 * 60_000);
    const b = body(req);
    // Honeypot: real visitors never see this field. Pretend success so bots don't adapt.
    if (typeof b.company === 'string' && b.company.length > 0) return res.status(201).json({ code: 'DH-RECEIVED' });

    const name = str(b, 'name', { max: 120, min: 2 });
    const phone = str(b, 'phone', { max: 20, pattern: PHONE_RE });
    const email = str(b, 'email', { max: 254, optional: true, pattern: EMAIL_RE });
    const checkIn = date(b, 'check_in');
    const checkOut = date(b, 'check_out');
    const nights = validateStay(checkIn, checkOut);
    if (checkIn > addDays(today(), 365)) throw bad('We take bookings up to a year ahead');
    const typeId = int(b, 'room_type_id', { min: 1 });
    const adults = int(b, 'adults', { min: 1, max: 6 });
    const notes = str(b, 'notes', { max: 500, optional: true });

    const result = tx(() => {
      const type = get<{ rate: number; capacity: number; name: string }>('SELECT rate, capacity, name FROM room_types WHERE id = ? AND active = 1', typeId);
      if (!type) throw bad('Please choose a room type');
      if (adults > type.capacity) throw bad(`The ${type.name} sleeps up to ${type.capacity}`);
      if ((availabilityByType(checkIn, checkOut).get(typeId) ?? 0) < 1) {
        throw new HttpError(409, `The ${type.name} is fully booked for those dates. Please try other dates or call us.`);
      }
      // Link to an existing profile by phone, but never let an anonymous form overwrite it.
      const existing = get<{ id: number; name: string }>('SELECT id, name FROM guests WHERE phone = ? ORDER BY id LIMIT 1', phone);
      const guestId = existing?.id ?? run('INSERT INTO guests (name, phone, email) VALUES (?,?,?)', name, phone, email || null).id;
      const bookedAs = existing && existing.name.toLowerCase() !== name.toLowerCase() ? `Booked online as “${name}”. ` : '';
      const ref = code('DH');
      const quote = priceStay(typeId, checkIn, checkOut);
      const { id } = run(
        `INSERT INTO reservations (code, guest_id, room_type_id, check_in, check_out, nights, rate, total, adults, status, source, notes, rate_note)
         VALUES (?,?,?,?,?,?,?,?,?,'pending','website',?,?)`,
        ref, guestId, typeId, checkIn, checkOut, nights, quote.average, quote.total, adults, (bookedAs + notes).trim() || null, quote.note,
      );
      saveNights(id, quote.nights);
      audit(null, 'booking_request', 'reservation', id);
      const s = getSettings();
      return { code: ref, nights, total: quote.total, room_type: type.name, deposit: paystackEnabled() && s.deposit_percent ? Math.ceil((quote.total * s.deposit_percent) / 100) : 0 };
    });
    res.status(201).json(result);
  }),
);

/**
 * "Manage my booking": a guest looks up their stay with the reference and the phone number used.
 * POST keeps the phone number out of URLs and logs. Answers are identical for "wrong code" and "wrong phone".
 */
publicApi.post(
  '/booking-lookup',
  h((req, res) => {
    rateLimit(`lookup:${req.ip}`, 10, 60 * 60_000);
    const b = body(req);
    const ref = str(b, 'code', { max: 12 }).toUpperCase().replace(/\s/g, '');
    const phone = str(b, 'phone', { max: 20, pattern: PHONE_RE }).replace(/\D/g, '');
    const r = get<{ code: string; status: string; check_in: string; check_out: string; nights: number; total: number; room_type: string; guest_phone: string; guest_name: string; paid: number }>(
      `SELECT r.code, r.status, r.check_in, r.check_out, r.nights, r.total, t.name AS room_type, g.phone AS guest_phone, g.name AS guest_name,
              COALESCE((SELECT SUM(amount) FROM payments p WHERE p.reservation_id = r.id), 0) AS paid
         FROM reservations r JOIN guests g ON g.id = r.guest_id JOIN room_types t ON t.id = r.room_type_id WHERE r.code = ?`,
      ref,
    );
    if (!r || r.guest_phone.replace(/\D/g, '') !== phone) throw new HttpError(404, "We couldn't find a booking with that reference and phone number.");
    res.json({
      code: r.code,
      status: r.status,
      check_in: r.check_in,
      check_out: r.check_out,
      nights: r.nights,
      room_type: r.room_type,
      total: r.total,
      paid: r.paid,
      first_name: r.guest_name.split(' ')[0],
    });
  }),
);
