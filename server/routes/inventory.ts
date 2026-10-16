import { Router } from 'express';
import { PAYMENT_METHODS, PRODUCT_CATEGORIES } from '../../shared/constants.ts';
import { allow, currentUser } from '../auth.ts';
import { all, audit, get, run, tx } from '../db.ts';
import { HttpError, bad, body, code, date, h, int, oneOf, range, str, today } from '../lib.ts';

export const inventory = Router();

type Product = { id: number; name: string; price: number; avg_cost: number; stock: number; active: number };

/** Validate an array of {product_id, qty, ...} lines and merge duplicates. */
function lines<T extends { product_id: number; qty: number }>(raw: unknown, extra: (l: Record<string, unknown>) => Omit<T, 'product_id' | 'qty'>): T[] {
  if (!Array.isArray(raw) || raw.length === 0) throw bad('Add at least one item');
  if (raw.length > 60) throw bad('Too many lines on one receipt');
  const merged = new Map<number, T>();
  for (const l of raw) {
    if (!l || typeof l !== 'object') throw bad('Invalid item');
    const line = l as Record<string, unknown>;
    const product_id = int(line, 'product_id', { min: 1 });
    const qty = int(line, 'qty', { min: 1, max: 5000 });
    const prev = merged.get(product_id);
    if (prev) prev.qty += qty;
    else merged.set(product_id, { product_id, qty, ...extra(line) } as T);
  }
  return [...merged.values()];
}

// ---------- products & stock ----------

inventory.get(
  '/products',
  allow('manager', 'bar', 'frontdesk'),
  h((req, res) => {
    const showCost = req.user?.role === 'manager';
    res.json(
      all(
        `SELECT id, name, category, unit, price, ${showCost ? 'avg_cost,' : ''} stock, reorder_level, active
           FROM products ${req.query.all === '1' && showCost ? '' : 'WHERE active = 1'} ORDER BY category, name`,
      ),
    );
  }),
);

function productFields(b: Record<string, unknown>) {
  return {
    name: str(b, 'name', { max: 80 }),
    category: oneOf(b, 'category', PRODUCT_CATEGORIES),
    unit: str(b, 'unit', { max: 20 }),
    price: int(b, 'price', { min: 0, max: 5_000_000 }),
    reorder_level: int(b, 'reorder_level', { min: 0, max: 10_000 }),
  };
}

inventory.post(
  '/products',
  allow('manager'),
  h((req, res) => {
    const f = productFields(body(req));
    const { id } = run('INSERT INTO products (name, category, unit, price, reorder_level) VALUES (?,?,?,?,?)', f.name, f.category, f.unit, f.price, f.reorder_level);
    audit(currentUser(req).id, 'create', 'product', id, f);
    res.status(201).json({ id });
  }),
);

inventory.patch(
  '/products/:id',
  allow('manager'),
  h((req, res) => {
    const b = body(req);
    const f = productFields(b);
    const active = b.active === false ? 0 : 1;
    const id = Number(req.params.id);
    const before = get('SELECT name, price, active FROM products WHERE id = ?', id);
    if (!before) throw new HttpError(404, 'Product not found');
    run('UPDATE products SET name=?, category=?, unit=?, price=?, reorder_level=?, active=? WHERE id=?', f.name, f.category, f.unit, f.price, f.reorder_level, active, id);
    audit(currentUser(req).id, 'update', 'product', id, { before, after: { ...f, active } });
    res.json({ ok: true });
  }),
);

/** Breakages, spoilage, count corrections. Always needs a reason; always audited. */
inventory.post(
  '/products/:id/adjust',
  allow('manager'),
  h((req, res) => {
    const b = body(req);
    const change = int(b, 'change', { min: -10_000, max: 10_000 });
    if (change === 0) throw bad('Change cannot be zero');
    const reason = str(b, 'reason', { max: 200 });
    const id = Number(req.params.id);
    tx(() => {
      const p = get<Product>('SELECT * FROM products WHERE id = ?', id);
      if (!p) throw new HttpError(404, 'Product not found');
      if (p.stock + change < 0) throw bad(`Only ${p.stock} in stock`);
      run('UPDATE products SET stock = stock + ? WHERE id = ?', change, id);
      audit(currentUser(req).id, 'stock_adjust', 'product', id, { change, reason, value: change * p.avg_cost });
    });
    res.json({ ok: true });
  }),
);

// ---------- point of sale: drinks & confectionery ----------

inventory.post(
  '/sales',
  allow('manager', 'bar'),
  h((req, res) => {
    const user = currentUser(req);
    const b = body(req);
    const method = oneOf(b, 'method', PAYMENT_METHODS);
    const items = lines(b.items, () => ({}));
    const sale = tx(() => {
      let total = 0;
      let cost = 0;
      const priced = items.map((l) => {
        // Prices always come from the database, never from the till.
        const p = get<Product>('SELECT * FROM products WHERE id = ?', l.product_id);
        if (!p || !p.active) throw bad('One of the items is no longer on sale');
        if (p.stock < l.qty) throw new HttpError(409, `Only ${p.stock} × ${p.name} left in stock`);
        total += p.price * l.qty;
        cost += p.avg_cost * l.qty;
        return { ...l, unit_price: p.price, unit_cost: p.avg_cost };
      });
      const receipt = code('RC');
      const { id } = run('INSERT INTO sales (receipt_no, date, method, total, cost_total, staff_id) VALUES (?,?,?,?,?,?)', receipt, today(), method, total, cost, user.id);
      for (const l of priced) {
        run('INSERT INTO sale_items (sale_id, product_id, qty, unit_price, unit_cost) VALUES (?,?,?,?,?)', id, l.product_id, l.qty, l.unit_price, l.unit_cost);
        run('UPDATE products SET stock = stock - ? WHERE id = ?', l.qty, l.product_id);
      }
      return { id, receipt_no: receipt, total };
    });
    res.status(201).json(sale);
  }),
);

inventory.get(
  '/sales',
  allow('manager', 'bar'),
  h((req, res) => {
    // Bar staff see today's till only; managers can look back.
    const { from, to } = req.user?.role === 'manager' ? range(req) : { from: today(), to: today() };
    const sales = all<{ id: number }>(
      `SELECT s.id, s.receipt_no, s.date, s.created_at, s.method, s.total, u.name AS staff
         FROM sales s LEFT JOIN users u ON u.id = s.staff_id
        WHERE s.date BETWEEN ? AND ? ORDER BY s.id DESC LIMIT 300`,
      from,
      to,
    );
    const items = sales.length
      ? all<{ sale_id: number }>(
          `SELECT si.sale_id, si.qty, si.unit_price, p.name FROM sale_items si JOIN products p ON p.id = si.product_id
            WHERE si.sale_id IN (${sales.map(() => '?').join(',')})`,
          ...sales.map((s) => s.id),
        )
      : [];
    const summary = get(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total,
              COALESCE(SUM(CASE WHEN method='cash' THEN total END),0) AS cash,
              COALESCE(SUM(CASE WHEN method='transfer' THEN total END),0) AS transfer,
              COALESCE(SUM(CASE WHEN method='pos' THEN total END),0) AS pos
         FROM sales WHERE date BETWEEN ? AND ?`,
      from,
      to,
    );
    res.json({ from, to, summary, sales: sales.map((s) => ({ ...s, items: items.filter((i) => i.sale_id === s.id) })) });
  }),
);

// ---------- purchases: restocking drinks & confectionery ----------

inventory.get(
  '/purchases',
  allow('manager'),
  h((req, res) => {
    const { from, to } = range(req);
    const purchases = all<{ id: number }>(
      `SELECT p.id, p.ref, p.supplier, p.date, p.total, p.notes, u.name AS recorded_by
         FROM purchases p LEFT JOIN users u ON u.id = p.recorded_by
        WHERE p.date BETWEEN ? AND ? ORDER BY p.date DESC, p.id DESC`,
      from,
      to,
    );
    const items = purchases.length
      ? all<{ purchase_id: number }>(
          `SELECT pi.purchase_id, pi.qty, pi.unit_cost, pr.name FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id
            WHERE pi.purchase_id IN (${purchases.map(() => '?').join(',')})`,
          ...purchases.map((p) => p.id),
        )
      : [];
    res.json({ from, to, purchases: purchases.map((p) => ({ ...p, items: items.filter((i) => i.purchase_id === p.id) })) });
  }),
);

inventory.post(
  '/purchases',
  allow('manager'),
  h((req, res) => {
    const user = currentUser(req);
    const b = body(req);
    const supplier = str(b, 'supplier', { max: 120 });
    const when = date(b, 'date', today());
    if (when > today()) throw bad('Purchase date cannot be in the future');
    const notes = str(b, 'notes', { max: 300, optional: true });
    const items = lines<{ product_id: number; qty: number; unit_cost: number }>(b.items, (l) => ({ unit_cost: int(l, 'unit_cost', { min: 0, max: 5_000_000 }) }));
    const result = tx(() => {
      const total = items.reduce((s, l) => s + l.qty * l.unit_cost, 0);
      const ref = code('PO');
      const { id } = run('INSERT INTO purchases (ref, supplier, date, total, notes, recorded_by) VALUES (?,?,?,?,?,?)', ref, supplier, when, total, notes || null, user.id);
      for (const l of items) {
        const p = get<Product>('SELECT * FROM products WHERE id = ?', l.product_id);
        if (!p) throw bad('Unknown product in purchase');
        // Weighted average cost keeps cost-of-sales honest when supplier prices move.
        const avg = Math.round((p.stock * p.avg_cost + l.qty * l.unit_cost) / (p.stock + l.qty));
        run('UPDATE products SET stock = stock + ?, avg_cost = ? WHERE id = ?', l.qty, avg, l.product_id);
        run('INSERT INTO purchase_items (purchase_id, product_id, qty, unit_cost) VALUES (?,?,?,?)', id, l.product_id, l.qty, l.unit_cost);
      }
      audit(user.id, 'create', 'purchase', id, { total, supplier });
      return { id, ref, total };
    });
    res.status(201).json(result);
  }),
);
