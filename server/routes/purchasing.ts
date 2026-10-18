import { Router } from 'express';
import { BOOKS, PAYMENT_METHODS, PURCHASE_TERMS, type PurchaseTerms } from '../../shared/constants.ts';
import { allow, currentUser } from '../auth.ts';
import { assertOpen } from '../days.ts';
import { all, audit, get, run, tx } from '../db.ts';
import { EMAIL_RE, HttpError, PHONE_RE, addDays, bad, body, code, date, daysBetween, h, int, isDate, oneOf, range, str, today } from '../lib.ts';
import { lines, type Product } from './inventory.ts';

/**
 * Buying stock, the way a store room works: order from a supplier, receive what actually
 * arrived (only then do stock and average cost change), and either pay on the spot or leave a
 * bill on credit for the accountant to settle. Every step is logged with a name.
 */
export const purchasing = Router();
const buyer = allow('manager');
const books = allow(...BOOKS);
const payer = allow('manager', 'accountant');

// ---------- suppliers ----------

function supplierFields(b: Record<string, unknown>) {
  return {
    name: str(b, 'name', { max: 120 }),
    contact_name: str(b, 'contact_name', { max: 120, optional: true }) || null,
    phone: str(b, 'phone', { max: 20, optional: true, pattern: PHONE_RE }) || null,
    email: str(b, 'email', { max: 254, optional: true, pattern: EMAIL_RE }) || null,
    address: str(b, 'address', { max: 200, optional: true }) || null,
    terms_days: b.terms_days === undefined || b.terms_days === '' ? 0 : int(b, 'terms_days', { min: 0, max: 180 }),
    notes: str(b, 'notes', { max: 500, optional: true }) || null,
  };
}

/** What is still owed on each received credit bill. Bills paid on the spot (or recorded before bills were tracked) owe nothing. */
const PAID_SQL = 'COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.purchase_id = p.id), 0)';
const OWED_SQL = `CASE WHEN p.status = 'received' AND p.terms = 'credit' THEN p.total - ${PAID_SQL} ELSE 0 END`;

const SUPPLIER_LIST = `
  SELECT s.*,
    COALESCE((SELECT SUM(${OWED_SQL}) FROM purchases p WHERE p.supplier_id = s.id), 0) AS owed,
    COALESCE((SELECT SUM(${OWED_SQL}) FROM purchases p WHERE p.supplier_id = s.id AND p.due_date < :today), 0) AS overdue,
    (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id AND p.status = 'received') AS deliveries,
    COALESCE((SELECT SUM(total) FROM purchases p WHERE p.supplier_id = s.id AND p.status = 'received' AND p.date >= :year_ago), 0) AS bought_12m,
    (SELECT MAX(date) FROM purchases p WHERE p.supplier_id = s.id AND p.status = 'received') AS last_delivery,
    (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id AND p.status = 'ordered') AS open_orders
  FROM suppliers s`;

const supplierParams = () => ({ today: today(), year_ago: addDays(today(), -365) });

purchasing.get(
  '/suppliers',
  books,
  h((req, res) => {
    res.json(all(`${SUPPLIER_LIST} ${req.query.all === '1' ? '' : 'WHERE s.active = 1'} ORDER BY s.active DESC, s.name`, supplierParams()));
  }),
);

purchasing.post(
  '/suppliers',
  payer,
  h((req, res) => {
    const f = supplierFields(body(req));
    if (get('SELECT 1 FROM suppliers WHERE name = ?', f.name)) throw new HttpError(409, 'A supplier with that name already exists');
    const { id } = run(
      'INSERT INTO suppliers (name, contact_name, phone, email, address, terms_days, notes) VALUES (?,?,?,?,?,?,?)',
      f.name, f.contact_name, f.phone, f.email, f.address, f.terms_days, f.notes,
    );
    audit(currentUser(req).id, 'create', 'supplier', id, { name: f.name });
    res.status(201).json({ id });
  }),
);

purchasing.put(
  '/suppliers/:id',
  payer,
  h((req, res) => {
    const id = Number(req.params.id);
    const b = body(req);
    const f = supplierFields(b);
    if (get('SELECT 1 FROM suppliers WHERE name = ? AND id <> ?', f.name, id)) throw new HttpError(409, 'A supplier with that name already exists');
    const n = run(
      'UPDATE suppliers SET name=?, contact_name=?, phone=?, email=?, address=?, terms_days=?, notes=?, active=? WHERE id=?',
      f.name, f.contact_name, f.phone, f.email, f.address, f.terms_days, f.notes, b.active === false ? 0 : 1, id,
    ).changes;
    if (!n) throw new HttpError(404, 'Supplier not found');
    // Past purchases keep the name they were bought under; only the link moves with a rename.
    audit(currentUser(req).id, 'update', 'supplier', id, f);
    res.json({ ok: true });
  }),
);

/** A supplier statement: every delivery and every payment, with what is still owed. */
purchasing.get(
  '/suppliers/:id',
  books,
  h((req, res) => {
    const id = Number(req.params.id);
    const s = get(`${SUPPLIER_LIST} WHERE s.id = :id`, { ...supplierParams(), id });
    if (!s) throw new HttpError(404, 'Supplier not found');
    const bills = all(
      `SELECT p.id, p.ref, p.date, p.status, p.terms, p.invoice_no, p.due_date, p.total, ${PAID_SQL} AS paid, ${OWED_SQL} AS owed
         FROM purchases p WHERE p.supplier_id = ? AND p.status <> 'cancelled' ORDER BY p.date DESC, p.id DESC LIMIT 200`,
      id,
    );
    const payments = all(
      `SELECT sp.id, sp.date, sp.amount, sp.method, sp.reference, p.ref AS purchase_ref, u.name AS paid_by
         FROM supplier_payments sp JOIN purchases p ON p.id = sp.purchase_id LEFT JOIN users u ON u.id = sp.paid_by
        WHERE p.supplier_id = ? ORDER BY sp.date DESC, sp.id DESC LIMIT 200`,
      id,
    );
    const products = all('SELECT id, name, stock, reorder_level FROM products WHERE supplier_id = ? AND active = 1 ORDER BY name', id);
    res.json({ ...s, bills, payments, products });
  }),
);

/** Find a supplier by id, or by name (creating it the first time it's used), so typing a new supplier on a purchase just works. */
function resolveSupplier(b: Record<string, unknown>, userId: number): { id: number; name: string; terms_days: number } {
  if (b.supplier_id) {
    const s = get<{ id: number; name: string; terms_days: number }>('SELECT id, name, terms_days FROM suppliers WHERE id = ?', int(b, 'supplier_id', { min: 1 }));
    if (!s) throw bad('Unknown supplier');
    return s;
  }
  const name = str(b, 'supplier', { max: 120 });
  const found = get<{ id: number; name: string; terms_days: number }>('SELECT id, name, terms_days FROM suppliers WHERE name = ?', name);
  if (found) return found;
  const { id } = run('INSERT INTO suppliers (name) VALUES (?)', name);
  audit(userId, 'create', 'supplier', id, { name });
  return { id, name, terms_days: 0 };
}

// ---------- purchases: order → receive → pay ----------

type Line = { product_id: number; qty: number; unit_cost: number };
const costLines = (raw: unknown) => lines<Line>(raw, (l) => ({ unit_cost: int(l, 'unit_cost', { min: 0, max: 5_000_000 }) }));

/** Stock arrives: quantities rise and the weighted-average cost absorbs the new price, so cost of sales stays honest when suppliers change prices. */
function receiveLines(purchaseId: number, items: Line[]) {
  for (const l of items) {
    const p = get<Product>('SELECT * FROM products WHERE id = ?', l.product_id);
    if (!p) throw bad('Unknown product in purchase');
    if (!p.track_stock) throw bad(`${p.name} is made to order, so it isn't bought as stock`);
    const avg = Math.round((p.stock * p.avg_cost + l.qty * l.unit_cost) / (p.stock + l.qty));
    run('UPDATE products SET stock = stock + ?, avg_cost = ? WHERE id = ?', l.qty, avg, l.product_id);
    run('INSERT INTO purchase_items (purchase_id, product_id, qty, unit_cost) VALUES (?,?,?,?)', purchaseId, l.product_id, l.qty, l.unit_cost);
  }
}

/** How a delivery is paid. Older clients that don't say are treated as paid on the spot, as before. Credit bills get a due date from the supplier's terms. */
function paymentTerms(b: Record<string, unknown>, when: string, supplierTerms: number) {
  const terms: PurchaseTerms | null = b.terms === undefined || b.terms === null || b.terms === '' ? null : oneOf(b, 'terms', PURCHASE_TERMS);
  let due: string | null = null;
  if (terms === 'credit') {
    // A supplier with no agreed terms still gets two weeks before the bill shows as overdue.
    due = b.due_date ? date(b, 'due_date') : addDays(when, supplierTerms || 14);
    if (due < when) throw bad('The bill cannot be due before the goods arrived');
  }
  return { terms, due };
}

const PURCHASE_LIST = `
  SELECT p.id, p.ref, p.supplier, p.supplier_id, p.date, p.total, p.notes, p.status, p.terms, p.invoice_no, p.due_date,
         p.created_at, p.received_at, u.name AS recorded_by, ru.name AS received_by, ${PAID_SQL} AS paid, ${OWED_SQL} AS owed
    FROM purchases p LEFT JOIN users u ON u.id = p.recorded_by LEFT JOIN users ru ON ru.id = p.received_by`;

function withItems<T extends { id: number }>(purchases: T[]) {
  const items = purchases.length
    ? all<{ purchase_id: number }>(
        `SELECT pi.purchase_id, pi.product_id, pi.qty, pi.unit_cost, pr.name, pr.unit FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id
          WHERE pi.purchase_id IN (${purchases.map(() => '?').join(',')}) ORDER BY pi.id`,
        ...purchases.map((p) => p.id),
      )
    : [];
  return purchases.map((p) => ({ ...p, items: items.filter((i) => i.purchase_id === p.id) }));
}

purchasing.get(
  '/purchases',
  books,
  h((req, res) => {
    const { from, to } = range(req);
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    // Open orders are listed whatever their date: an order placed last month and still not delivered is today's problem.
    const purchases =
      status === 'ordered'
        ? all<{ id: number }>(`${PURCHASE_LIST} WHERE p.status = 'ordered' ORDER BY p.date, p.id`)
        : status === 'received' || status === 'cancelled'
          ? all<{ id: number }>(`${PURCHASE_LIST} WHERE p.date BETWEEN ? AND ? AND p.status = ? ORDER BY p.date DESC, p.id DESC LIMIT 500`, from, to, status)
          : all<{ id: number }>(`${PURCHASE_LIST} WHERE p.date BETWEEN ? AND ? AND p.status <> 'cancelled' ORDER BY p.date DESC, p.id DESC LIMIT 500`, from, to);
    const open = get<{ n: number; v: number }>("SELECT COUNT(*) n, COALESCE(SUM(total),0) v FROM purchases WHERE status = 'ordered'")!;
    res.json({ from, to, purchases: withItems(purchases), open_orders: open });
  }),
);

purchasing.get(
  '/purchases/:id',
  books,
  h((req, res) => {
    const p = get<{ id: number }>(`${PURCHASE_LIST} WHERE p.id = ?`, Number(req.params.id));
    if (!p) throw new HttpError(404, 'Purchase not found');
    const payments = all('SELECT sp.id, sp.date, sp.amount, sp.method, sp.reference, u.name AS paid_by FROM supplier_payments sp LEFT JOIN users u ON u.id = sp.paid_by WHERE sp.purchase_id = ? ORDER BY sp.id', p.id);
    res.json({ ...withItems([p])[0], payments });
  }),
);

purchasing.post(
  '/purchases',
  buyer,
  h((req, res) => {
    const user = currentUser(req);
    const b = body(req);
    const status = b.status === 'ordered' ? 'ordered' : 'received';
    const when = date(b, 'date', today());
    if (when > today()) throw bad('Purchase date cannot be in the future');
    const notes = str(b, 'notes', { max: 300, optional: true });
    const invoiceNo = str(b, 'invoice_no', { max: 60, optional: true }) || null;
    const items = costLines(b.items);
    const result = tx(() => {
      if (status === 'received') assertOpen(when);
      const supplier = resolveSupplier(b, user.id);
      const { terms, due } = status === 'received' ? paymentTerms(b, when, supplier.terms_days) : { terms: null, due: null };
      for (const l of items) {
        const p = get<Product>('SELECT * FROM products WHERE id = ?', l.product_id);
        if (!p) throw bad('Unknown product in purchase');
        if (!p.track_stock) throw bad(`${p.name} is made to order, so it isn't bought as stock`);
      }
      const total = items.reduce((s, l) => s + l.qty * l.unit_cost, 0);
      const ref = code('PO');
      const { id } = run(
        `INSERT INTO purchases (ref, supplier, supplier_id, date, total, notes, recorded_by, status, terms, invoice_no, due_date, received_at, received_by)
         VALUES (:ref, :supplier, :supplier_id, :date, :total, :notes, :user, :status, :terms, :invoice_no, :due,
                 CASE WHEN :status = 'received' THEN datetime('now') END, CASE WHEN :status = 'received' THEN :user END)`,
        { ref, supplier: supplier.name, supplier_id: supplier.id, date: when, total, notes: notes || null, user: user.id, status, terms, invoice_no: invoiceNo, due },
      );
      if (status === 'received') receiveLines(id, items);
      else for (const l of items) run('INSERT INTO purchase_items (purchase_id, product_id, qty, unit_cost) VALUES (?,?,?,?)', id, l.product_id, l.qty, l.unit_cost);
      audit(user.id, status === 'received' ? 'create' : 'order', 'purchase', id, { total, supplier: supplier.name, terms });
      return { id, ref, total, status };
    });
    res.status(201).json(result);
  }),
);

/** The delivery arrives. What actually came (and at what price) may differ from the order; that's what is booked. */
purchasing.post(
  '/purchases/:id/receive',
  buyer,
  h((req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const b = body(req);
    const when = date(b, 'date', today());
    if (when > today()) throw bad('Delivery date cannot be in the future');
    const result = tx(() => {
      const p = get<{ id: number; status: string; supplier_id: number | null; total: number }>('SELECT id, status, supplier_id, total FROM purchases WHERE id = ?', id);
      if (!p) throw new HttpError(404, 'Purchase not found');
      if (p.status !== 'ordered') throw new HttpError(409, p.status === 'received' ? 'This order has already been received' : 'This order was cancelled');
      assertOpen(when);
      const ordered = all<Line>('SELECT product_id, qty, unit_cost FROM purchase_items WHERE purchase_id = ?', id);
      const items = b.items === undefined ? ordered : costLines(b.items);
      const supplierTerms = get<{ t: number }>('SELECT terms_days t FROM suppliers WHERE id = ?', p.supplier_id ?? 0)?.t ?? 0;
      const { terms, due } = paymentTerms({ ...b, terms: b.terms ?? 'credit' }, when, supplierTerms);
      const total = items.reduce((s, l) => s + l.qty * l.unit_cost, 0);
      run('DELETE FROM purchase_items WHERE purchase_id = ?', id);
      receiveLines(id, items);
      run(
        `UPDATE purchases SET status = 'received', date = ?, total = ?, terms = ?, due_date = ?, invoice_no = COALESCE(?, invoice_no),
                received_at = datetime('now'), received_by = ? WHERE id = ?`,
        when, total, terms, due, str(b, 'invoice_no', { max: 60, optional: true }) || null, user.id, id,
      );
      audit(user.id, 'receive', 'purchase', id, { ordered: p.total, received: total, terms, short: total !== p.total || undefined });
      return { id, total };
    });
    res.json(result);
  }),
);

purchasing.post(
  '/purchases/:id/cancel',
  buyer,
  h((req, res) => {
    const id = Number(req.params.id);
    const reason = str(body(req), 'reason', { min: 3, max: 200 });
    tx(() => {
      const p = get<{ status: string; total: number; ref: string }>('SELECT status, total, ref FROM purchases WHERE id = ?', id);
      if (!p) throw new HttpError(404, 'Purchase not found');
      if (p.status !== 'ordered') throw new HttpError(409, 'Only an order that has not arrived can be cancelled');
      run("UPDATE purchases SET status = 'cancelled' WHERE id = ?", id);
      audit(currentUser(req).id, 'cancel', 'purchase', id, { reason, ref: p.ref, total: p.total });
    });
    res.json({ ok: true });
  }),
);

/** Pay a supplier bill (all or part). Never more than is owed. */
purchasing.post(
  '/purchases/:id/payments',
  payer,
  h((req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const b = body(req);
    const amount = int(b, 'amount', { min: 1, max: 1_000_000_000 });
    const method = oneOf(b, 'method', PAYMENT_METHODS);
    const when = date(b, 'date', today());
    if (when > today()) throw bad('Date cannot be in the future');
    const reference = str(b, 'reference', { max: 80, optional: true }) || null;
    const out = tx(() => {
      assertOpen(when);
      const p = get<{ owed: number; status: string; terms: string | null; ref: string; supplier: string }>(`SELECT p.status, p.terms, p.ref, p.supplier, ${OWED_SQL} AS owed FROM purchases p WHERE p.id = ?`, id);
      if (!p) throw new HttpError(404, 'Purchase not found');
      if (p.status !== 'received' || p.terms !== 'credit') throw new HttpError(409, 'Only a delivered bill on credit can be paid here');
      if (amount > p.owed) throw bad(`That is more than is owed on this bill (₦${p.owed.toLocaleString('en-NG')})`);
      const { id: pid } = run('INSERT INTO supplier_payments (purchase_id, amount, method, reference, date, paid_by) VALUES (?,?,?,?,?,?)', id, amount, method, reference, when, user.id);
      audit(user.id, 'pay_supplier', 'purchase', id, { amount, method, ref: p.ref, supplier: p.supplier, payment_id: pid });
      return { id: pid, owed: p.owed - amount };
    });
    res.status(201).json(out);
  }),
);

// ---------- payables: what the hotel owes, by how late it is ----------

export const AGING = [
  { key: 'current', label: 'Not yet due', min: -Infinity, max: 0 },
  { key: 'd30', label: '1–30 days', min: 1, max: 30 },
  { key: 'd60', label: '31–60 days', min: 31, max: 60 },
  { key: 'd90', label: '61–90 days', min: 61, max: 90 },
  { key: 'older', label: 'Over 90 days', min: 91, max: Infinity },
] as const;
export const bucketOf = (daysLate: number) => AGING.find((a) => daysLate >= a.min && daysLate <= a.max)!.key;

export function payables(asOf = today()) {
  const bills = all<{ id: number; ref: string; supplier: string; supplier_id: number; date: string; due_date: string; invoice_no: string | null; total: number; paid: number; owed: number }>(
    `SELECT * FROM (SELECT p.id, p.ref, p.supplier, p.supplier_id, p.date, p.due_date, p.invoice_no, p.total, ${PAID_SQL} AS paid, ${OWED_SQL} AS owed FROM purchases p)
      WHERE owed > 0 ORDER BY due_date, id`,
  ).map((b) => {
    const late = daysBetween(b.due_date ?? b.date, asOf);
    return { ...b, days_late: late, bucket: bucketOf(late) };
  });
  const buckets = Object.fromEntries(AGING.map((a) => [a.key, bills.filter((b) => b.bucket === a.key).reduce((s, b) => s + b.owed, 0)]));
  return { as_of: asOf, total: bills.reduce((s, b) => s + b.owed, 0), buckets, aging: AGING.map(({ key, label }) => ({ key, label })), bills };
}

purchasing.get(
  '/payables',
  books,
  h((req, res) => {
    res.json(payables(isDate(req.query.as_of) ? req.query.as_of : today()));
  }),
);
