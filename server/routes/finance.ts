import { Router } from 'express';
import { EXPENSE_CATEGORIES, EXPENSE_KEYS, FACILITIES, PAYMENT_METHODS, STREAMS, type StreamKey } from '../../shared/constants.ts';
import { allow, currentUser } from '../auth.ts';
import { all, audit, get, run } from '../db.ts';
import { HttpError, addDays, bad, body, date, daysBetween, h, int, oneOf, range, str, today } from '../lib.ts';

export const finance = Router();

// ---------- other income: gym, swimming pool, lounge & bar ----------

finance.get(
  '/facility-income',
  allow('manager', 'frontdesk'),
  h((req, res) => {
    const { from, to } = range(req);
    const rows = all(
      `SELECT f.id, f.facility, f.item, f.customer, f.amount, f.method, f.date, u.name AS recorded_by
         FROM facility_income f LEFT JOIN users u ON u.id = f.recorded_by
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
    const method = oneOf(b, 'method', PAYMENT_METHODS);
    // Front desk records today's takings only; back-dating is a manager decision.
    const when = user.role === 'manager' ? date(b, 'date', today()) : today();
    if (when > today()) throw bad('Date cannot be in the future');
    const { id } = run('INSERT INTO facility_income (facility, item, customer, amount, method, date, recorded_by) VALUES (?,?,?,?,?,?,?)', facility, item, customer || null, amount, method, when, user.id);
    audit(user.id, 'create', 'facility_income', id, { facility, amount });
    res.status(201).json({ id });
  }),
);

// ---------- expenses: salaries, diesel, NEPA, repairs… ----------

finance.get(
  '/expenses',
  allow('manager'),
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
  allow('manager'),
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
    const { id } = run('INSERT INTO expenses (date, category, description, paid_to, amount, method, recorded_by) VALUES (?,?,?,?,?,?,?)', when, category, description, paidTo || null, amount, method, user.id);
    audit(user.id, 'create', 'expense', id, { category, amount });
    res.status(201).json({ id });
  }),
);

finance.delete(
  '/expenses/:id',
  allow('manager'),
  h((req, res) => {
    const id = Number(req.params.id);
    const row = get('SELECT * FROM expenses WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'Expense not found');
    run('DELETE FROM expenses WHERE id = ?', id);
    // The full row is kept in the audit trail so a deletion can always be explained.
    audit(currentUser(req).id, 'delete', 'expense', id, row);
    res.json({ ok: true });
  }),
);

// ---------- profit & loss ----------

type Money = Record<string, number>;

export function profitAndLoss(from: string, to: string) {
  const revenue: Record<StreamKey, number> = { rooms: 0, drinks: 0, confectionery: 0, gym: 0, pool: 0, lounge: 0 };
  revenue.rooms = get<{ v: number }>('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE date BETWEEN ? AND ?', from, to)!.v;

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
    stockPurchases: get<{ v: number }>('SELECT COALESCE(SUM(total),0) v FROM purchases WHERE date BETWEEN ? AND ?', from, to)!.v,
    stockValue: get<{ v: number }>('SELECT COALESCE(SUM(stock * avg_cost),0) v FROM products WHERE active = 1')!.v,
  };
}

function dailySeries(from: string, to: string) {
  const days = new Map<string, { date: string; rooms: number; bar: number; facilities: number; expenses: number }>();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { date: d, rooms: 0, bar: 0, facilities: 0, expenses: 0 });
  const add = (sql: string, key: 'rooms' | 'bar' | 'facilities' | 'expenses') => {
    for (const r of all<{ date: string; v: number }>(sql, from, to)) {
      const day = days.get(r.date);
      if (day) day[key] = r.v;
    }
  };
  add('SELECT date, SUM(amount) v FROM payments WHERE date BETWEEN ? AND ? GROUP BY date', 'rooms');
  add('SELECT date, SUM(total) v FROM sales WHERE date BETWEEN ? AND ? GROUP BY date', 'bar');
  add('SELECT date, SUM(amount) v FROM facility_income WHERE date BETWEEN ? AND ? GROUP BY date', 'facilities');
  add('SELECT date, SUM(amount) v FROM expenses WHERE date BETWEEN ? AND ? GROUP BY date', 'expenses');
  return [...days.values()];
}

finance.get(
  '/reports/pnl',
  allow('manager'),
  h((req, res) => {
    const { from, to } = range(req);
    const days = daysBetween(from, to) + 1;
    const prevTo = addDays(from, -1);
    const prev = profitAndLoss(addDays(prevTo, -(days - 1)), prevTo);
    res.json({ ...profitAndLoss(from, to), previous: { from: prev.from, to: prev.to, totalRevenue: prev.totalRevenue, netProfit: prev.netProfit }, daily: days <= 120 ? dailySeries(from, to) : [] });
  }),
);

const csvCell = (v: string | number) => {
  const s = String(v);
  // Neutralise spreadsheet formula injection and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === 'string' ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

finance.get(
  '/reports/pnl.csv',
  allow('manager'),
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
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="danest-pnl-${from}-to-${to}.csv"`);
    res.send('﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'));
  }),
);

// ---------- dashboard ----------

finance.get(
  '/dashboard',
  allow('manager', 'frontdesk'),
  h((req, res) => {
    const t = today();
    const rooms = all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM rooms GROUP BY status');
    const count = (s: string) => rooms.find((r) => r.status === s)?.n ?? 0;
    const totalRooms = rooms.reduce((a, r) => a + r.n, 0);
    const sellable = totalRooms - count('maintenance');
    const ops = {
      date: t,
      rooms: { total: totalRooms, occupied: count('occupied'), available: count('available'), cleaning: count('cleaning'), maintenance: count('maintenance'), sellable },
      occupancy: sellable ? count('occupied') / sellable : 0,
      arrivals: get<{ n: number }>("SELECT COUNT(*) n FROM reservations WHERE check_in = ? AND status IN ('confirmed','pending')", t)!.n,
      departures: get<{ n: number }>("SELECT COUNT(*) n FROM reservations WHERE check_out <= ? AND status = 'checked_in'", t)!.n,
      requests: get<{ n: number }>("SELECT COUNT(*) n FROM reservations WHERE status = 'pending'")!.n,
      balances: get<{ n: number; v: number }>(
        `SELECT COUNT(*) n, COALESCE(SUM(bal),0) v FROM (
           SELECT r.total - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.reservation_id = r.id),0) bal
             FROM reservations r WHERE r.status = 'checked_in') WHERE bal > 0`,
      )!,
    };
    if (req.user?.role !== 'manager') return res.json({ ops });

    const monthStart = `${t.slice(0, 8)}01`;
    const from30 = addDays(t, -29);
    res.json({
      ops,
      today: profitAndLoss(t, t),
      month: profitAndLoss(monthStart, t),
      last30: dailySeries(from30, t),
      lowStock: all('SELECT id, name, stock, reorder_level, unit FROM products WHERE active = 1 AND stock <= reorder_level ORDER BY stock * 1.0 / MAX(reorder_level,1) LIMIT 8'),
    });
  }),
);
