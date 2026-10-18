import { EXPENSE_CATEGORIES, OUTLET_LABELS, STREAMS, TAX_GROUPS, taxesIncluded, type TaxGroup } from '../shared/constants.ts';
import { all } from './db.ts';
import { roomNightsByDay } from './routes/finance.ts';
import { getSettings } from './settings.ts';

/**
 * The hotel's books as double entry, for an accountant's ledger (QuickBooks, Sage, Excel). Built
 * from the same records as every report, one journal per day, each side of every line equal, so
 * the trial balance always balances. Room revenue is earned night by night (into the guest
 * ledger); money received clears the guest ledger; till and service sales hit cash, bank or the
 * guest's bill directly. Taxes inside sales move from revenue to what is owed to government.
 */

export interface Account {
  code: string;
  name: string;
  type: 'Asset' | 'Liability' | 'Income' | 'Cost of sales' | 'Expense';
}

const A = (code: string, name: string, type: Account['type']): Account => ({ code, name, type });

const FIXED = {
  cash: A('1000', 'Cash drawer', 'Asset'),
  bank: A('1010', 'Bank (transfers & POS)', 'Asset'),
  paystack: A('1020', 'Paystack clearing', 'Asset'),
  guests: A('1200', 'Guest ledger (room bills)', 'Asset'),
  companies: A('1210', 'Company accounts receivable', 'Asset'),
  inventory: A('1300', 'Bar & shop stock', 'Asset'),
  payables: A('2000', 'Supplier bills payable', 'Liability'),
  suspense: A('2900', 'Purchases — payment not recorded', 'Liability'),
  stockLoss: A('5900', 'Stock written off', 'Cost of sales'),
  cashDiff: A('6900', 'Cash over / short', 'Expense'),
};

const REVENUE: Record<string, Account> = Object.fromEntries(
  STREAMS.map((s, i) => [s.key, A(String(4000 + i * 10), `${s.label} revenue`, 'Income')]),
);
const COGS: Record<string, Account> = { drinks: A('5000', 'Drinks sold (cost)', 'Cost of sales'), confectionery: A('5010', 'Confectionery sold (cost)', 'Cost of sales') };
const EXPENSE: Record<string, Account> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c, i) => [c.key, A(String((c.kind === 'direct' ? 5100 : 6000) + i * 10), c.label, c.kind === 'direct' ? 'Cost of sales' : 'Expense')]),
);
const taxAccount = (i: number, name: string) => A(String(2200 + i * 10), `${name} payable`, 'Liability');

const byMethod = (m: string | null): Account =>
  m === 'cash' ? FIXED.cash : m === 'online' ? FIXED.paystack : m === 'company' ? FIXED.companies : m === 'room' ? FIXED.guests : FIXED.bank;

export function chartOfAccounts(): Account[] {
  const taxes = getSettings().taxes.map((t, i) => taxAccount(i, t.name));
  return [...Object.values(FIXED), ...Object.values(REVENUE), ...Object.values(COGS), ...Object.values(EXPENSE), ...taxes].sort((a, b) => a.code.localeCompare(b.code));
}

export interface Line {
  date: string;
  account: Account;
  debit: number;
  credit: number;
  memo: string;
}

export function journal(from: string, to: string): Line[] {
  const lines: Line[] = [];
  const pair = (date: string, dr: Account, cr: Account, amount: number, memo: string) => {
    if (!amount) return;
    // A negative amount flips the sides, so every line on the page is positive.
    const [d, c, v] = amount > 0 ? [dr, cr, amount] : [cr, dr, -amount];
    lines.push({ date, account: d, debit: v, credit: 0, memo }, { date, account: c, debit: 0, credit: v, memo });
  };
  // What each day earned, by stream, for the tax lines at the end.
  const earned = new Map<string, Map<string, number>>();
  const earn = (date: string, stream: string, v: number) => {
    const day = earned.get(date) ?? new Map<string, number>();
    day.set(stream, (day.get(stream) ?? 0) + v);
    earned.set(date, day);
  };

  for (const n of roomNightsByDay(from, to)) {
    pair(n.date, FIXED.guests, REVENUE.rooms, n.revenue, `Room nights earned (${n.nights})`);
    earn(n.date, 'rooms', n.revenue);
  }
  for (const r of all<{ date: string; v: number }>("SELECT cancelled_on date, SUM(retained) v FROM reservations WHERE status = 'cancelled' AND retained > 0 AND cancelled_on BETWEEN ? AND ? GROUP BY cancelled_on", from, to)) {
    pair(r.date, FIXED.guests, REVENUE.cancellations, r.v, 'Deposits kept on cancellations and no-shows');
    earn(r.date, 'cancellations', r.v);
  }
  for (const r of all<{ date: string; method: string; category: string; sales: number; cost: number; tracked: number }>(
    `SELECT s.date, s.method, p.category, SUM(si.qty * si.unit_price) sales, SUM(si.qty * si.unit_cost) cost, p.track_stock tracked
       FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
      WHERE s.date BETWEEN ? AND ? GROUP BY s.date, s.method, p.category, p.track_stock`,
    from,
    to,
  )) {
    pair(r.date, byMethod(r.method), REVENUE[r.category], r.sales, `Till sales: ${r.category} (${r.method})`);
    earn(r.date, r.category, r.sales);
    if (r.tracked && COGS[r.category]) pair(r.date, COGS[r.category], FIXED.inventory, r.cost, `Cost of ${r.category} sold`);
  }
  for (const r of all<{ date: string; method: string; facility: string; v: number }>('SELECT date, method, facility, SUM(amount) v FROM facility_income WHERE date BETWEEN ? AND ? GROUP BY date, method, facility', from, to)) {
    pair(r.date, byMethod(r.method), REVENUE[r.facility], r.v, `${OUTLET_LABELS[r.facility as keyof typeof OUTLET_LABELS] ?? r.facility} (${r.method})`);
    earn(r.date, r.facility, r.v);
  }
  for (const r of all<{ date: string; method: string; v: number }>('SELECT date, method, SUM(amount) v FROM payments WHERE date BETWEEN ? AND ? GROUP BY date, method', from, to)) {
    pair(r.date, byMethod(r.method), FIXED.guests, r.v, r.method === 'company' ? 'Room bills moved to company accounts' : `Payments on room bills (${r.method})`);
  }
  for (const r of all<{ date: string; method: string; v: number }>('SELECT date, method, SUM(amount) v FROM refunds WHERE date BETWEEN ? AND ? GROUP BY date, method', from, to)) {
    pair(r.date, FIXED.guests, byMethod(r.method), r.v, `Refunds to guests (${r.method})`);
  }
  for (const r of all<{ date: string; method: string; v: number }>('SELECT date, method, SUM(amount) v FROM company_payments WHERE date BETWEEN ? AND ? GROUP BY date, method', from, to)) {
    pair(r.date, byMethod(r.method), FIXED.companies, r.v, `Payments from companies (${r.method})`);
  }
  for (const r of all<{ date: string; category: string; method: string; v: number }>('SELECT date, category, method, SUM(amount) v FROM expenses WHERE date BETWEEN ? AND ? GROUP BY date, category, method', from, to)) {
    pair(r.date, EXPENSE[r.category] ?? EXPENSE.other, byMethod(r.method), r.v, `${EXPENSE[r.category]?.name ?? r.category} (${r.method})`);
  }
  for (const r of all<{ date: string; terms: string | null; v: number }>("SELECT date, terms, SUM(total) v FROM purchases WHERE status = 'received' AND date BETWEEN ? AND ? GROUP BY date, terms", from, to)) {
    const credit = r.terms === 'credit' ? FIXED.payables : r.terms === null ? FIXED.suspense : byMethod(r.terms);
    pair(r.date, FIXED.inventory, credit, r.v, r.terms === 'credit' ? 'Stock received on credit' : r.terms === null ? 'Stock received (payment not recorded)' : `Stock received, paid by ${r.terms}`);
  }
  for (const r of all<{ date: string; method: string; v: number }>('SELECT date, method, SUM(amount) v FROM supplier_payments WHERE date BETWEEN ? AND ? GROUP BY date, method', from, to)) {
    pair(r.date, FIXED.payables, byMethod(r.method), r.v, `Supplier bills paid (${r.method})`);
  }
  for (const r of all<{ date: string; v: number }>(
    `SELECT date(created_at, '+1 hour') date, SUM(json_extract(detail, '$.value')) v FROM audit_log
      WHERE action = 'stock_adjust' AND date(created_at, '+1 hour') BETWEEN ? AND ? GROUP BY 1`,
    from,
    to,
  )) {
    // A count below the system's figure is a loss; above it, a gain back into stock.
    pair(r.date, FIXED.stockLoss, FIXED.inventory, -r.v, 'Stock counts and write-offs');
  }
  for (const r of all<{ date: string; v: number }>('SELECT date, variance v FROM day_closures WHERE variance <> 0 AND date BETWEEN ? AND ?', from, to)) {
    pair(r.date, FIXED.cashDiff, FIXED.cash, -r.v, r.v < 0 ? 'Cash drawer short at close' : 'Cash drawer over at close');
  }

  // Prices include tax: the tax inside each day's sales belongs to government, not to revenue.
  const taxes = getSettings().taxes;
  if (taxes.length) {
    const groupOf = new Map<string, TaxGroup>(TAX_GROUPS.flatMap((g) => g.streams.map((s) => [s, g.key] as const)));
    for (const [date, streams] of earned) {
      for (const [stream, gross] of streams) {
        const group = groupOf.get(stream);
        if (!group || !gross) continue;
        for (const t of taxesIncluded({ [group]: gross }, taxes)) {
          const i = taxes.findIndex((x) => x.name === t.name);
          pair(date, REVENUE[stream], taxAccount(i, t.name), t.amount, `${t.name} ${t.rate}% inside ${stream} sales`);
        }
      }
    }
  }

  return lines.sort((a, b) => a.date.localeCompare(b.date) || a.account.code.localeCompare(b.account.code));
}

export function trialBalance(lines: Line[]) {
  const by = new Map<string, { account: Account; debit: number; credit: number }>();
  for (const l of lines) {
    const row = by.get(l.account.code) ?? { account: l.account, debit: 0, credit: 0 };
    row.debit += l.debit;
    row.credit += l.credit;
    by.set(l.account.code, row);
  }
  const rows = [...by.values()].sort((a, b) => a.account.code.localeCompare(b.account.code));
  return {
    rows: rows.map((r) => ({ ...r.account, debit: r.debit, credit: r.credit, balance: r.debit - r.credit })),
    debit: rows.reduce((a, r) => a + r.debit, 0),
    credit: rows.reduce((a, r) => a + r.credit, 0),
  };
}
