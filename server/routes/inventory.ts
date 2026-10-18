import { Router } from 'express';
import { BOOKS, CHARGE_METHODS, PRODUCT_CATEGORIES, hasRole } from '../../shared/constants.ts';
import { allow, currentUser } from '../auth.ts';
import { assertOpen } from '../days.ts';
import { publish } from '../live.ts';
import { saleTaxes } from '../tax.ts';
import { all, audit, get, run, tx } from '../db.ts';
import { HttpError, bad, body, code, date, h, int, oneOf, range, str, today } from '../lib.ts';

export const inventory = Router();

/** A charge can only be posted to a guest who is in the building right now. */
export function inHouse(raw: unknown): number {
  const id = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(id) || id < 1) throw bad('Choose the guest room to charge');
  if (!get("SELECT 1 FROM reservations WHERE id = ? AND status = 'checked_in'", id)) throw new HttpError(409, 'That guest is no longer checked in');
  return id;
}

export type Product = { id: number; name: string; price: number; avg_cost: number; stock: number; active: number };

/** Validate an array of {product_id, qty, ...} lines and merge duplicates. */
export function lines<T extends { product_id: number; qty: number }>(raw: unknown, extra: (l: Record<string, unknown>) => Omit<T, 'product_id' | 'qty'>): T[] {
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
  allow('manager', 'bar', 'frontdesk', 'accountant', 'auditor'),
  h((req, res) => {
    const showCost = hasRole(req.user!.role, BOOKS);
    res.json(
      all(
        `SELECT p.id, p.name, p.category, p.unit, p.price, ${showCost ? 'p.avg_cost, p.supplier_id, s.name AS supplier,' : ''} p.stock, p.reorder_level, p.active,
                p.sku, p.barcode, p.description, p.image_v
           FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
          ${req.query.all === '1' && showCost ? '' : 'WHERE p.active = 1'} ORDER BY p.category, p.name`,
      ),
    );
  }),
);

export const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
export const BARCODE_RE = /^[0-9A-Za-z-]{4,32}$/;

export function productFields(b: Record<string, unknown>) {
  const supplierId = b.supplier_id ? int(b, 'supplier_id', { min: 1 }) : null;
  if (supplierId && !get('SELECT 1 FROM suppliers WHERE id = ?', supplierId)) throw bad('Unknown supplier');
  return {
    name: str(b, 'name', { max: 80 }),
    category: oneOf(b, 'category', PRODUCT_CATEGORIES),
    unit: str(b, 'unit', { max: 20 }),
    price: int(b, 'price', { min: 0, max: 5_000_000 }),
    reorder_level: int(b, 'reorder_level', { min: 0, max: 10_000 }),
    sku: str(b, 'sku', { max: 32, optional: true, pattern: SKU_RE }).toUpperCase() || null,
    barcode: str(b, 'barcode', { max: 32, optional: true, pattern: BARCODE_RE }) || null,
    description: str(b, 'description', { max: 300, optional: true }) || null,
    supplier_id: supplierId,
  };
}

/** SKUs and barcodes identify one item each: a scanner or an import must never hit two. */
export function assertUniqueCodes(f: { sku: string | null; barcode: string | null }, exceptId = 0) {
  if (f.sku && get('SELECT 1 FROM products WHERE sku = ? COLLATE NOCASE AND id <> ?', f.sku, exceptId)) throw new HttpError(409, `SKU ${f.sku} is already used by another item`);
  if (f.barcode && get('SELECT 1 FROM products WHERE barcode = ? AND id <> ?', f.barcode, exceptId)) throw new HttpError(409, `Barcode ${f.barcode} is already used by another item`);
}

inventory.post(
  '/products',
  allow('manager'),
  h((req, res) => {
    const f = productFields(body(req));
    assertUniqueCodes(f);
    const { id } = run(
      'INSERT INTO products (name, category, unit, price, reorder_level, sku, barcode, description, supplier_id) VALUES (?,?,?,?,?,?,?,?,?)',
      f.name, f.category, f.unit, f.price, f.reorder_level, f.sku, f.barcode, f.description, f.supplier_id,
    );
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
    const before = get('SELECT name, price, active, sku, barcode FROM products WHERE id = ?', id);
    if (!before) throw new HttpError(404, 'Product not found');
    assertUniqueCodes(f, id);
    run(
      'UPDATE products SET name=?, category=?, unit=?, price=?, reorder_level=?, active=?, sku=?, barcode=?, description=?, supplier_id=? WHERE id=?',
      f.name, f.category, f.unit, f.price, f.reorder_level, active, f.sku, f.barcode, f.description, f.supplier_id, id,
    );
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
      assertOpen(today());
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
    const method = oneOf(b, 'method', CHARGE_METHODS);
    const items = lines(b.items, () => ({}));
    const sale = tx(() => {
      assertOpen(today());
      const reservationId = method === 'room' ? inHouse(b.reservation_id) : null;
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
      const { id } = run(
        'INSERT INTO sales (receipt_no, date, method, reservation_id, total, cost_total, staff_id) VALUES (?,?,?,?,?,?,?)',
        receipt, today(), method, reservationId, total, cost, user.id,
      );
      if (reservationId) audit(user.id, 'room_charge', 'reservation', reservationId, { amount: total, receipt });
      for (const l of priced) {
        run('INSERT INTO sale_items (sale_id, product_id, qty, unit_price, unit_cost) VALUES (?,?,?,?,?)', id, l.product_id, l.qty, l.unit_price, l.unit_cost);
        run('UPDATE products SET stock = stock - ? WHERE id = ?', l.qty, l.product_id);
      }
      return { id, receipt_no: receipt, total };
    });
    publish('sales', 'stock', 'money', 'activity');
    res.status(201).json(sale);
  }),
);

/**
 * Void a till mistake: the items go back on the shelf at the cost they left at, and the receipt is
 * removed. Manager only, open days only, and a room charge only while the guest's bill is still open.
 * The full receipt is kept in the activity log.
 */
inventory.post(
  '/sales/:id/void',
  allow('manager'),
  h((req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const reason = str(body(req), 'reason', { min: 3, max: 200 });
    tx(() => {
      const sale = get<{ id: number; receipt_no: string; date: string; method: string; reservation_id: number | null; total: number }>('SELECT * FROM sales WHERE id = ?', id);
      if (!sale) throw new HttpError(404, 'Receipt not found');
      assertOpen(sale.date);
      if (sale.reservation_id && !get("SELECT 1 FROM reservations WHERE id = ? AND status = 'checked_in'", sale.reservation_id)) {
        throw new HttpError(409, "The guest has checked out, so their bill is closed. Give the money back as a refund instead.");
      }
      const items = all<{ product_id: number; qty: number; unit_price: number; unit_cost: number }>('SELECT product_id, qty, unit_price, unit_cost FROM sale_items WHERE sale_id = ?', id);
      for (const l of items) {
        const p = get<Product>('SELECT * FROM products WHERE id = ?', l.product_id)!;
        const avg = Math.round((p.stock * p.avg_cost + l.qty * l.unit_cost) / (p.stock + l.qty));
        run('UPDATE products SET stock = stock + ?, avg_cost = ? WHERE id = ?', l.qty, avg, l.product_id);
      }
      run('DELETE FROM sales WHERE id = ?', id);
      audit(user.id, 'void', 'sale', id, { reason, ...sale, items });
    });
    res.json({ ok: true });
  }),
);

/** One receipt, for printing. Bar staff can reprint today's receipts only, like the till list. */
inventory.get(
  '/sales/:id',
  allow('manager', 'bar', 'accountant', 'auditor'),
  h((req, res) => {
    const sale = get<{ id: number; date: string }>(
      `SELECT s.id, s.receipt_no, s.date, s.created_at, s.method, s.total, u.name AS staff, rm.number AS room_number, g.name AS guest_name
         FROM sales s LEFT JOIN users u ON u.id = s.staff_id
         LEFT JOIN reservations r ON r.id = s.reservation_id LEFT JOIN rooms rm ON rm.id = r.room_id LEFT JOIN guests g ON g.id = r.guest_id
        WHERE s.id = ?`,
      Number(req.params.id),
    );
    if (!sale || (!hasRole(req.user!.role, BOOKS) && sale.date !== today())) throw new HttpError(404, 'Receipt not found');
    const items = all('SELECT si.qty, si.unit_price, p.name FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? ORDER BY si.id', sale.id);
    res.json({ ...sale, items, taxes: saleTaxes(sale.id) });
  }),
);

inventory.get(
  '/sales',
  allow('manager', 'bar', 'accountant', 'auditor'),
  h((req, res) => {
    // Bar staff see today's till only; managers and the books can look back.
    const { from, to } = hasRole(req.user!.role, BOOKS) ? range(req) : { from: today(), to: today() };
    const sales = all<{ id: number }>(
      `SELECT s.id, s.receipt_no, s.date, s.created_at, s.method, s.total, u.name AS staff, rm.number AS room_number
         FROM sales s LEFT JOIN users u ON u.id = s.staff_id
         LEFT JOIN reservations r ON r.id = s.reservation_id LEFT JOIN rooms rm ON rm.id = r.room_id
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
              COALESCE(SUM(CASE WHEN method='pos' THEN total END),0) AS pos,
              COALESCE(SUM(CASE WHEN method='room' THEN total END),0) AS room
         FROM sales WHERE date BETWEEN ? AND ?`,
      from,
      to,
    );
    res.json({ from, to, summary, sales: sales.map((s) => ({ ...s, items: items.filter((i) => i.sale_id === s.id) })) });
  }),
);
