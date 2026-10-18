import { Router, type Request } from 'express';
import { BOOKS, QUERY_STATUSES } from '../../shared/constants.ts';
import { allow, currentUser } from '../auth.ts';
import { all, audit, get, run, tx } from '../db.ts';
import { HttpError, body, h, int, isDate, range, str, today } from '../lib.ts';
import { csv } from '../csv.ts';

/**
 * The auditor's tools. Exceptions pulls every event a reviewer should look at (voids, refunds,
 * overrides, cash differences, shrinkage, back-dating, access changes) into one list. Queries
 * let the auditor ask management about any of them, and keep the answer on record.
 */
export const review = Router();
const books = allow(...BOOKS);

export type Severity = 'high' | 'medium' | 'low';
export interface Exception {
  kind: string;
  severity: Severity;
  date: string;
  at: string;
  user: string | null;
  summary: string;
  amount: number | null;
  ref_id: number | null;
  ref_label: string | null;
}

export const EXCEPTION_KINDS: Record<string, { label: string; severity: Severity }> = {
  void: { label: 'Till or facility entry voided', severity: 'medium' },
  refund: { label: 'Money given back', severity: 'medium' },
  checkout_balance: { label: 'Checked out still owing', severity: 'high' },
  cash_variance: { label: 'Cash count did not match', severity: 'high' },
  reopen_day: { label: 'Closed day reopened', severity: 'high' },
  shrinkage: { label: 'Stock written off', severity: 'medium' },
  expense_deleted: { label: 'Expense deleted', severity: 'medium' },
  manual_rate: { label: 'Room priced by hand', severity: 'low' },
  backdated: { label: 'Entered days after the date', severity: 'low' },
  short_delivery: { label: 'Delivery differed from the order', severity: 'low' },
  access: { label: 'Access or security change', severity: 'medium' },
  failed_login: { label: 'Failed sign-ins', severity: 'low' },
  online_mismatch: { label: 'Online payment amount mismatch', severity: 'high' },
};

const naira = (n: number) => `₦${Math.round(n).toLocaleString('en-NG')}`;

/** created_at is UTC; the hotel's day is Lagos time. */
const LAGOS_DAY = "date(a.created_at, '+1 hour')";

export function exceptions(from: string, to: string): Exception[] {
  const out: Exception[] = [];
  const logs = all<{ id: number; action: string; entity: string; entity_id: number | null; detail: string | null; created_at: string; user: string | null; code: string | null }>(
    `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, u.name AS user,
            CASE WHEN a.entity = 'reservation' THEN (SELECT code FROM reservations WHERE id = a.entity_id) END AS code
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE ${LAGOS_DAY} BETWEEN ? AND ?
        AND (a.action IN ('void','refund','check_out_with_balance','close_day_with_variance','reopen_day','stock_adjust','delete','receive',
                          'mfa_disabled','login_recovery_code','online_payment_mismatch','rate_change')
             OR (a.action IN ('cancel','no_show') AND json_extract(a.detail, '$.refunded') > 0)
             OR (a.action = 'create' AND a.entity = 'reservation' AND json_extract(a.detail, '$.rate_note') IS NOT NULL)
             OR (a.action IN ('update','create') AND a.entity = 'user'))
      ORDER BY a.id DESC LIMIT 2000`,
    from,
    to,
  );
  for (const l of logs) {
    const d = (l.detail ? JSON.parse(l.detail) : {}) as Record<string, any>;
    const base = { date: l.created_at.slice(0, 10), at: l.created_at, user: l.user, ref_id: l.entity_id, ref_label: l.code };
    const push = (kind: string, summary: string, amount: number | null, label = base.ref_label) =>
      out.push({ ...base, kind, severity: EXCEPTION_KINDS[kind].severity, summary, amount, ref_label: label });
    switch (l.action) {
      case 'void':
        push('void', `${l.entity === 'sale' ? `Receipt ${d.receipt_no ?? ''}` : `${d.facility ?? 'Facility'} entry`} voided: ${d.reason ?? 'no reason'}`, d.total ?? d.amount ?? null, d.receipt_no ?? null);
        break;
      case 'refund':
        push('refund', `${naira(d.amount)} refunded by ${d.method}: ${d.reason ?? ''}`, d.amount);
        break;
      case 'cancel':
      case 'no_show':
        push('refund', `${l.action === 'no_show' ? 'No-show' : 'Cancellation'} refunded ${naira(d.refunded)}${d.retained ? `, kept ${naira(d.retained)}` : ''}`, d.refunded);
        break;
      case 'check_out_with_balance':
        push('checkout_balance', `Guest left owing ${naira(d.balance)} (manager override)`, d.balance);
        break;
      case 'close_day_with_variance': {
        const c = get<{ variance: number; notes: string | null }>('SELECT variance, notes FROM day_closures WHERE date = ?', d.date);
        push('cash_variance', `${d.date}: drawer ${d.variance > 0 ? 'over' : 'short'} by ${naira(Math.abs(d.variance))}${c?.notes ? ` — "${c.notes}"` : ''}`, d.variance, d.date);
        break;
      }
      case 'reopen_day':
        push('reopen_day', `${d.date} reopened: ${d.reason ?? ''}`, null, d.date);
        break;
      case 'stock_adjust':
        if (d.change < 0) push('shrinkage', `${-d.change} × ${get<{ name: string }>('SELECT name FROM products WHERE id = ?', l.entity_id)?.name ?? 'item'} written off: ${d.reason ?? ''}`, -(d.value ?? 0));
        break;
      case 'delete':
        if (l.entity === 'expense') push('expense_deleted', `Expense deleted: ${d.description ?? ''} (${d.category ?? ''})`, d.amount ?? null);
        break;
      case 'receive':
        if (d.short) push('short_delivery', `Ordered ${naira(d.ordered)}, received ${naira(d.received)}`, d.received - d.ordered);
        break;
      case 'create':
        if (l.entity === 'reservation') push('manual_rate', `Booking priced specially: ${d.rate_note}`, d.total ?? null);
        else push('access', `New ${d.role} account: ${d.username}`, null, d.username);
        break;
      case 'update': {
        const changes = [d.role && `role → ${d.role}`, d.active === false && 'deactivated', d.active === true && 'reactivated', d.password_reset && 'password reset', d.mfa_reset && 'two-step reset'].filter(Boolean);
        if (changes.length) push('access', `${get<{ name: string }>('SELECT name FROM users WHERE id = ?', l.entity_id)?.name ?? 'Account'}: ${changes.join(', ')}`, null, null);
        break;
      }
      case 'mfa_disabled':
        push('access', 'Turned off two-step sign-in', null, null);
        break;
      case 'login_recovery_code':
        push('access', 'Signed in with a recovery code', null, null);
        break;
      case 'rate_change':
        push('manual_rate', `Room type rate changed ${naira(d.from)} → ${naira(d.to)}`, null, null);
        break;
      case 'online_payment_mismatch':
        push('online_mismatch', `Online payment did not match: ${JSON.stringify(d).slice(0, 120)}`, null);
        break;
    }
  }

  // Back-dated money: entered more than a day after the date it was booked to.
  for (const r of all<{ kind: string; id: number; date: string; created_at: string; amount: number; label: string; user: string | null }>(
    `SELECT 'expense' kind, e.id, e.date, e.created_at, e.amount, e.description AS label, u.name AS user FROM expenses e LEFT JOIN users u ON u.id = e.recorded_by
      WHERE e.date BETWEEN ?1 AND ?2 AND julianday(date(e.created_at, '+1 hour')) - julianday(e.date) > 1
     UNION ALL SELECT 'facility', f.id, f.date, f.created_at, f.amount, f.item, u.name FROM facility_income f LEFT JOIN users u ON u.id = f.recorded_by
      WHERE f.date BETWEEN ?1 AND ?2 AND julianday(date(f.created_at, '+1 hour')) - julianday(f.date) > 1
     UNION ALL SELECT 'purchase', p.id, p.date, p.created_at, p.total, p.supplier, u.name FROM purchases p LEFT JOIN users u ON u.id = p.recorded_by
      WHERE p.status = 'received' AND p.received_at IS NOT NULL AND p.date BETWEEN ?1 AND ?2 AND julianday(date(p.received_at, '+1 hour')) - julianday(p.date) > 1`,
    from,
    to,
  )) {
    const late = Math.round((Date.parse(`${r.created_at.slice(0, 10)}T00:00:00Z`) - Date.parse(`${r.date}T00:00:00Z`)) / 86_400_000);
    out.push({ kind: 'backdated', severity: 'low', date: r.created_at.slice(0, 10), at: r.created_at, user: r.user, summary: `${r.kind === 'expense' ? 'Expense' : r.kind === 'purchase' ? 'Purchase' : 'Facility takings'} "${r.label}" dated ${r.date}, entered ${late} days later`, amount: r.amount, ref_id: r.id, ref_label: r.date });
  }

  // Failed sign-ins, one line per username per day rather than one per attempt.
  for (const f of all<{ day: string; username: string; n: number; last: string }>(
    `SELECT ${LAGOS_DAY} AS day, json_extract(a.detail, '$.username') AS username, COUNT(*) n, MAX(a.created_at) last FROM audit_log a
      WHERE a.action = 'login_failed' AND ${LAGOS_DAY} BETWEEN ? AND ? GROUP BY day, username HAVING n >= 3`,
    from,
    to,
  )) {
    out.push({ kind: 'failed_login', severity: f.n >= 8 ? 'medium' : 'low', date: f.day, at: f.last, user: null, summary: `${f.n} failed sign-ins for "${f.username}"`, amount: null, ref_id: null, ref_label: f.username });
  }

  return out.sort((a, b) => b.at.localeCompare(a.at));
}

const WEIGHT: Record<Severity, number> = { high: 5, medium: 2, low: 1 };

export function exceptionSummary(list: Exception[]) {
  const byKind = Object.entries(EXCEPTION_KINDS).map(([kind, k]) => {
    const xs = list.filter((e) => e.kind === kind);
    return { kind, label: k.label, severity: k.severity, count: xs.length, amount: xs.reduce((a, e) => a + Math.abs(e.amount ?? 0), 0) };
  });
  return { total: list.length, high: list.filter((e) => e.severity === 'high').length, score: list.reduce((a, e) => a + WEIGHT[e.severity], 0), by_kind: byKind };
}

review.get(
  '/review/exceptions',
  books,
  h((req, res) => {
    const { from, to } = range(req);
    const list = exceptions(from, to);
    const kind = typeof req.query.kind === 'string' ? req.query.kind : '';
    // Which exceptions already have a query on them, so the auditor doesn't ask twice.
    const asked = all<{ kind: string; ref_id: number | null; ref_label: string | null; id: number; status: string }>('SELECT id, kind, ref_id, ref_label, status FROM audit_queries');
    res.json({
      from,
      to,
      summary: exceptionSummary(list),
      items: list
        .filter((e) => !kind || e.kind === kind)
        .slice(0, 500)
        .map((e) => ({ ...e, query: asked.find((q) => q.kind === e.kind && q.ref_id === e.ref_id && q.ref_label === e.ref_label) ?? null })),
    });
  }),
);

// ---------- the full trail ----------

function trailWhere(req: Request) {
  const { from, to } = range(req);
  const where = [`${LAGOS_DAY} BETWEEN ? AND ?`];
  const params: (string | number)[] = [from, to];
  const q = (k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string).slice(0, 60) : '');
  if (/^\d+$/.test(q('user'))) where.push('a.user_id = ?'), params.push(Number(q('user')));
  if (q('entity')) where.push('a.entity = ?'), params.push(q('entity'));
  if (q('action')) where.push('a.action = ?'), params.push(q('action'));
  if (q('q')) where.push('(a.action LIKE ? OR a.entity LIKE ? OR a.detail LIKE ? OR u.name LIKE ?)'), params.push(...Array(4).fill(`%${q('q')}%`));
  return { from, to, sql: where.join(' AND '), params };
}

review.get(
  '/review/trail',
  allow('manager', 'auditor'),
  h((req, res) => {
    const w = trailWhere(req);
    const page = Math.max(0, Number(req.query.page) || 0);
    const rows = all(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, u.name AS user, u.role
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE ${w.sql} ORDER BY a.id DESC LIMIT 100 OFFSET ?`,
      ...w.params,
      page * 100,
    );
    const total = get<{ n: number }>(`SELECT COUNT(*) n FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE ${w.sql}`, ...w.params)!.n;
    res.json({
      from: w.from,
      to: w.to,
      page,
      total,
      rows,
      facets: {
        users: all('SELECT id, name, role FROM users ORDER BY name'),
        entities: all<{ entity: string }>('SELECT DISTINCT entity FROM audit_log ORDER BY entity').map((r) => r.entity),
        actions: all<{ action: string }>('SELECT DISTINCT action FROM audit_log ORDER BY action').map((r) => r.action),
      },
    });
  }),
);

review.get(
  '/review/trail.csv',
  allow('manager', 'auditor'),
  h((req, res) => {
    const w = trailWhere(req);
    const rows = all<{ id: number; created_at: string; user: string | null; role: string | null; action: string; entity: string; entity_id: number | null; detail: string | null }>(
      `SELECT a.id, a.created_at, u.name AS user, u.role, a.action, a.entity, a.entity_id, a.detail
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE ${w.sql} ORDER BY a.id LIMIT 50000`,
      ...w.params,
    );
    audit(currentUser(req).id, 'export', 'audit_log', null, { from: w.from, to: w.to, rows: rows.length });
    csv(res, `danest-activity-${w.from}-to-${w.to}.csv`, [
      ['#', 'When (UTC)', 'Who', 'Role', 'Action', 'Record', 'Record id', 'Detail'],
      ...rows.map((r) => [r.id, r.created_at, r.user ?? 'system / guest', r.role, r.action, r.entity, r.entity_id, r.detail]),
    ]);
  }),
);

// ---------- auditor queries ----------

const QUERY_LIST = `
  SELECT q.*, rb.name AS raised_by_name, ab.name AS answered_by_name, cb.name AS closed_by_name
    FROM audit_queries q JOIN users rb ON rb.id = q.raised_by LEFT JOIN users ab ON ab.id = q.answered_by LEFT JOIN users cb ON cb.id = q.closed_by`;

review.get(
  '/review/queries',
  books,
  h((req, res) => {
    const status = typeof req.query.status === 'string' && (QUERY_STATUSES as readonly string[]).includes(req.query.status) ? req.query.status : '';
    res.json({
      counts: Object.fromEntries(QUERY_STATUSES.map((s) => [s, get<{ n: number }>('SELECT COUNT(*) n FROM audit_queries WHERE status = ?', s)!.n])),
      rows: all(`${QUERY_LIST} WHERE (:status = '' OR q.status = :status) ORDER BY CASE q.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END, q.id DESC LIMIT 300`, { status }),
    });
  }),
);

review.post(
  '/review/queries',
  allow('auditor'),
  h((req, res) => {
    const user = currentUser(req);
    const b = body(req);
    const kind = str(b, 'kind', { max: 40 });
    const question = str(b, 'question', { min: 5, max: 1000 });
    const refId = b.ref_id === undefined || b.ref_id === null ? null : int(b, 'ref_id', { min: 0 });
    const refLabel = str(b, 'ref_label', { max: 120, optional: true }) || null;
    const amount = b.amount === undefined || b.amount === null ? null : int(b, 'amount', { min: -1_000_000_000, max: 1_000_000_000 });
    const { id } = run('INSERT INTO audit_queries (kind, ref_id, ref_label, amount, question, raised_by) VALUES (?,?,?,?,?,?)', kind, refId, refLabel, amount, question, user.id);
    audit(user.id, 'raise', 'audit_query', id, { kind, ref_label: refLabel });
    res.status(201).json({ id });
  }),
);

/** Management answers. The auditor then closes it, or asks again (which reopens it with the follow-up on record). */
review.post(
  '/review/queries/:id/answer',
  allow('manager', 'accountant'),
  h((req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const answer = str(body(req), 'answer', { min: 3, max: 2000 });
    tx(() => {
      const q = get<{ status: string; answer: string | null }>('SELECT status, answer FROM audit_queries WHERE id = ?', id);
      if (!q) throw new HttpError(404, 'Query not found');
      if (q.status === 'closed') throw new HttpError(409, 'This query is closed');
      const thread = q.answer ? `${q.answer}\n\n— ${user.name}, ${today()}: ${answer}` : answer;
      run("UPDATE audit_queries SET status = 'answered', answer = ?, answered_by = ?, answered_at = datetime('now') WHERE id = ?", thread, user.id, id);
      audit(user.id, 'answer', 'audit_query', id);
    });
    res.json({ ok: true });
  }),
);

review.post(
  '/review/queries/:id/close',
  allow('auditor'),
  h((req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    tx(() => {
      const q = get<{ status: string }>('SELECT status FROM audit_queries WHERE id = ?', id);
      if (!q) throw new HttpError(404, 'Query not found');
      if (q.status === 'closed') throw new HttpError(409, 'Already closed');
      run("UPDATE audit_queries SET status = 'closed', closed_by = ?, closed_at = datetime('now') WHERE id = ?", user.id, id);
      audit(user.id, 'close', 'audit_query', id);
    });
    res.json({ ok: true });
  }),
);

review.post(
  '/review/queries/:id/follow-up',
  allow('auditor'),
  h((req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const more = str(body(req), 'question', { min: 3, max: 1000 });
    tx(() => {
      const q = get<{ question: string }>('SELECT question FROM audit_queries WHERE id = ?', id);
      if (!q) throw new HttpError(404, 'Query not found');
      run("UPDATE audit_queries SET status = 'open', question = ?, closed_by = NULL, closed_at = NULL WHERE id = ?", `${q.question}\n\n— Follow-up, ${today()}: ${more}`, id);
      audit(user.id, 'follow_up', 'audit_query', id);
    });
    res.json({ ok: true });
  }),
);

// ---------- live activity feed ----------

review.get(
  '/activity',
  allow('manager', 'accountant', 'auditor'),
  h((req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 5), 100);
    const since = isDate(req.query.since) ? req.query.since : today();
    // Logins are noise in a business feed; the trail keeps them.
    const events = all(
      `SELECT * FROM (
         SELECT 'audit' AS type, a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, u.name AS user,
                CASE WHEN a.entity = 'reservation' THEN (SELECT g.name || ' · ' || r.code FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE r.id = a.entity_id) END AS label
           FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
          WHERE a.action NOT IN ('login','login_failed','mfa_failed','export','message','session_revoked','sessions_revoked') AND ${LAGOS_DAY} >= ?
         UNION ALL
         SELECT 'sale', s.id, 'sale', 'sale', s.id, json_object('total', s.total, 'method', s.method, 'receipt_no', s.receipt_no,
                'items', (SELECT group_concat(si.qty || ' × ' || p.name, ', ') FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = s.id)),
                s.created_at, u.name, NULL
           FROM sales s LEFT JOIN users u ON u.id = s.staff_id WHERE s.date >= ?
       ) ORDER BY created_at DESC LIMIT ?`,
      since,
      since,
      limit,
    );
    res.json({ since, events });
  }),
);
