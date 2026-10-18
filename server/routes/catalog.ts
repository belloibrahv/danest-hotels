import { Router } from 'express';
import { BOOKS, PRODUCT_CATEGORIES, PURCHASE_TERMS, ROLES, hasRole, type ProductCategory } from '../../shared/constants.ts';
import { allow, currentUser } from '../auth.ts';
import { assertOpen } from '../days.ts';
import { all, audit, get, run, tx } from '../db.ts';
import { HttpError, addDays, bad, body, code, h, isDate, oneOf, str, today } from '../lib.ts';
import { csv } from '../csv.ts';
import { readPhoto } from '../images.ts';
import { BARCODE_RE, SKU_RE } from './inventory.ts';

/** The product catalogue around the till: photos, bulk upload and export, stock cards and what is selling. */
export const catalog = Router();
const books = allow(...BOOKS);

// ---------- photos ----------

const MAX_IMAGE = 400 * 1024;

catalog.put(
  '/products/:id/image',
  allow('manager'),
  h((req, res) => {
    const id = Number(req.params.id);
    const { bytes, mime } = readPhoto(body(req).data, MAX_IMAGE);
    if (!get('SELECT 1 FROM products WHERE id = ?', id)) throw new HttpError(404, 'Product not found');
    tx(() => {
      run("INSERT OR REPLACE INTO product_images (product_id, mime, data, updated_at) VALUES (?,?,?, datetime('now'))", id, mime, bytes);
      run('UPDATE products SET image_v = image_v + 1 WHERE id = ?', id);
      audit(currentUser(req).id, 'photo', 'product', id, { bytes: bytes.length });
    });
    res.json({ image_v: get<{ v: number }>('SELECT image_v v FROM products WHERE id = ?', id)!.v });
  }),
);

catalog.delete(
  '/products/:id/image',
  allow('manager'),
  h((req, res) => {
    const id = Number(req.params.id);
    tx(() => {
      run('DELETE FROM product_images WHERE product_id = ?', id);
      run('UPDATE products SET image_v = 0 WHERE id = ?', id);
      audit(currentUser(req).id, 'photo_removed', 'product', id);
    });
    res.json({ ok: true });
  }),
);

catalog.get(
  '/products/:id/image',
  allow(...ROLES),
  h((req, res) => {
    const img = get<{ mime: string; data: Uint8Array }>('SELECT mime, data FROM product_images WHERE product_id = ?', Number(req.params.id));
    if (!img) throw new HttpError(404, 'No photo');
    // The URL carries the photo's version, so a browser can keep it until the photo changes.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.type(img.mime).send(Buffer.from(img.data));
  }),
);

// ---------- bulk upload ----------

/**
 * One row per item, matched to an existing item by SKU, then by name. Blank cells keep what is
 * already there. receive_qty puts stock on the shelf through a single purchase, so it is costed
 * like any delivery. The whole file is checked first and saved all-or-nothing.
 */
type ImportRow = Record<string, unknown>;
type Plan = {
  row: number;
  action: 'create' | 'update';
  id?: number;
  name: string;
  sku: string | null;
  fields: Record<string, string | number | null>;
  receive: { qty: number; unit_cost: number } | null;
  supplier: string | null;
};

const CATEGORY_ALIASES: Record<string, ProductCategory> = { drink: 'drinks', drinks: 'drinks', beverage: 'drinks', beverages: 'drinks', confectionery: 'confectionery', snack: 'confectionery', snacks: 'confectionery', sweets: 'confectionery', food: 'food', meal: 'food', meals: 'food', kitchen: 'food', menu: 'food' };
const cell = (r: ImportRow, k: string) => (r[k] === undefined || r[k] === null ? '' : String(r[k]).trim());
const money = (v: string) => {
  const n = Number(v.replace(/[₦,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
};

function planImport(rows: ImportRow[]) {
  const plans: Plan[] = [];
  const errors: { row: number; message: string }[] = [];
  const seenSku = new Set<string>();
  const seenBarcode = new Set<string>();
  const seenName = new Set<string>();
  rows.forEach((r, i) => {
    const row = i + 2; // the header is row 1 in the spreadsheet
    const fail = (message: string) => errors.push({ row, message });
    const sku = cell(r, 'sku').toUpperCase() || null;
    const name = cell(r, 'name');
    if (sku && !SKU_RE.test(sku)) return fail(`SKU "${sku}" can only use letters, numbers, dots, dashes and underscores`);
    const existing = (sku && get<{ id: number; name: string; avg_cost: number; sku: string | null }>('SELECT id, name, avg_cost, sku FROM products WHERE sku = ? COLLATE NOCASE', sku)) ||
      (name && get<{ id: number; name: string; avg_cost: number; sku: string | null }>('SELECT id, name, avg_cost, sku FROM products WHERE name = ? COLLATE NOCASE', name)) ||
      undefined;
    if (!existing && !name) return fail('Give each new item a name');
    if (name.length > 80) return fail('Name is longer than 80 characters');
    const key = (existing?.id ? `#${existing.id}` : name.toLowerCase());
    if (seenName.has(key)) return fail(`"${name || existing?.name}" appears twice in the file`);
    seenName.add(key);

    const fields: Plan['fields'] = {};
    if (name && existing && name !== existing.name) fields.name = name;
    if (!existing) fields.name = name;
    if (sku) {
      if (seenSku.has(sku)) return fail(`SKU ${sku} appears twice in the file`);
      seenSku.add(sku);
      if (sku !== existing?.sku?.toUpperCase()) fields.sku = sku;
    }
    const catRaw = cell(r, 'category').toLowerCase();
    if (catRaw) {
      const cat = CATEGORY_ALIASES[catRaw];
      if (!cat) return fail(`Category "${catRaw}" should be drinks or confectionery`);
      fields.category = cat;
    } else if (!existing) return fail('Give each new item a category (drinks or confectionery)');
    const unit = cell(r, 'unit');
    if (unit) fields.unit = unit.slice(0, 20);
    else if (!existing) fields.unit = fields.category === 'drinks' ? 'bottle' : fields.category === 'food' ? 'plate' : 'pack';
    if (!existing && fields.category === 'food') fields.track_stock = 0;
    const priceRaw = cell(r, 'price');
    if (priceRaw) {
      const p = money(priceRaw);
      if (Number.isNaN(p) || p > 5_000_000) return fail(`Price "${priceRaw}" is not a valid amount`);
      fields.price = p;
    } else if (!existing) return fail('Give each new item a selling price');
    const reorderRaw = cell(r, 'reorder_level');
    if (reorderRaw) {
      const n = Number(reorderRaw);
      if (!Number.isInteger(n) || n < 0 || n > 10_000) return fail(`Reorder level "${reorderRaw}" should be a whole number`);
      fields.reorder_level = n;
    } else if (!existing) fields.reorder_level = 12;
    const barcode = cell(r, 'barcode');
    if (barcode) {
      if (!BARCODE_RE.test(barcode)) return fail(`Barcode "${barcode}" is not valid`);
      if (seenBarcode.has(barcode)) return fail(`Barcode ${barcode} appears twice in the file`);
      seenBarcode.add(barcode);
      if (get('SELECT 1 FROM products WHERE barcode = ? AND id <> ?', barcode, existing?.id ?? 0)) return fail(`Barcode ${barcode} already belongs to another item`);
      fields.barcode = barcode;
    }
    if (sku && get('SELECT 1 FROM products WHERE sku = ? COLLATE NOCASE AND id <> ?', sku, existing?.id ?? 0)) return fail(`SKU ${sku} already belongs to another item`);
    const description = cell(r, 'description');
    if (description) fields.description = description.slice(0, 300);
    const supplier = cell(r, 'supplier').slice(0, 120) || null;

    let receive: Plan['receive'] = null;
    const qtyRaw = cell(r, 'receive_qty');
    if (qtyRaw && qtyRaw !== '0') {
      const qty = Number(qtyRaw);
      if (!Number.isInteger(qty) || qty < 1 || qty > 100_000) return fail(`receive_qty "${qtyRaw}" should be a whole number`);
      const costRaw = cell(r, 'unit_cost');
      const cost = costRaw ? money(costRaw) : existing?.avg_cost ?? NaN;
      if (Number.isNaN(cost) || cost > 5_000_000) return fail('Give the unit cost for the stock being received');
      receive = { qty, unit_cost: cost };
    }
    if (existing && !Object.keys(fields).length && !receive && !supplier) return;
    plans.push({ row, action: existing ? 'update' : 'create', id: existing?.id, name: name || existing!.name, sku, fields, receive, supplier });
  });
  return { plans, errors };
}

function supplierId(name: string, userId: number) {
  const s = get<{ id: number }>('SELECT id FROM suppliers WHERE name = ?', name);
  if (s) return s.id;
  const { id } = run('INSERT INTO suppliers (name) VALUES (?)', name);
  audit(userId, 'create', 'supplier', id, { name, via: 'import' });
  return id;
}

catalog.post(
  '/products/import',
  allow('manager'),
  h((req, res) => {
    const user = currentUser(req);
    const b = body(req);
    if (!Array.isArray(b.rows) || b.rows.length === 0) throw bad('The file has no rows');
    if (b.rows.length > 1000) throw bad('Upload at most 1,000 items at a time');
    const terms = b.terms === undefined || b.terms === '' ? null : oneOf(b, 'terms', PURCHASE_TERMS);
    const receivedFrom = str(b, 'received_from', { max: 120, optional: true }) || 'Opening stock';
    const { plans, errors } = planImport(b.rows as ImportRow[]);
    const stockLines = plans.filter((p) => p.receive);
    const summary = {
      create: plans.filter((p) => p.action === 'create').length,
      update: plans.filter((p) => p.action === 'update').length,
      receive_units: stockLines.reduce((a, p) => a + p.receive!.qty, 0),
      receive_value: stockLines.reduce((a, p) => a + p.receive!.qty * p.receive!.unit_cost, 0),
      errors: errors.length,
    };
    if (b.dry_run === true) return res.json({ summary, errors, rows: plans.map(({ row, action, name, sku, fields, receive }) => ({ row, action, name, sku, changes: Object.keys(fields), receive })) });
    if (errors.length) return res.status(400).json({ error: `${errors.length} row${errors.length > 1 ? 's need' : ' needs'} fixing before anything is saved`, errors, summary });

    const result = tx(() => {
      if (stockLines.length) assertOpen(today());
      const ids = new Map<number, number>();
      for (const p of plans) {
        const f = { ...p.fields } as Record<string, string | number | null>;
        if (p.supplier) f.supplier_id = supplierId(p.supplier, user.id);
        if (p.action === 'create') {
          const cols = Object.keys(f);
          const { id } = run(`INSERT INTO products (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => f[c]));
          ids.set(p.row, id);
        } else if (Object.keys(f).length) {
          run(`UPDATE products SET ${Object.keys(f).map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...Object.values(f), p.id!);
          ids.set(p.row, p.id!);
        } else ids.set(p.row, p.id!);
      }
      let purchase: { id: number; ref: string; total: number } | null = null;
      if (stockLines.length) {
        const sid = supplierId(receivedFrom, user.id);
        const total = summary.receive_value;
        const ref = code('PO');
        const { id } = run(
          `INSERT INTO purchases (ref, supplier, supplier_id, date, total, notes, recorded_by, status, terms, due_date, received_at, received_by)
           VALUES (?,?,?,?,?,?,?, 'received', ?, ?, datetime('now'), ?)`,
          ref, receivedFrom, sid, today(), total, `Stock received through a file upload (${stockLines.length} items)`, user.id, terms, terms === 'credit' ? addDays(today(), 14) : null, user.id,
        );
        for (const p of stockLines) {
          const pid = ids.get(p.row)!;
          const cur = get<{ stock: number; avg_cost: number }>('SELECT stock, avg_cost FROM products WHERE id = ?', pid)!;
          const avg = Math.round((cur.stock * cur.avg_cost + p.receive!.qty * p.receive!.unit_cost) / (cur.stock + p.receive!.qty));
          run('UPDATE products SET stock = stock + ?, avg_cost = ? WHERE id = ?', p.receive!.qty, avg, pid);
          run('INSERT INTO purchase_items (purchase_id, product_id, qty, unit_cost) VALUES (?,?,?,?)', id, pid, p.receive!.qty, p.receive!.unit_cost);
        }
        purchase = { id, ref, total };
      }
      audit(user.id, 'import', 'product', null, { ...summary, purchase: purchase?.ref });
      return { ...summary, purchase };
    });
    res.status(201).json(result);
  }),
);

// ---------- export ----------

catalog.get(
  '/products.csv',
  allow('manager', 'bar', 'accountant', 'auditor'),
  h((req, res) => {
    const showCost = hasRole(req.user!.role, BOOKS);
    const rows = all<Record<string, string | number | null>>(
      `SELECT p.sku, p.name, p.category, p.unit, p.price, p.reorder_level, p.barcode, p.description, s.name AS supplier, p.stock, p.avg_cost, p.active
         FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.category, p.name`,
    );
    // The columns match the upload template, so the file can be edited and uploaded straight back.
    // in_stock is for reading only: uploading never overwrites a count (use receive_qty or a stock count).
    const head = ['sku', 'name', 'category', 'unit', 'price', 'reorder_level', 'barcode', 'description', 'supplier', 'in_stock', ...(showCost ? ['avg_cost', 'stock_value'] : []), 'on_sale'];
    const out = rows.map((r) => [r.sku, r.name, r.category, r.unit, r.price, r.reorder_level, r.barcode, r.description, r.supplier, r.stock, ...(showCost ? [r.avg_cost, Number(r.stock) * Number(r.avg_cost)] : []), r.active ? 'yes' : 'no']);
    csv(res, `danest-stock-${today()}.csv`, [head, ...out]);
  }),
);

// ---------- stock card: every movement of one item, with the running balance ----------

catalog.get(
  '/products/:id/card',
  allow('manager', 'bar', 'accountant', 'auditor'),
  h((req, res) => {
    const id = Number(req.params.id);
    const showCost = hasRole(req.user!.role, BOOKS);
    const p = get<{ id: number; name: string; stock: number; avg_cost: number; unit: string }>('SELECT id, name, stock, avg_cost, unit FROM products WHERE id = ?', id);
    if (!p) throw new HttpError(404, 'Product not found');
    const moves = all<{ kind: string; date: string; at: string; ref: string | null; change: number; unit_cost: number | null; unit_price: number | null; party: string | null; by: string | null; balance?: number }>(
      `SELECT * FROM (
         SELECT 'received' AS kind, pu.date, COALESCE(pu.received_at, pu.created_at) AS at, pu.ref, pi.qty AS change, pi.unit_cost, NULL AS unit_price, pu.supplier AS party, u.name AS by
           FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id LEFT JOIN users u ON u.id = pu.received_by
          WHERE pi.product_id = :id AND pu.status = 'received'
         UNION ALL
         SELECT CASE WHEN s.method = 'room' THEN 'room_charge' ELSE 'sold' END, s.date, s.created_at, s.receipt_no, -si.qty, si.unit_cost, si.unit_price, rm.number, u.name
           FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN users u ON u.id = s.staff_id
           LEFT JOIN reservations r ON r.id = s.reservation_id LEFT JOIN rooms rm ON rm.id = r.room_id
          WHERE si.product_id = :id
         UNION ALL
         SELECT 'counted', date(a.created_at, '+1 hour'), a.created_at, json_extract(a.detail, '$.reason'), json_extract(a.detail, '$.change'), NULL, NULL, NULL, u.name
           FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
          WHERE a.action = 'stock_adjust' AND a.entity = 'product' AND a.entity_id = :id
       ) ORDER BY at, kind`,
      { id },
    );
    // Work back from today's count, so the card always agrees with the shelf.
    const net = moves.reduce((a, m) => a + m.change, 0);
    let balance = p.stock - net;
    const opening = balance;
    for (const m of moves) m.balance = balance += m.change;
    const from = isDate(req.query.from) ? req.query.from : addDays(today(), -89);
    const shown = moves.filter((m) => m.date >= from).reverse().slice(0, 500);
    res.json({
      product: { ...p, avg_cost: showCost ? p.avg_cost : undefined },
      opening_before_records: opening,
      from,
      moves: shown.map((m) => (showCost ? m : { ...m, unit_cost: undefined })),
    });
  }),
);

// ---------- insights: what sells, what sits, what to reorder ----------

catalog.get(
  '/stock/insights',
  books,
  h((req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 180);
    const to = today();
    const from = addDays(to, -(days - 1));
    const items = all<{ id: number; name: string; category: string; unit: string; stock: number; reorder_level: number; price: number; avg_cost: number; sold: number; revenue: number; cost: number; last_sold: string | null; image_v: number; supplier: string | null; track_stock: number }>(
      `SELECT p.id, p.name, p.category, p.unit, p.stock, p.reorder_level, p.price, p.avg_cost, p.image_v, p.track_stock, sup.name AS supplier,
              COALESCE(x.sold, 0) AS sold, COALESCE(x.revenue, 0) AS revenue, COALESCE(x.cost, 0) AS cost,
              (SELECT MAX(s2.date) FROM sale_items si2 JOIN sales s2 ON s2.id = si2.sale_id WHERE si2.product_id = p.id) AS last_sold
         FROM products p LEFT JOIN suppliers sup ON sup.id = p.supplier_id
         LEFT JOIN (SELECT si.product_id, SUM(si.qty) sold, SUM(si.qty * si.unit_price) revenue, SUM(si.qty * si.unit_cost) cost
                      FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.date BETWEEN ? AND ? GROUP BY si.product_id) x ON x.product_id = p.id
        WHERE p.active = 1`,
      from,
      to,
    ).map((p) => {
      const perDay = p.sold / days;
      const cover = perDay > 0 ? p.stock / perDay : null;
      // Enough for three weeks of the recent pace, topped up from what's on the shelf.
      const suggest = !p.track_stock ? 0 : Math.max(0, Math.ceil(perDay * 21) - p.stock, p.stock <= p.reorder_level ? p.reorder_level * 2 - p.stock : 0);
      return { ...p, per_day: Math.round(perDay * 10) / 10, cover_days: cover === null || !p.track_stock ? null : Math.floor(cover), profit: p.revenue - p.cost, suggest };
    });
    const shrink = all<{ id: number; name: string; units: number; value: number }>(
      `SELECT a.entity_id AS id, p.name, -SUM(json_extract(a.detail, '$.change')) AS units, -SUM(json_extract(a.detail, '$.value')) AS value
         FROM audit_log a JOIN products p ON p.id = a.entity_id
        WHERE a.action = 'stock_adjust' AND json_extract(a.detail, '$.change') < 0 AND date(a.created_at, '+1 hour') BETWEEN ? AND ?
        GROUP BY a.entity_id ORDER BY value DESC LIMIT 10`,
      from,
      to,
    );
    const daily = all<{ date: string; units: number; revenue: number; profit: number }>(
      `WITH RECURSIVE d(day) AS (SELECT ? UNION ALL SELECT date(day, '+1 day') FROM d WHERE day < ?)
       SELECT d.day AS date, COALESCE(SUM(si.qty), 0) AS units, COALESCE(SUM(si.qty * si.unit_price), 0) AS revenue, COALESCE(SUM(si.qty * (si.unit_price - si.unit_cost)), 0) AS profit
         FROM d LEFT JOIN sales s ON s.date = d.day LEFT JOIN sale_items si ON si.sale_id = s.id
        GROUP BY d.day ORDER BY d.day`,
      from,
      to,
    );
    const value = items.reduce((a, p) => a + p.stock * p.avg_cost, 0);
    const revenue = items.reduce((a, p) => a + p.revenue, 0);
    const cogs = items.reduce((a, p) => a + p.cost, 0);
    res.json({
      from,
      to,
      days,
      totals: {
        items: items.length,
        units_on_hand: items.reduce((a, p) => a + p.stock, 0),
        value_at_cost: value,
        value_at_price: items.reduce((a, p) => a + p.stock * p.price, 0),
        revenue,
        profit: revenue - cogs,
        units_sold: items.reduce((a, p) => a + p.sold, 0),
        out_of_stock: items.filter((p) => p.track_stock && p.stock === 0).length,
        to_reorder: items.filter((p) => p.suggest > 0).length,
        // Turnover: how many times the shelf's worth sold over the period, at cost.
        turns: value > 0 ? Math.round((cogs / value) * 100) / 100 : null,
        shrinkage_value: shrink.reduce((a, s) => a + s.value, 0),
      },
      best: [...items].filter((p) => p.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 8),
      slow: [...items].filter((p) => p.track_stock && p.stock > 0 && p.sold === 0).sort((a, b) => b.stock * b.avg_cost - a.stock * a.avg_cost).slice(0, 8),
      reorder: [...items].filter((p) => p.suggest > 0).sort((a, b) => (a.cover_days ?? 9999) - (b.cover_days ?? 9999)).slice(0, 20),
      categories: PRODUCT_CATEGORIES.map((c) => {
        const xs = items.filter((p) => p.category === c);
        return { category: c, revenue: xs.reduce((a, p) => a + p.revenue, 0), profit: xs.reduce((a, p) => a + p.profit, 0), value: xs.reduce((a, p) => a + p.stock * p.avg_cost, 0) };
      }),
      shrink,
      daily,
      items,
    });
  }),
);
