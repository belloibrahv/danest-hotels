import { Router } from 'express';
import { all, audit, get, run, tx } from '../db.ts';
import { rateLimit } from '../auth.ts';
import { EMAIL_RE, HttpError, PHONE_RE, bad, body, code, date, h, int, isDate, str, today, addDays } from '../lib.ts';
import { availabilityByType, validateStay } from './reservations.ts';

/** Unauthenticated endpoints used by the guest website. Read-mostly; the one write is rate limited. */
export const publicApi = Router();

publicApi.get(
  '/room-types',
  h((req, res) => {
    const checkIn = isDate(req.query.check_in) ? req.query.check_in : today();
    const checkOut = isDate(req.query.check_out) && req.query.check_out > checkIn ? req.query.check_out : addDays(checkIn, 1);
    const free = availabilityByType(checkIn, checkOut);
    const types = all<{ id: number; amenities: string }>('SELECT id, name, slug, rate, capacity, description, amenities FROM room_types ORDER BY rate');
    res.json(types.map((t) => ({ ...t, amenities: JSON.parse(t.amenities), available: free.get(t.id) ?? 0 })));
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
      const type = get<{ rate: number; capacity: number; name: string }>('SELECT rate, capacity, name FROM room_types WHERE id = ?', typeId);
      if (!type) throw bad('Please choose a room type');
      if (adults > type.capacity) throw bad(`The ${type.name} sleeps up to ${type.capacity}`);
      if ((availabilityByType(checkIn, checkOut).get(typeId) ?? 0) < 1) {
        throw new HttpError(409, `The ${type.name} is fully booked for those dates. Please try other dates or call us.`);
      }
      const guestId = run('INSERT INTO guests (name, phone, email) VALUES (?,?,?)', name, phone, email || null).id;
      const ref = code('DH');
      const { id } = run(
        `INSERT INTO reservations (code, guest_id, room_type_id, check_in, check_out, nights, rate, total, adults, status, source, notes)
         VALUES (?,?,?,?,?,?,?,?,?,'pending','website',?)`,
        ref, guestId, typeId, checkIn, checkOut, nights, type.rate, type.rate * nights, adults, notes || null,
      );
      audit(null, 'booking_request', 'reservation', id);
      return { code: ref, nights, total: type.rate * nights, room_type: type.name };
    });
    res.status(201).json(result);
  }),
);
