import { Router } from 'express';
import { BOOKS, CHARGE_METHODS, isManager, EXPENSE_CATEGORIES, EXPENSE_KEYS, FACILITIES, PAYMENT_METHODS, STREAMS, type StreamKey } from '../../shared/constants.ts';
import { inHouse } from './inventory.ts';
import { assertOpen, lastClosedDate } from '../days.ts';
import { CHARGES_SQL, PAID_SQL } from './reservations.ts';
import { allow, currentUser } from '../auth.ts';
import { csv } from '../csv.ts';
import { periodTaxes } from '../tax.ts';
import { all, audit, get, run, tx } from '../db.ts';
import { HttpError, addDays, bad, body, date, daysBetween, h, int, oneOf, range, str, today } from '../lib.ts';

export const finance = Router();

// ---------- other income: gym, swimming pool, lounge & bar ----------

finance.get(
  '/facility-income',
  allow('manager', 'frontdesk', 'accountant', 'auditor'),
  h((req, res) => {
    const { from, to } = range(req);
    const rows = all(
      `SELECT f.id, f.facility, f.item, COALESCE(f.customer, g.name) AS customer, f.amount, f.method, f.date, u.name AS recorded_by, rm.number AS room_number
         FROM facility_income f LEFT JOIN users u ON u.id = f.recorded_by
         LEFT JOIN reservations r ON r.id = f.reservation_id LEFT JOIN rooms rm ON rm.id = r.room_id LEFT JOIN guests g ON g.id = r.guest_id
        WHERE f.date BETWEEN ? AND ? ORDER BY f.date DESC, f.id DESC LIMIT 500`,
      from,
      to,
    );
    const totals = all('SELECT facility, SUM(amount) AS total, COUNT(*) AS count FROM facility_income WHERE date BETWEEN ? AND ? GROUP BY facility', from, to);
    res.json({ from, to, rows, totals });
  }),
);

finance.post(
  '/facility-income',
  allow('manager', 'frontdesk'),
  h((req, res) => {
    const user = currentUser(req);
    const b = body(req);
    const facility = oneOf(b, 'facility', FACILITIES);
    const item = str(b, 'item', { max: 120 });
    const customer = str(b, 'customer', { max: 120, optional: true });
    const amount = int(b, 'amount', { min: 1, max: 50_000_000 });
    const method = oneOf(b, 'method', CHARGE_METHODS);
    // Front desk records today's takings only; back-dating is a manager decision.
    const when = isManager(user.role) && method !== 'room' ? date(b, 'date', today()) : today();
    if (when > today()) throw bad('Date cannot be in the future');
    assertOpen(when);
    const reservationId = method === 'room' ? inHouse(b.reservation_id) : null;
    const { id } = run(
      'INSERT INTO facility_income (facility, item, customer, amount, method, reservation_id, date, recorded_by) VALUES (?,?,?,?,?,?,?,?)',
      facility, item, customer || null, amount, method, reservationId, when, user.id,
    );
    audit(user.id, 'create', 'facility_income', id, { facility, amount, reservation_id: reservationId ?? undefined });
    res.status(201).json({ id });
  }),
);

/** Void a mistaken entry on an open day. The full row is kept in the activity log. */
finance.post(
  '/facility-income/:id/void',
  allow('manager'),
  h((req, res) => {
    const id = Number(req.params.id);
    const reason = str(body(req), 'reason', { min: 3, max: 200 });
    tx(() => {
      const row = get<{ date: string; reservation_id: number | null }>('SELECT * FROM facility_income WHERE id = ?', id);
      if (!row) throw new HttpError(404, 'Entry not found');
      assertOpen(row.date);
      if (row.reservation_id && !get("SELECT 1 FROM reservations WHERE id = ? AND status = 'checked_in'", row.reservation_id)) {
        throw new HttpError(409, 'The guest has checked out, so their bill is closed. Give the money back as a refund instead.');
      }
      run('DELETE FROM facility_income WHERE id = ?', id);
      audit(currentUser(req).id, 'void', 'facility_income', id, { reason, ...row });
    });
    res.json({ ok: true });
  }),
);

// ---------- expenses: salaries, diesel, NEPA, repairs… ----------

finance.get(
  '/expenses',
  allow(...BOOKS),
  h((req, res) => {
    const { from, to } = range(req);
    const rows = all(
      `SELECT e.id, e.date, e.category, e.description, e.paid_to, e.amount, e.method, u.name AS recorded_by
         FROM expenses e LEFT JOIN users u ON u.id = e.recorded_by
        WHERE e.date BETWEEN ? AND ? ORDER BY e.date DESC, e.id DESC LIMIT 500`,
      from,
      to,
    );
    const totals = all('SELECT category, SUM(amount) AS total FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC', from, to);
    res.json({ from, to, rows, totals });
  }),
);

finance.post(
  '/expenses',
  allow('manager', 'accountant'),
  h((req, res) => {
    const user = currentUser(req);
    const b = body(req);
    const category = oneOf(b, 'category', EXPENSE_KEYS);
    const description = str(b, 'description', { max: 200 });
    const paidTo = str(b, 'paid_to', { max: 120, optional: true });
    const amount = int(b, 'amount', { min: 1, max: 500_000_000 });
    const method = oneOf(b, 'method', PAYMENT_METHODS);
    const when = date(b, 'date', today());
    if (when > today()) throw bad('Date cannot be in the future');
    assertOpen(when);
    const { id } = run('INSERT INTO expenses (date, category, description, paid_to, amount, method, recorded_by) VALUES (?,?,?,?,?,?,?)', when, category, description, paidTo || null, amount, method, user.id);
    audit(user.id, 'create', 'expense', id, { category, amount });
    res.status(201).json({ id });
  }),
);

finance.delete(
  '/expenses/:id',
  allow('manager', 'accountant'),
  h((req, res) => {
    const id = Number(req.params.id);
    const row = get<{ date: string }>('SELECT * FROM expenses WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'Expense not found');
    assertOpen(row.date);
    run('DELETE FROM expenses WHERE id = ?', id);
    // The full row is kept in the audit trail so a deletion can always be explained.
    audit(currentUser(req).id, 'delete', 'expense', id, row);
    res.json({ ok: true });
  }),
);

// ---------- profit & loss ----------

type Money = Record<string, number>;

/**
 * Room revenue is earned night by night (the way a night audit posts it), not when cash arrives:
 * each night a guest is in house earns that stay's nightly rate. Future nights don't count yet.
 */
export function roomNightsByDay(from: string, to: string) {
  return all<{ date: string; nights: number; revenue: number }>(
    `WITH RECURSIVE d(day) AS (SELECT ? UNION ALL SELECT date(day, '+1 day') FROM d WHERE day < ?)
     SELECT d.day AS date, COUNT(n.reservation_id) AS nights, COALESCE(SUM(n.rate), 0) AS revenue
       FROM d LEFT JOIN (
         SELECT rn.reservation_id, rn.date, rn.rate FROM reservation_nights rn
           JOIN reservations r ON r.id = rn.reservation_id AND r.status IN ('checked_in','checked_out')
       ) n ON n.date = d.day AND d.day <= ?
      GROUP BY d.day ORDER BY d.day`,
    from,
    to,
    today(),
  );
}

/** Deposits kept when a booking was cancelled or the guest didn't arrive. Not room-night revenue, so ADR stays honest. */
const retainedBetween = (from: string, to: string) =>
  get<{ v: number }>("SELECT COALESCE(SUM(retained), 0) v FROM reservations WHERE status = 'cancelled' AND cancelled_on BETWEEN ? AND ?", from, to)!.v;

/** The three numbers every hotel owner and investor asks for. */
export function kpis(from: string, to: string) {
  const nightsByDay = roomNightsByDay(from, to);
  const elapsed = nightsByDay.filter((d) => d.date <= today()).length;
  const rooms = get<{ n: number }>('SELECT COUNT(*) n FROM rooms WHERE active = 1')!.n;
  const sold = nightsByDay.reduce((a, d) => a + d.nights, 0);
  const revenue = nightsByDay.reduce((a, d) => a + d.revenue, 0);
  const available = rooms * elapsed;
  return {
    roomNightsSold: sold,
    roomNightsAvailable: available,
    occupancy: available ? sold / available : 0,
    adr: sold ? Math.round(revenue / sold) : 0, // average daily rate: what a sold room earns per night
    revpar: available ? Math.round(revenue / available) : 0, // revenue per available room per night
  };
}

/**
 * Money actually received, by how it was paid, less money given back. Room-charged sales aren't
 * cash until the folio is settled. A cash refund comes out of the drawer, so it lowers expected cash.
 */
export function collections(from: string, to: string) {
  const rows = all<{ source: string; method: string; v: number }>(
    `SELECT 'Room bills' AS source, method, SUM(amount) v FROM payments WHERE method <> 'company' AND date BETWEEN ?1 AND ?2 GROUP BY method
     UNION ALL SELECT 'Bar & shop', method, SUM(total) FROM sales WHERE method <> 'room' AND date BETWEEN ?1 AND ?2 GROUP BY method
     UNION ALL SELECT 'Gym, pool & lounge', method, SUM(amount) FROM facility_income WHERE method <> 'room' AND date BETWEEN ?1 AND ?2 GROUP BY method
     UNION ALL SELECT 'Company accounts', method, SUM(amount) FROM company_payments WHERE date BETWEEN ?1 AND ?2 GROUP BY method
     UNION ALL SELECT 'Refunds', method, -SUM(amount) FROM refunds WHERE date BETWEEN ?1 AND ?2 GROUP BY method`,
    from,
    to,
  );
  const byMethod = { cash: 0, transfer: 0, pos: 0, online: 0 } as Money;
  const bySource: Money = {};
  for (const r of rows) {
    byMethod[r.method] = (byMethod[r.method] ?? 0) + r.v;
    bySource[r.source] = (bySource[r.source] ?? 0) + r.v;
  }
  return { byMethod, bySource, total: rows.reduce((a, r) => a + r.v, 0) };
}

export function profitAndLoss(from: string, to: string) {
  const revenue: Record<StreamKey, number> = { rooms: 0, drinks: 0, confectionery: 0, cancellations: 0, gym: 0, pool: 0, lounge: 0 };
  revenue.rooms = roomNightsByDay(from, to).reduce((a, d) => a + d.revenue, 0);
  revenue.cancellations = retainedBetween(from, to);

  const cogs: Money = { drinks: 0, confectionery: 0 };
  for (const r of all<{ category: 'drinks' | 'confectionery'; sales: number; cost: number }>(
    `SELECT p.category, SUM(si.qty * si.unit_price) sales, SUM(si.qty * si.unit_cost) cost
       FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
      WHERE s.date BETWEEN ? AND ? GROUP BY p.category`,
    from,
    to,
  )) {
    revenue[r.category] = r.sales;
    cogs[r.category] = r.cost;
  }
  for (const r of all<{ facility: 'gym' | 'pool' | 'lounge'; v: number }>('SELECT facility, SUM(amount) v FROM facility_income WHERE date BETWEEN ? AND ? GROUP BY facility', from, to)) {
    revenue[r.facility] = r.v;
  }

  const byCategory = new Map(all<{ category: string; v: number }>('SELECT category, SUM(amount) v FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category', from, to).map((r) => [r.category, r.v]));
  const direct = EXPENSE_CATEGORIES.filter((c) => c.kind === 'direct').map((c) => ({ key: c.key, label: c.label, amount: byCategory.get(c.key) ?? 0 }));
  const operating = EXPENSE_CATEGORIES.filter((c) => c.kind === 'operating').map((c) => ({ key: c.key, label: c.label, amount: byCategory.get(c.key) ?? 0 }));

  const totalRevenue = Object.values(revenue).reduce((a, b) => a + b, 0);
  const costOfSales = cogs.drinks + cogs.confectionery + direct.reduce((a, c) => a + c.amount, 0);
  const grossProfit = totalRevenue - costOfSales;
  const totalOperating = operating.reduce((a, c) => a + c.amount, 0);

  return {
    from,
    to,
    revenue: STREAMS.map((s) => ({ key: s.key, label: s.label, group: s.group, amount: revenue[s.key] })),
    totalRevenue,
    costOfSales: [
      { key: 'cogs_drinks', label: 'Drinks sold (at cost)', amount: cogs.drinks },
      { key: 'cogs_confectionery', label: 'Confectionery sold (at cost)', amount: cogs.confectionery },
      ...direct,
    ],
    totalCostOfSales: costOfSales,
    grossProfit,
    operating,
    totalOperating,
    netProfit: grossProfit - totalOperating,
    kpis: kpis(from, to),
    collections: collections(from, to),
    stockPurchases: get<{ v: number }>("SELECT COALESCE(SUM(total),0) v FROM purchases WHERE status = 'received' AND date BETWEEN ? AND ?", from, to)!.v,
    stockValue: get<{ v: number }>('SELECT COALESCE(SUM(stock * avg_cost),0) v FROM products WHERE active = 1')!.v,
    // Memo: the tax inside that revenue, which belongs to government.
    taxes: periodTaxes(STREAMS.map((s) => ({ key: s.key, amount: revenue[s.key] }))).taxes,
  };
}

function dailySeries(from: string, to: string) {
  const days = new Map<string, { date: string; rooms: number; bar: number; facilities: number; expenses: number; occupied: number }>();
  for (const n of roomNightsByDay(from, to)) days.set(n.date, { date: n.date, rooms: n.revenue, occupied: n.nights, bar: 0, facilities: 0, expenses: 0 });
  const add = (sql: string, key: 'bar' | 'facilities' | 'expenses') => {
    for (const r of all<{ date: string; v: number }>(sql, from, to)) {
      const day = days.get(r.date);
      if (day) day[key] = r.v;
    }
  };
  for (const r of all<{ date: string; v: number }>("SELECT cancelled_on AS date, SUM(retained) v FROM reservations WHERE status = 'cancelled' AND cancelled_on BETWEEN ? AND ? GROUP BY cancelled_on", from, to)) {
    const day = days.get(r.date);
    if (day) day.rooms += r.v;
  }
  add('SELECT date, SUM(total) v FROM sales WHERE date BETWEEN ? AND ? GROUP BY date', 'bar');
  add('SELECT date, SUM(amount) v FROM facility_income WHERE date BETWEEN ? AND ? GROUP BY date', 'facilities');
  add('SELECT date, SUM(amount) v FROM expenses WHERE date BETWEEN ? AND ? GROUP BY date', 'expenses');
  return [...days.values()];
}

finance.get(
  '/reports/pnl',
  allow(...BOOKS),
  h((req, res) => {
    const { from, to } = range(req);
    const days = daysBetween(from, to) + 1;
    const prevTo = addDays(from, -1);
    const prev = profitAndLoss(addDays(prevTo, -(days - 1)), prevTo);
    res.json({
      ...profitAndLoss(from, to),
      previous: { from: prev.from, to: prev.to, totalRevenue: prev.totalRevenue, netProfit: prev.netProfit, kpis: prev.kpis },
      daily: days <= 120 ? dailySeries(from, to) : [],
      rooms: get<{ n: number }>('SELECT COUNT(*) n FROM rooms WHERE active = 1')!.n,
    });
  }),
);

finance.get(
  '/reports/pnl.csv',
  allow(...BOOKS),
  h((req, res) => {
    const { from, to } = range(req);
    const p = profitAndLoss(from, to);
    const rows: (string | number)[][] = [['Danest Hotel & Suites — Profit & Loss'], [`${from} to ${to}`], [], ['Section', 'Line', 'Amount (NGN)']];
    for (const r of p.revenue) rows.push(['Revenue', r.label, r.amount]);
    rows.push(['Revenue', 'Total revenue', p.totalRevenue]);
    for (const r of p.costOfSales) rows.push(['Cost of sales', r.label, r.amount]);
    rows.push(['Cost of sales', 'Total cost of sales', p.totalCostOfSales], ['', 'Gross profit', p.grossProfit]);
    for (const r of p.operating) rows.push(['Operating expenses', r.label, r.amount]);
    rows.push(['Operating expenses', 'Total operating expenses', p.totalOperating], ['', 'Net profit', p.netProfit], [], ['Memo', 'Stock purchased in period', p.stockPurchases], ['Memo', 'Closing stock value (at cost)', p.stockValue]);
    for (const t of p.taxes) rows.push(['Memo', `${t.name} (${t.rate}%) included in revenue`, t.amount]);
    rows.push([], ['KPI', 'Room-nights sold', p.kpis.roomNightsSold], ['KPI', 'Occupancy %', Math.round(p.kpis.occupancy * 1000) / 10], ['KPI', 'ADR (average daily rate)', p.kpis.adr], ['KPI', 'RevPAR', p.kpis.revpar]);
    rows.push([], ['Collected', 'Cash', p.collections.byMethod.cash], ['Collected', 'Bank transfer', p.collections.byMethod.transfer], ['Collected', 'POS / card', p.collections.byMethod.pos], ['Collected', 'Paid online (Paystack)', p.collections.byMethod.online ?? 0], ['Collected', 'Total collected', p.collections.total]);
    csv(res, `danest-pnl-${from}-to-${to}.csv`, rows);
  }),
);

// ---------- dashboard ----------

finance.get(
  '/dashboard',
  allow('manager', 'frontdesk'),
  h((req, res) => {
    const t = today();
    const rooms = all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM rooms WHERE active = 1 GROUP BY status');
    const count = (s: string) => rooms.find((r) => r.status === s)?.n ?? 0;
    const totalRooms = rooms.reduce((a, r) => a + r.n, 0);
    const sellable = totalRooms - count('maintenance');
    const ops = {
      date: t,
      last_closed: lastClosedDate(),
      rooms: { total: totalRooms, occupied: count('occupied'), available: count('available'), cleaning: count('cleaning'), maintenance: count('maintenance'), sellable },
      occupancy: sellable ? count('occupied') / sellable : 0,
      arrivals: get<{ n: number }>("SELECT COUNT(*) n FROM reservations WHERE check_in = ? AND status IN ('confirmed','pending')", t)!.n,
      departures: get<{ n: number }>("SELECT COUNT(*) n FROM reservations WHERE check_out <= ? AND status = 'checked_in'", t)!.n,
      requests: get<{ n: number }>("SELECT COUNT(*) n FROM reservations WHERE status = 'pending'")!.n,
      balances: get<{ n: number; v: number }>(
        `SELECT COUNT(*) n, COALESCE(SUM(bal),0) v FROM (
           SELECT r.total + ${CHARGES_SQL} - ${PAID_SQL} bal FROM reservations r WHERE r.status = 'checked_in') WHERE bal > 0`,
      )!,
      // "On the books": how full the next two weeks already are. Requests are shown separately — they aren't promised yet.
      forecast: all<{ date: string; booked: number; requested: number }>(
        `WITH RECURSIVE d(day) AS (SELECT ? UNION ALL SELECT date(day, '+1 day') FROM d WHERE day < date(?, '+13 day'))
         SELECT d.day AS date,
                SUM(CASE WHEN r.status IN ('confirmed','checked_in') THEN 1 ELSE 0 END) AS booked,
                SUM(CASE WHEN r.status = 'pending' THEN 1 ELSE 0 END) AS requested
           FROM d LEFT JOIN reservations r ON r.check_in <= d.day AND r.check_out > d.day AND r.status IN ('pending','confirmed','checked_in')
          GROUP BY d.day ORDER BY d.day`,
        t,
        t,
      ),
      arrivalsList: all(
        `SELECT r.id, g.name AS guest_name, g.vip, t.name AS room_type, rm.number AS room_number, r.status, r.nights
           FROM reservations r JOIN guests g ON g.id = r.guest_id JOIN room_types t ON t.id = r.room_type_id LEFT JOIN rooms rm ON rm.id = r.room_id
          WHERE r.check_in = ? AND r.status IN ('confirmed','pending') ORDER BY g.vip DESC, g.name LIMIT 12`,
        t,
      ),
    };
    if (req.user?.role !== 'manager') return res.json({ ops });

    const monthStart = `${t.slice(0, 8)}01`;
    const from30 = addDays(t, -29);
    res.json({
      ops,
      today: profitAndLoss(t, t),
      month: profitAndLoss(monthStart, t),
      collectedToday: collections(t, t),
      last30: dailySeries(from30, t),
      lowStock: all('SELECT id, name, stock, reorder_level, unit FROM products WHERE active = 1 AND stock <= reorder_level ORDER BY stock * 1.0 / MAX(reorder_level,1) LIMIT 8'),
    });
  }),
);
