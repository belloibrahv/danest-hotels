import { Router } from 'express';
import { allow, currentUser } from '../auth.ts';
import { lastClosedDate } from '../days.ts';
import { all, audit, get, run, tx } from '../db.ts';
import { HttpError, addDays, bad, body, date, h, int, isDate, str, today } from '../lib.ts';
import { collections, kpis, profitAndLoss } from './finance.ts';
import { CHARGES_SQL, PAID_SQL } from './reservations.ts';

/**
 * Night audit. Once a day the manager reviews what is left open (no-shows, guests past
 * their departure, unpaid bills), counts the cash drawer against what the system expects,
 * and closes the day. A closed day is locked against new or back-dated money.
 */
export const closeDay = Router();
const manager = allow('manager');

/**
 * Cash that left the drawer during the day: running costs, supplier bills and deliveries paid in
 * cash. Refunds are already netted out of what was collected.
 */
function paidOut(d: string) {
  const rows = all<{ what: string; v: number }>(
    `SELECT 'Expenses' what, COALESCE(SUM(amount),0) v FROM expenses WHERE method = 'cash' AND date = ?1
     UNION ALL SELECT 'Supplier bills', COALESCE(SUM(amount),0) FROM supplier_payments WHERE method = 'cash' AND date = ?1
     UNION ALL SELECT 'Stock paid on delivery', COALESCE(SUM(total),0) FROM purchases WHERE status = 'received' AND terms = 'cash' AND date = ?1`,
    d,
  ).filter((r) => r.v > 0);
  return { lines: rows, total: rows.reduce((a, r) => a + r.v, 0) };
}

export function dayReport(d: string) {
  const p = profitAndLoss(d, d);
  const c = collections(d, d);
  const out = paidOut(d);
  return {
    revenue: p.revenue,
    totalRevenue: p.totalRevenue,
    expenses: p.operating.reduce((a, x) => a + x.amount, 0) + p.costOfSales.filter((c) => !c.key.startsWith('cogs')).reduce((a, x) => a + x.amount, 0),
    kpis: kpis(d, d),
    collections: c,
    paid_out: out,
    // What should be in the drawer: cash taken in, less cash paid out of it.
    expected_cash: (c.byMethod.cash ?? 0) - out.total,
    arrivals: get<{ n: number }>("SELECT COUNT(*) n FROM reservations WHERE check_in = ? AND status IN ('checked_in','checked_out')", d)!.n,
    departures: get<{ n: number }>("SELECT COUNT(*) n FROM reservations WHERE status = 'checked_out' AND date(checked_out_at, '+1 hour') = ?", d)!.n,
  };
}

/** Bookings that must be settled before a day can close: guests who never arrived, and guests past their departure. */
function openStays(d: string) {
  return {
    no_shows: all(
      `SELECT r.id, r.code, r.check_in, r.status, g.name AS guest_name, t.name AS room_type
         FROM reservations r JOIN guests g ON g.id = r.guest_id JOIN room_types t ON t.id = r.room_type_id
        WHERE r.status IN ('pending','confirmed') AND r.check_in <= ? ORDER BY r.check_in`,
      d,
    ),
    overdue: all(
      `SELECT r.id, r.code, r.check_out, g.name AS guest_name, rm.number AS room_number, r.total + ${CHARGES_SQL} - ${PAID_SQL} AS balance
         FROM reservations r JOIN guests g ON g.id = r.guest_id LEFT JOIN rooms rm ON rm.id = r.room_id
        WHERE r.status = 'checked_in' AND r.check_out <= ? ORDER BY r.check_out`,
      d,
    ),
  };
}

closeDay.get(
  '/close-day',
  allow('manager', 'accountant', 'auditor'),
  h((req, res) => {
    const t = today();
    const last = lastClosedDate();
    const suggested = last ? (addDays(last, 1) > t ? t : addDays(last, 1)) : t;
    const d = isDate(req.query.date) ? req.query.date : suggested;
    if (d > t) throw bad('You can only close today or earlier');
    const closure = get<Record<string, unknown> & { summary: string }>(
      'SELECT c.*, u.name AS closed_by_name FROM day_closures c JOIN users u ON u.id = c.closed_by WHERE c.date = ?',
      d,
    );
    res.json({
      date: d,
      today: t,
      last_closed: last,
      closed: closure ? { ...closure, summary: JSON.parse(closure.summary) } : null,
      checks: {
        ...openStays(d),
        unpaid: all(
          `SELECT * FROM (SELECT r.id, r.code, g.name AS guest_name, rm.number AS room_number, r.total + ${CHARGES_SQL} - ${PAID_SQL} AS balance
             FROM reservations r JOIN guests g ON g.id = r.guest_id LEFT JOIN rooms rm ON rm.id = r.room_id
            WHERE r.status = 'checked_in') WHERE balance > 0 ORDER BY balance DESC`,
        ),
        dirty_rooms: get<{ n: number }>("SELECT COUNT(*) n FROM rooms WHERE active = 1 AND status = 'cleaning'")!.n,
      },
      report: dayReport(d),
      history: all(
        `SELECT c.date, c.expected_cash, c.counted_cash, c.variance, c.closed_at, u.name AS closed_by_name
           FROM day_closures c JOIN users u ON u.id = c.closed_by ORDER BY c.date DESC LIMIT 14`,
      ),
    });
  }),
);

closeDay.post(
  '/close-day',
  manager,
  h((req, res) => {
    const user = currentUser(req);
    const b = body(req);
    const d = date(b, 'date');
    const counted = int(b, 'counted_cash', { min: 0, max: 1_000_000_000 });
    const notes = str(b, 'notes', { max: 500, optional: true });
    const result = tx(() => {
      const t = today();
      if (d > t) throw bad('You can only close today or earlier');
      const last = lastClosedDate();
      if (last && d <= last) throw new HttpError(409, `The books are already closed up to ${last}`);
      if (last && d !== addDays(last, 1)) throw new HttpError(409, `Close ${addDays(last, 1)} first — days are closed in order.`);
      // A stay left open would later post room nights (or drop them) on a day that is already locked.
      const { no_shows, overdue } = openStays(d);
      if (no_shows.length || overdue.length) {
        const parts = [no_shows.length && `${no_shows.length} not arrived`, overdue.length && `${overdue.length} past departure`].filter(Boolean);
        throw new HttpError(409, `Sort out every booking before closing (${parts.join(', ')}): check in, mark as no-show, extend or check out.`);
      }
      const report = dayReport(d);
      const expected = report.collections.byMethod;
      const variance = counted - report.expected_cash;
      if (variance !== 0 && !notes) throw bad('The cash count does not match. Add a note explaining the difference.');
      run(
        `INSERT INTO day_closures (date, closed_by, expected_cash, counted_cash, expected_transfer, expected_pos, variance, notes, summary)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        d, user.id, report.expected_cash, counted, expected.transfer ?? 0, expected.pos ?? 0, variance, notes || null, JSON.stringify(report),
      );
      audit(user.id, variance === 0 ? 'close_day' : 'close_day_with_variance', 'day', null, { date: d, variance, closed_from: last });
      return { date: d, variance };
    });
    res.status(201).json(result);
  }),
);

/** Only the most recent closed day can be reopened, and only with a reason. */
closeDay.post(
  '/close-day/reopen',
  manager,
  h((req, res) => {
    const user = currentUser(req);
    const reason = str(body(req), 'reason', { max: 300, min: 5 });
    const last = lastClosedDate();
    if (!last) throw new HttpError(409, 'No closed days to reopen');
    tx(() => {
      run('DELETE FROM day_closures WHERE date = ?', last);
      audit(user.id, 'reopen_day', 'day', null, { date: last, reason });
    });
    res.json({ reopened: last });
  }),
);
