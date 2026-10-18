import { Router } from 'express';
import { BOOKS, PAYMENT_METHODS, ROLES } from '../../shared/constants.ts';
import { allow, currentUser } from '../auth.ts';
import { assertOpen } from '../days.ts';
import { all, audit, get, run, tx } from '../db.ts';
import { HttpError, PHONE_RE, addDays, bad, body, date, h, int, isDate, oneOf, str, today } from '../lib.ts';
import { monthOf } from './accounts.ts';

/**
 * Staff, payroll and the rota. Staff records are separate from sign-in accounts: the night
 * guard is on the payroll but has no login. A month's pay is drafted from the salaries,
 * adjusted, approved by management and then paid, which books the salaries expense once.
 * Income tax (PAYE) is entered per person, never guessed: the rules changed in 2026.
 */
export const people = Router();
const managers = allow('manager');
const books = allow(...BOOKS);
const payroll = allow('manager', 'accountant');

/** Employee pension contribution under the Pension Reform Act: 8% of basic + housing + transport, taken here as 8% of basic + allowances. */
export const PENSION_RATE = 0.08;

const DEPARTMENTS = ['front_office', 'housekeeping', 'bar', 'kitchen', 'facilities', 'security', 'maintenance', 'management', 'general'] as const;

function employeeFields(b: Record<string, unknown>) {
  const userId = b.user_id ? int(b, 'user_id', { min: 1 }) : null;
  if (userId && !get('SELECT 1 FROM users WHERE id = ?', userId)) throw bad('Unknown sign-in account');
  return {
    name: str(b, 'name', { max: 80 }),
    position: str(b, 'position', { max: 60 }),
    department: oneOf(b, 'department', DEPARTMENTS),
    phone: str(b, 'phone', { max: 20, optional: true, pattern: PHONE_RE }) || null,
    bank_name: str(b, 'bank_name', { max: 60, optional: true }) || null,
    account_number: str(b, 'account_number', { max: 10, optional: true, pattern: /^\d{10}$/ }) || null,
    start_date: b.start_date ? date(b, 'start_date') : null,
    monthly_salary: int(b, 'monthly_salary', { min: 0, max: 50_000_000 }),
    pension: b.pension === false ? 0 : 1,
    user_id: userId,
    notes: str(b, 'notes', { max: 300, optional: true }) || null,
  };
}

// ---------- staff records ----------

/** Managers and the books see pay; anyone else who can see the rota sees names and positions only. */
people.get(
  '/employees',
  allow(...ROLES),
  h((req, res) => {
    const pay = ['ceo', 'manager', 'accountant', 'auditor'].includes(req.user!.role);
    res.json(
      all(
        `SELECT e.id, e.name, e.position, e.department, e.active, e.user_id, ${pay ? 'e.phone, e.bank_name, e.account_number, e.start_date, e.monthly_salary, e.pension, e.notes, u.username' : 'NULL AS username'}
           FROM employees e LEFT JOIN users u ON u.id = e.user_id
          ${req.query.all === '1' && pay ? '' : 'WHERE e.active = 1'} ORDER BY e.active DESC, e.department, e.name`,
      ),
    );
  }),
);

people.post(
  '/employees',
  managers,
  h((req, res) => {
    const f = employeeFields(body(req));
    const { id } = run(
      `INSERT INTO employees (name, position, department, phone, bank_name, account_number, start_date, monthly_salary, pension, user_id, notes)
       VALUES (:name, :position, :department, :phone, :bank_name, :account_number, :start_date, :monthly_salary, :pension, :user_id, :notes)`,
      f,
    );
    audit(currentUser(req).id, 'create', 'employee', id, { name: f.name, monthly_salary: f.monthly_salary });
    res.status(201).json({ id });
  }),
);

people.put(
  '/employees/:id',
  managers,
  h((req, res) => {
    const id = Number(req.params.id);
    const b = body(req);
    const f = employeeFields(b);
    const before = get<{ monthly_salary: number }>('SELECT monthly_salary FROM employees WHERE id = ?', id);
    if (!before) throw new HttpError(404, 'Staff member not found');
    run(
      `UPDATE employees SET name=:name, position=:position, department=:department, phone=:phone, bank_name=:bank_name, account_number=:account_number,
              start_date=:start_date, monthly_salary=:monthly_salary, pension=:pension, user_id=:user_id, notes=:notes, active=:active WHERE id=:id`,
      { ...f, active: b.active === false ? 0 : 1, id },
    );
    // A pay change is the kind of thing an auditor asks about, so the before and after are kept.
    audit(currentUser(req).id, 'update', 'employee', id, { name: f.name, salary_from: before.monthly_salary, salary_to: f.monthly_salary, active: b.active !== false });
    res.json({ ok: true });
  }),
);

// ---------- payroll ----------

type PayLine = { id: number; employee_id: number; name: string; position: string; bank_name: string | null; account_number: string | null; basic: number; allowances: number; overtime: number; pension: number; paye: number; other_deductions: number; note: string | null };
const gross = (l: PayLine) => l.basic + l.allowances + l.overtime;
const net = (l: PayLine) => gross(l) - l.pension - l.paye - l.other_deductions;

function payRun(month: string) {
  const r = get<{ id: number; month: string; status: string; approved_at: string | null; paid_on: string | null; method: string | null; expense_id: number | null; approved_by_name: string | null; paid_by_name: string | null }>(
    `SELECT p.*, a.name AS approved_by_name, pb.name AS paid_by_name FROM pay_runs p
       LEFT JOIN users a ON a.id = p.approved_by LEFT JOIN users pb ON pb.id = p.paid_by WHERE p.month = ?`,
    month,
  );
  if (!r) return null;
  const lines = all<PayLine>(
    `SELECT l.*, e.name, e.position, e.bank_name, e.account_number FROM pay_lines l JOIN employees e ON e.id = l.employee_id
      WHERE l.pay_run_id = ? ORDER BY e.department, e.name`,
    r.id,
  ).map((l) => ({ ...l, gross: gross(l), net: net(l) }));
  const sum = (k: 'gross' | 'net' | 'pension' | 'paye' | 'other_deductions') => lines.reduce((a, l) => a + l[k], 0);
  return { ...r, lines, totals: { gross: sum('gross'), net: sum('net'), pension: sum('pension'), paye: sum('paye'), other_deductions: sum('other_deductions'), people: lines.length } };
}

people.get(
  '/payroll',
  books,
  h((req, res) => {
    const month = monthOf(req.query.month);
    res.json({
      month,
      run: payRun(month),
      history: all('SELECT p.month, p.status, (SELECT COUNT(*) FROM pay_lines l WHERE l.pay_run_id = p.id) AS people FROM pay_runs p ORDER BY p.month DESC LIMIT 24'),
    });
  }),
);

/** Start a month's pay from everyone's current salary; pension at 8% for those enrolled. */
people.post(
  '/payroll',
  payroll,
  h((req, res) => {
    const user = currentUser(req);
    const month = monthOf(body(req).month);
    if (month > today().slice(0, 7)) throw bad('That month has not started yet');
    tx(() => {
      if (get('SELECT 1 FROM pay_runs WHERE month = ?', month)) throw new HttpError(409, 'That month already has a pay run');
      const { id } = run('INSERT INTO pay_runs (month, created_by) VALUES (?,?)', month, user.id);
      const staff = all<{ id: number; monthly_salary: number; pension: number }>('SELECT id, monthly_salary, pension FROM employees WHERE active = 1 AND monthly_salary > 0');
      if (!staff.length) throw bad('Add staff with a monthly salary first');
      for (const e of staff) run('INSERT INTO pay_lines (pay_run_id, employee_id, basic, pension) VALUES (?,?,?,?)', id, e.id, e.monthly_salary, e.pension ? Math.round(e.monthly_salary * PENSION_RATE) : 0);
      audit(user.id, 'create', 'pay_run', id, { month, people: staff.length });
    });
    res.status(201).json(payRun(month));
  }),
);

people.patch(
  '/payroll/lines/:id',
  payroll,
  h((req, res) => {
    const id = Number(req.params.id);
    const b = body(req);
    const line = get<{ status: string; month: string }>('SELECT p.status, p.month FROM pay_lines l JOIN pay_runs p ON p.id = l.pay_run_id WHERE l.id = ?', id);
    if (!line) throw new HttpError(404, 'Not found');
    if (line.status !== 'draft') throw new HttpError(409, 'This pay run is approved; it can no longer be changed');
    const v = (k: string) => int(b, k, { min: 0, max: 50_000_000 });
    const f = { basic: v('basic'), allowances: v('allowances'), overtime: v('overtime'), pension: v('pension'), paye: v('paye'), other_deductions: v('other_deductions') };
    if (f.pension + f.paye + f.other_deductions > f.basic + f.allowances + f.overtime) throw bad('Deductions are more than the pay');
    run('UPDATE pay_lines SET basic=:basic, allowances=:allowances, overtime=:overtime, pension=:pension, paye=:paye, other_deductions=:other_deductions, note=:note WHERE id=:id', { ...f, note: str(b, 'note', { max: 120, optional: true }) || null, id });
    res.json({ ok: true });
  }),
);

/** Management signs off the month's pay. After this nobody can change a line. */
people.post(
  '/payroll/:month/approve',
  managers,
  h((req, res) => {
    const user = currentUser(req);
    const month = monthOf(req.params.month);
    const n = run("UPDATE pay_runs SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE month = ? AND status = 'draft'", user.id, month).changes;
    if (!n) throw new HttpError(409, 'Only a draft pay run can be approved');
    audit(user.id, 'approve', 'pay_run', null, { month, gross: payRun(month)!.totals.gross });
    res.json(payRun(month));
  }),
);

/** The money has gone out: book the salaries expense (the gross pay, since deductions are owed on to PAYE and the pension funds). */
people.post(
  '/payroll/:month/paid',
  payroll,
  h((req, res) => {
    const user = currentUser(req);
    const month = monthOf(req.params.month);
    const b = body(req);
    const method = oneOf(b, 'method', PAYMENT_METHODS);
    const on = date(b, 'date', today());
    if (on > today()) throw bad('Date cannot be in the future');
    tx(() => {
      const r = payRun(month);
      if (!r) throw new HttpError(404, 'No pay run for that month');
      if (r.status !== 'approved') throw new HttpError(409, r.status === 'paid' ? 'Already paid' : 'Approve the pay run first');
      assertOpen(on);
      const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const { id: expenseId } = run(
        "INSERT INTO expenses (date, category, description, paid_to, amount, method, recorded_by) VALUES (?, 'salaries', ?, 'Staff payroll', ?, ?, ?)",
        on, `${label} payroll — ${r.totals.people} staff (net ₦${r.totals.net.toLocaleString('en-NG')}, PAYE ₦${r.totals.paye.toLocaleString('en-NG')}, pension ₦${r.totals.pension.toLocaleString('en-NG')})`, r.totals.gross, method, user.id,
      );
      run("UPDATE pay_runs SET status = 'paid', paid_by = ?, paid_on = ?, method = ?, expense_id = ? WHERE id = ?", user.id, on, method, expenseId, r.id);
      audit(user.id, 'pay', 'pay_run', r.id, { month, gross: r.totals.gross, net: r.totals.net, expense_id: expenseId });
    });
    res.json(payRun(month));
  }),
);

people.delete(
  '/payroll/:month',
  managers,
  h((req, res) => {
    const month = monthOf(req.params.month);
    const n = run("DELETE FROM pay_runs WHERE month = ? AND status = 'draft'", month).changes;
    if (!n) throw new HttpError(409, 'Only a draft pay run can be thrown away');
    audit(currentUser(req).id, 'delete', 'pay_run', null, { month });
    res.json({ ok: true });
  }),
);

// ---------- rota ----------

const SHIFTS = ['morning', 'afternoon', 'night', 'off', 'leave'] as const;

/** A week of shifts from a Monday. Everyone signed in can read it; managers set it. */
people.get(
  '/rota',
  allow(...ROLES),
  h((req, res) => {
    const start = isDate(req.query.week) ? req.query.week : today();
    const d = new Date(`${start}T00:00:00Z`);
    const monday = addDays(start, -((d.getUTCDay() + 6) % 7));
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    res.json({
      week: monday,
      days,
      employees: all('SELECT id, name, position, department, user_id FROM employees WHERE active = 1 ORDER BY department, name'),
      shifts: all('SELECT employee_id, date, shift FROM shifts WHERE date BETWEEN ? AND ?', days[0], days[6]),
    });
  }),
);

people.put(
  '/rota',
  managers,
  h((req, res) => {
    const b = body(req);
    const changes = Array.isArray(b.changes) ? b.changes : [];
    if (!changes.length || changes.length > 500) throw bad('Nothing to save');
    tx(() => {
      for (const raw of changes) {
        const c = (raw ?? {}) as Record<string, unknown>;
        const emp = int(c, 'employee_id', { min: 1 });
        const day = date(c, 'date');
        if (c.shift === null || c.shift === '') run('DELETE FROM shifts WHERE employee_id = ? AND date = ?', emp, day);
        else run('INSERT INTO shifts (employee_id, date, shift) VALUES (?,?,?) ON CONFLICT (employee_id, date) DO UPDATE SET shift = excluded.shift', emp, day, oneOf(c, 'shift', SHIFTS));
      }
    });
    audit(currentUser(req).id, 'update', 'rota', null, { changes: changes.length });
    res.json({ ok: true });
  }),
);

