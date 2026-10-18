import { Router } from 'express';
import { BOOKS, EXPENSE_CATEGORIES, EXPENSE_KEYS, OUTLET_LABELS, TARGET_KEYS, isManager, type Outlet } from '../../shared/constants.ts';
import { allow, currentUser } from '../auth.ts';
import { lastClosedDate } from '../days.ts';
import { all, audit, get, run } from '../db.ts';
import { HttpError, addDays, bad, body, daysBetween, h, int, isDate, range, str, today } from '../lib.ts';
import { csv } from '../csv.ts';
import { profitAndLoss } from './finance.ts';
import { periodTaxes } from '../tax.ts';
import { chartOfAccounts, journal, trialBalance } from '../ledger.ts';
import { getSettings } from '../settings.ts';
import { AGING, bucketOf, payables } from './purchasing.ts';
import { CHARGES_SQL, PAID_SQL } from './reservations.ts';

/**
 * The accountant's books: every naira in and out (the cash book), who owes the hotel
 * (receivables), who the hotel owes (payables), and the month's budget against what was spent.
 * The auditor reads all of it; only the accountant and management write.
 */
export const accounts = Router();
const books = allow(...BOOKS);

const EXPENSE_LABEL = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.key, c.label]));

// ---------- cash book ----------

export type CashRow = { dir: 'in' | 'out'; date: string; at: string; source: string; ref: string | null; party: string | null; method: string; amount: number; by: string | null; entity: string; entity_id: number };

export function cashbook(from: string, to: string): CashRow[] {
  const rows = all<CashRow & { detail: string | null }>(
    `SELECT 'in' AS dir, p.date, p.created_at AS at, 'room' AS source, r.code AS ref, g.name AS party, p.method, p.amount, u.name AS by, 'reservation' AS entity, r.id AS entity_id, NULL AS detail
       FROM payments p JOIN reservations r ON r.id = p.reservation_id JOIN guests g ON g.id = r.guest_id LEFT JOIN users u ON u.id = p.received_by
      WHERE p.method <> 'company' AND p.date BETWEEN :from AND :to
     UNION ALL
     SELECT 'in', s.date, s.created_at, 'bar', s.receipt_no, NULL, s.method, s.total, u.name, 'sale', s.id, NULL
       FROM sales s LEFT JOIN users u ON u.id = s.staff_id WHERE s.method <> 'room' AND s.date BETWEEN :from AND :to
     UNION ALL
     SELECT 'in', f.date, f.created_at, 'facility', f.item, f.customer, f.method, f.amount, u.name, 'facility_income', f.id, f.facility
       FROM facility_income f LEFT JOIN users u ON u.id = f.recorded_by WHERE f.method <> 'room' AND f.date BETWEEN :from AND :to
     UNION ALL
     SELECT 'in', cp.date, cp.created_at, 'company', cp.reference, c.name, cp.method, cp.amount, u.name, 'company', c.id, NULL
       FROM company_payments cp JOIN companies c ON c.id = cp.company_id LEFT JOIN users u ON u.id = cp.received_by WHERE cp.date BETWEEN :from AND :to
     UNION ALL
     SELECT 'out', rf.date, rf.created_at, 'refund', r.code, g.name, rf.method, rf.amount, u.name, 'reservation', r.id, rf.reason
       FROM refunds rf JOIN reservations r ON r.id = rf.reservation_id JOIN guests g ON g.id = r.guest_id LEFT JOIN users u ON u.id = rf.refunded_by
      WHERE rf.date BETWEEN :from AND :to
     UNION ALL
     SELECT 'out', e.date, e.created_at, 'expense', e.description, e.paid_to, e.method, e.amount, u.name, 'expense', e.id, e.category
       FROM expenses e LEFT JOIN users u ON u.id = e.recorded_by WHERE e.date BETWEEN :from AND :to
     UNION ALL
     SELECT 'out', sp.date, sp.created_at, 'supplier', pu.ref, pu.supplier, sp.method, sp.amount, u.name, 'purchase', pu.id, sp.reference
       FROM supplier_payments sp JOIN purchases pu ON pu.id = sp.purchase_id LEFT JOIN users u ON u.id = sp.paid_by WHERE sp.date BETWEEN :from AND :to
     UNION ALL
     SELECT 'out', pu.date, COALESCE(pu.received_at, pu.created_at), 'stock', pu.ref, pu.supplier, pu.terms, pu.total, u.name, 'purchase', pu.id, NULL
       FROM purchases pu LEFT JOIN users u ON u.id = pu.received_by
      WHERE pu.status = 'received' AND pu.terms IN ('cash','transfer','pos') AND pu.total > 0 AND pu.date BETWEEN :from AND :to
     ORDER BY date, at`,
    { from, to },
  );
  return rows.map(({ detail, ...r }) => ({
    ...r,
    source:
      r.source === 'room' ? 'Room bill'
      : r.source === 'bar' ? 'Bar & shop'
      : r.source === 'facility' ? OUTLET_LABELS[detail as Outlet] ?? 'Facilities'
      : r.source === 'company' ? 'Company account'
      : r.source === 'refund' ? `Refund${detail ? ` — ${detail}` : ''}`
      : r.source === 'expense' ? EXPENSE_LABEL[detail ?? ''] ?? 'Expense'
      : r.source === 'supplier' ? 'Supplier bill paid'
      : 'Stock paid on delivery',
  }));
}

/** Cash goes in the drawer; transfers, card and online payments land in the bank. */
const ACCOUNT_OF = (method: string) => (method === 'cash' ? 'cash' : 'bank');

function summarise(rows: CashRow[]) {
  const by = (pred: (r: CashRow) => boolean) => rows.filter(pred).reduce((a, r) => a + r.amount, 0);
  const methods = ['cash', 'transfer', 'pos', 'online'].map((m) => {
    const inn = by((r) => r.method === m && r.dir === 'in');
    const out = by((r) => r.method === m && r.dir === 'out');
    return { method: m, in: inn, out, net: inn - out };
  });
  const accounts = (['cash', 'bank'] as const).map((a) => {
    const inn = by((r) => ACCOUNT_OF(r.method) === a && r.dir === 'in');
    const out = by((r) => ACCOUNT_OF(r.method) === a && r.dir === 'out');
    return { account: a, in: inn, out, net: inn - out };
  });
  const inn = by((r) => r.dir === 'in');
  const out = by((r) => r.dir === 'out');
  return { in: inn, out, net: inn - out, methods, accounts };
}

function daily(rows: CashRow[], from: string, to: string) {
  const days = new Map<string, { date: string; in: number; out: number; net: number }>();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { date: d, in: 0, out: 0, net: 0 });
  for (const r of rows) {
    const d = days.get(r.date)!;
    d[r.dir] += r.amount;
    d.net += r.dir === 'in' ? r.amount : -r.amount;
  }
  return [...days.values()];
}

accounts.get(
  '/accounts/cashbook',
  books,
  h((req, res) => {
    const { from, to } = range(req);
    const method = typeof req.query.method === 'string' ? req.query.method : '';
    const all_ = cashbook(from, to);
    const rows = method ? all_.filter((r) => (method === 'bank' ? ACCOUNT_OF(r.method) === 'bank' : r.method === method)) : all_;
    // Purchases from before bills were tracked don't say how they were paid, so they can't sit in a channel.
    const untracked = get<{ v: number }>("SELECT COALESCE(SUM(total),0) v FROM purchases WHERE status = 'received' AND terms IS NULL AND date BETWEEN ? AND ?", from, to)!.v;
    res.json({ from, to, summary: summarise(all_), daily: daysBetween(from, to) <= 366 ? daily(all_, from, to) : [], rows: rows.slice(-2000).reverse(), untracked_purchases: untracked });
  }),
);

accounts.get(
  '/accounts/cashbook.csv',
  books,
  h((req, res) => {
    const { from, to } = range(req);
    const rows = cashbook(from, to);
    const s = summarise(rows);
    csv(res, `danest-cashbook-${from}-to-${to}.csv`, [
      ['Danest Hotel & Suites — Cash book'],
      [`${from} to ${to}`],
      [],
      ['Date', 'Time (UTC)', 'In / Out', 'Source', 'Reference', 'Party', 'Method', 'Money in', 'Money out', 'Recorded by'],
      ...rows.map((r) => [r.date, r.at.slice(11, 16), r.dir === 'in' ? 'In' : 'Out', r.source, r.ref, r.party, r.method, r.dir === 'in' ? r.amount : '', r.dir === 'out' ? r.amount : '', r.by]),
      [],
      ['', '', '', 'Total', '', '', '', s.in, s.out],
      ['', '', '', 'Net movement', '', '', '', s.net],
      ...s.methods.map((m) => ['', '', '', `Net ${m.method}`, '', '', '', m.net]),
    ]);
  }),
);

// ---------- receivables: who owes the hotel ----------

export function receivables(asOf = today()) {
  // Guests: anyone whose bill isn't settled. An in-house guest's bill is still running, so it isn't late.
  const guests = all<{ id: number; code: string; status: string; guest_name: string; phone: string; room_number: string | null; check_in: string; check_out: string; balance: number }>(
    `SELECT * FROM (
       SELECT r.id, r.code, r.status, g.name AS guest_name, g.phone, rm.number AS room_number, r.check_in, r.check_out,
              r.total + ${CHARGES_SQL} - ${PAID_SQL} AS balance
         FROM reservations r JOIN guests g ON g.id = r.guest_id LEFT JOIN rooms rm ON rm.id = r.room_id
        WHERE r.status IN ('checked_in','checked_out')
     ) WHERE balance > 0 ORDER BY check_out`,
  ).map((g) => {
    const late = g.status === 'checked_in' ? 0 : daysBetween(g.check_out, asOf);
    return { ...g, days_late: late, bucket: g.status === 'checked_in' ? 'current' : bucketOf(late) };
  });

  // Companies: their payments clear the oldest charges first, so what is left has a true age.
  const charges = all<{ company_id: number; date: string; amount: number; code: string; guest_name: string }>(
    `SELECT r.company_id, p.date, p.amount, r.code, g.name AS guest_name FROM payments p JOIN reservations r ON r.id = p.reservation_id JOIN guests g ON g.id = r.guest_id
      WHERE p.method = 'company' AND r.company_id IS NOT NULL ORDER BY p.date, p.id`,
  );
  const paid = new Map(all<{ company_id: number; v: number }>('SELECT company_id, SUM(amount) v FROM company_payments GROUP BY company_id').map((r) => [r.company_id, r.v]));
  const companies = all<{ id: number; name: string; contact_name: string | null; phone: string | null; credit_limit: number }>('SELECT id, name, contact_name, phone, credit_limit FROM companies ORDER BY name')
    .map((c) => {
      let credit = paid.get(c.id) ?? 0;
      const open: { date: string; amount: number; code: string; guest_name: string; days: number }[] = [];
      for (const ch of charges.filter((x) => x.company_id === c.id)) {
        const used = Math.min(credit, ch.amount);
        credit -= used;
        if (ch.amount - used > 0) open.push({ date: ch.date, amount: ch.amount - used, code: ch.code, guest_name: ch.guest_name, days: daysBetween(ch.date, asOf) });
      }
      // Company bills are due 30 days after the stay is billed to them.
      const buckets = Object.fromEntries(AGING.map((a) => [a.key, open.filter((o) => bucketOf(o.days - 30) === a.key).reduce((s, o) => s + o.amount, 0)]));
      return { ...c, balance: open.reduce((s, o) => s + o.amount, 0), oldest_days: open[0]?.days ?? 0, buckets, open };
    })
    .filter((c) => c.balance > 0)
    .sort((a, b) => b.balance - a.balance);

  const buckets = Object.fromEntries(
    AGING.map((a) => [a.key, guests.filter((g) => g.bucket === a.key).reduce((s, g) => s + g.balance, 0) + companies.reduce((s, c) => s + (c.buckets[a.key] ?? 0), 0)]),
  );
  const guestTotal = guests.reduce((s, g) => s + g.balance, 0);
  const companyTotal = companies.reduce((s, c) => s + c.balance, 0);
  return { as_of: asOf, total: guestTotal + companyTotal, guest_total: guestTotal, company_total: companyTotal, buckets, aging: AGING.map(({ key, label }) => ({ key, label })), guests, companies };
}

accounts.get(
  '/accounts/receivables',
  books,
  h((req, res) => {
    res.json(receivables(isDate(req.query.as_of) ? req.query.as_of : today()));
  }),
);

// ---------- targets & budgets ----------

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const monthOf = (q: unknown) => (typeof q === 'string' && MONTH_RE.test(q) ? q : today().slice(0, 7));
export const monthRange = (month: string) => {
  const from = `${month}-01`;
  const next = addDays(`${month}-28`, 4).slice(0, 7);
  return { from, to: addDays(`${next}-01`, -1) };
};

export function targetsFor(month: string): Record<string, number> {
  return Object.fromEntries(all<{ key: string; amount: number }>('SELECT key, amount FROM targets WHERE month = ?', month).map((t) => [t.key, t.amount]));
}

/** The month's budget for each running cost against what has actually been spent. */
export function budget(month: string) {
  const { from, to } = monthRange(month);
  const end = to > today() ? today() : to;
  const t = targetsFor(month);
  const spent = new Map(all<{ category: string; v: number }>('SELECT category, SUM(amount) v FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category', from, end).map((r) => [r.category, r.v]));
  const lines = EXPENSE_CATEGORIES.map((c) => ({ key: c.key, label: c.label, kind: c.kind, budget: t[`expense:${c.key}`] ?? null, actual: spent.get(c.key) ?? 0 }));
  return {
    month,
    from,
    to,
    elapsed: from > today() ? 0 : Math.min(1, (daysBetween(from, end) + 1) / (daysBetween(from, to) + 1)),
    lines,
    total_budget: lines.reduce((a, l) => a + (l.budget ?? 0), 0),
    total_actual: lines.reduce((a, l) => a + l.actual, 0),
  };
}

accounts.get(
  '/accounts/budget',
  books,
  h((req, res) => {
    res.json(budget(monthOf(req.query.month)));
  }),
);

/** Owner targets are set by the owner and managers; running-cost budgets by the accountant and managers. */
accounts.put(
  '/targets',
  allow('manager', 'accountant'),
  h((req, res) => {
    const user = currentUser(req);
    const b = body(req);
    const month = str(b, 'month', { max: 7, pattern: MONTH_RE });
    if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > 30) throw bad('Nothing to save');
    const lines = b.lines.map((raw) => {
      if (!raw || typeof raw !== 'object') throw bad('Invalid line');
      const l = raw as Record<string, unknown>;
      const key = str(l, 'key', { max: 40 });
      const isTarget = (TARGET_KEYS as readonly string[]).includes(key);
      const isBudget = key.startsWith('expense:') && (EXPENSE_KEYS as string[]).includes(key.slice(8));
      if (!isTarget && !isBudget) throw bad(`Unknown target ${key}`);
      if (isTarget && !isManager(user.role)) throw new HttpError(403, "Business targets are set by the owner or a manager");
      const amount = l.amount === null || l.amount === '' ? null : int(l, 'amount', { min: 0, max: key === 'occupancy' ? 100 : 100_000_000_000 });
      return { key, amount };
    });
    for (const l of lines) {
      if (l.amount === null) run('DELETE FROM targets WHERE month = ? AND key = ?', month, l.key);
      else run("INSERT INTO targets (month, key, amount, set_by, updated_at) VALUES (?,?,?,?, datetime('now')) ON CONFLICT (month, key) DO UPDATE SET amount = excluded.amount, set_by = excluded.set_by, updated_at = excluded.updated_at", month, l.key, l.amount, user.id);
    }
    audit(user.id, 'set_targets', 'target', null, { month, lines });
    res.json({ ok: true });
  }),
);

// ---------- the accountant's overview ----------

accounts.get(
  '/accounts/overview',
  books,
  h((req, res) => {
    const { from, to } = range(req);
    const rows = cashbook(from, to);
    const pnl = profitAndLoss(from, to);
    const last = lastClosedDate();
    const closures = all<{ date: string; expected_cash: number; counted_cash: number; variance: number; notes: string | null; closed_by: string }>(
      `SELECT c.date, c.expected_cash, c.counted_cash, c.variance, c.notes, u.name AS closed_by FROM day_closures c JOIN users u ON u.id = c.closed_by
        WHERE c.date BETWEEN ? AND ? ORDER BY c.date DESC`,
      from,
      to,
    );
    const rec = receivables();
    const pay = payables();
    res.json({
      from,
      to,
      cash: summarise(rows),
      daily: daysBetween(from, to) <= 366 ? daily(rows, from, to) : [],
      pnl: { totalRevenue: pnl.totalRevenue, totalCostOfSales: pnl.totalCostOfSales, grossProfit: pnl.grossProfit, totalOperating: pnl.totalOperating, netProfit: pnl.netProfit, revenue: pnl.revenue, stockValue: pnl.stockValue, stockPurchases: pnl.stockPurchases },
      receivables: { total: rec.total, guest_total: rec.guest_total, company_total: rec.company_total, buckets: rec.buckets, aging: rec.aging, top: [...rec.companies.map((c) => ({ kind: 'company', name: c.name, amount: c.balance, days: c.oldest_days, id: c.id })), ...rec.guests.map((g) => ({ kind: 'guest', name: g.guest_name, amount: g.balance, days: g.days_late, id: g.id }))].sort((a, b) => b.amount - a.amount).slice(0, 8) },
      payables: { total: pay.total, buckets: pay.buckets, aging: pay.aging, due_soon: pay.bills.filter((b) => b.days_late > -8).slice(0, 8) },
      closures,
      variance_total: closures.reduce((a, c) => a + c.variance, 0),
      last_closed: last,
      unclosed_days: last ? Math.max(0, daysBetween(last, addDays(today(), -1))) : null,
      budget: budget(today().slice(0, 7)),
      open_queries: get<{ n: number }>("SELECT COUNT(*) n FROM audit_queries WHERE status = 'open'")!.n,
    });
  }),
);

// ---------- taxes: what is owed to government ----------

/** Tax inside each month's earned revenue, for filing. Prices are tax-inclusive, so this is part of what was earned. */
function taxReport(from: string, to: string) {
  const months: { month: string; from: string; to: string; taxes: { name: string; rate: number; base: number; amount: number }[] }[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addDays(`${m}-28`, 4).slice(0, 7)) {
    const r = monthRange(m);
    const a = r.from < from ? from : r.from;
    const b = r.to > to ? to : r.to;
    months.push({ month: m, from: a, to: b, taxes: periodTaxes(profitAndLoss(a, b).revenue).taxes });
  }
  const whole = periodTaxes(profitAndLoss(from, to).revenue);
  return { from, to, configured: getSettings().taxes, tax_id: getSettings().tax_id, ...whole, months };
}

accounts.get(
  '/accounts/taxes',
  books,
  h((req, res) => {
    const { from, to } = range(req);
    res.json(taxReport(from, to));
  }),
);

accounts.get(
  '/accounts/taxes.csv',
  books,
  h((req, res) => {
    const { from, to } = range(req);
    const t = taxReport(from, to);
    const names = t.configured.map((x) => `${x.name} (${x.rate}%)`);
    csv(res, `danest-taxes-${from}-to-${to}.csv`, [
      ['Danest Hotel & Suites — Taxes included in revenue'],
      [`${from} to ${to}`, t.tax_id ? `Tax ID ${t.tax_id}` : ''],
      [],
      ['Month', ...names.flatMap((n) => [`${n} — sales before tax`, `${n} — tax`])],
      ...t.months.map((m) => [m.month, ...t.configured.flatMap((c) => {
        const x = m.taxes.find((y) => y.name === c.name);
        return [x?.base ?? 0, x?.amount ?? 0];
      })]),
      ['Total', ...t.configured.flatMap((c) => {
        const x = t.taxes.find((y) => y.name === c.name);
        return [x?.base ?? 0, x?.amount ?? 0];
      })],
    ]);
  }),
);

// ---------- ledger export: double entry for QuickBooks, Sage or Excel ----------

accounts.get(
  '/accounts/ledger',
  books,
  h((req, res) => {
    const { from, to } = range(req);
    if (daysBetween(from, to) > 400) throw bad('Export at most about a year at a time');
    const lines = journal(from, to);
    res.json({ from, to, ...trialBalance(lines), journals: new Set(lines.map((l) => l.date)).size, lines: lines.length });
  }),
);

accounts.get(
  '/accounts/journal.csv',
  books,
  h((req, res) => {
    const { from, to } = range(req);
    if (daysBetween(from, to) > 400) throw bad('Export at most about a year at a time');
    // One journal per day, in the columns accounting packages import: QuickBooks Online "Journal entries", Sage, Xero manual journals.
    csv(res, `danest-journal-${from}-to-${to}.csv`, [
      ['JournalNo', 'JournalDate', 'AccountCode', 'AccountName', 'Debits', 'Credits', 'Description'],
      ...journal(from, to).map((l) => [`DJ-${l.date.replace(/-/g, '')}`, l.date, l.account.code, l.account.name, l.debit || '', l.credit || '', l.memo]),
    ]);
    audit(currentUser(req).id, 'export', 'journal', null, { from, to });
  }),
);

accounts.get(
  '/accounts/chart.csv',
  books,
  h((_req, res) => {
    csv(res, 'danest-chart-of-accounts.csv', [['Code', 'Name', 'Type'], ...chartOfAccounts().map((a) => [a.code, a.name, a.type])]);
  }),
);
