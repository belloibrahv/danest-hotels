// The owner, accountant and auditor's tools, run against the demo hotel in memory.
process.env.DANEST_DB = ':memory:';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

const { createApp } = await import('../app.ts');
const { seed } = await import('../seed.ts');
const { addDays, today } = await import('../lib.ts');
const { get } = await import('../db.ts');
const { closeAll } = await import('../live.ts');

let base = '';
let owner = '', manager = '', accountant = '', auditor = '', bar = '', desk = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
before(async () => {
  seed();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
  [owner, manager, accountant, auditor, bar, desk] = await Promise.all(['owner', 'manager', 'accountant', 'auditor', 'bar', 'frontdesk'].map(login));
});
after(() => {
  closeAll();
  server.closeAllConnections();
  server.close();
});

async function call(path: string, o: { cookie?: string; body?: unknown; method?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-danest-request': '1' };
  if (o.cookie) headers.cookie = o.cookie;
  const res = await fetch(base + path, { method: o.method ?? (o.body ? 'POST' : 'GET'), headers, body: o.body ? JSON.stringify(o.body) : undefined });
  const text = await res.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, headers: res.headers };
}
const ok = (r: { status: number; json: unknown }, status = 200) => assert.equal(r.status, status, JSON.stringify(r.json));
const login = async (u: string) => {
  const r = await call('/auth/login', { body: { username: u, password: 'Danest@2026!' } });
  ok(r);
  return r.headers.get('set-cookie')!.split(';')[0];
};


describe('who sees what', () => {
  test('the owner can do everything a manager can, plus the executive view', async () => {
    for (const p of ['/executive', '/reports/pnl', '/users', '/close-day', '/rate-rules', '/accounts/overview']) ok(await call(p, { cookie: owner }));
  });

  test('the books are closed to the till and the front desk', async () => {
    for (const p of ['/accounts/overview', '/accounts/cashbook', '/payables', '/review/exceptions', '/executive', '/stock/insights']) {
      assert.equal((await call(p, { cookie: bar })).status, 403, `bar: ${p}`);
      assert.equal((await call(p, { cookie: desk })).status, 403, `frontdesk: ${p}`);
    }
  });

  test('the accountant runs the books but not the hotel', async () => {
    for (const p of ['/accounts/overview', '/accounts/receivables', '/payables', '/suppliers', '/reports/pnl', '/expenses', '/review/queries']) ok(await call(p, { cookie: accountant }));
    for (const p of ['/executive', '/review/trail', '/users', '/rate-rules']) assert.equal((await call(p, { cookie: accountant })).status, 403, p);
    ok(await call('/expenses', { cookie: accountant, body: { category: 'other', description: 'Bank charges', amount: 1500, method: 'transfer' } }), 201);
  });

  test('the auditor reads everything and changes nothing', async () => {
    for (const p of ['/accounts/cashbook', '/review/exceptions', '/review/trail', '/users', '/purchases', '/close-day', '/products']) ok(await call(p, { cookie: auditor }));
    assert.ok((await call('/products', { cookie: auditor })).json[0].avg_cost !== undefined, 'the auditor sees cost prices');
    for (const [path, body] of [
      ['/expenses', { category: 'other', description: 'x', amount: 1, method: 'cash' }],
      ['/purchases', { supplier: 'X', items: [{ product_id: 1, qty: 1, unit_cost: 1 }] }],
      ['/products', { name: 'X', category: 'drinks', unit: 'can', price: 1, reorder_level: 1 }],
      ['/suppliers', { name: 'Auditor Supplies' }],
      ['/close-day', { date: today(), counted_cash: 0 }],
    ] as const) {
      assert.equal((await call(path, { cookie: auditor, body })).status, 403, path);
    }
    assert.equal((await call('/targets', { cookie: auditor, method: 'PUT', body: { month: today().slice(0, 7), lines: [{ key: 'expense:other', amount: 1 }] } })).status, 403);
  });

  test("only the owner can create or change an owner's account", async () => {
    const r = await call('/users', { cookie: manager, body: { name: 'New Owner', username: 'newowner', role: 'ceo', password: 'a long password' } });
    assert.equal(r.status, 403);
    const ownerId = get<{ id: number }>("SELECT id FROM users WHERE username = 'owner'")!.id;
    assert.equal((await call(`/users/${ownerId}`, { cookie: manager, method: 'PATCH', body: { active: false } })).status, 403);
    const acc = get<{ id: number }>("SELECT id FROM users WHERE username = 'accountant'")!.id;
    assert.equal((await call(`/users/${acc}`, { cookie: manager, method: 'PATCH', body: { role: 'ceo' } })).status, 403);
    ok(await call('/users', { cookie: owner, body: { name: 'Co Owner', username: 'coowner', role: 'ceo', password: 'a long password' } }), 201);
  });
});

describe('upgrading a hotel from before owners existed', () => {
  test('its manager can promote the first owner, and only the first', async () => {
    const { run } = await import('../db.ts');
    run("UPDATE users SET active = 0 WHERE role = 'ceo'");
    const desk2 = get<{ id: number }>("SELECT id FROM users WHERE username = 'frontdesk2'")!.id;
    ok(await call(`/users/${desk2}`, { cookie: manager, method: 'PATCH', body: { role: 'ceo' } }));
    const hk = get<{ id: number }>("SELECT id FROM users WHERE username = 'housekeeping'")!.id;
    assert.equal((await call(`/users/${hk}`, { cookie: manager, method: 'PATCH', body: { role: 'ceo' } })).status, 403, 'a second owner needs the owner');
    run("UPDATE users SET role = 'frontdesk' WHERE id = ?", desk2);
    run("UPDATE users SET active = 1 WHERE role = 'ceo'");
  });
});

describe('buying stock: order, receive, pay', () => {
  let orderId = 0;
  const stockOf = (id: number) => get<{ stock: number; avg_cost: number }>('SELECT stock, avg_cost FROM products WHERE id = ?', id)!;

  test('an order does not touch stock until it is received', async () => {
    const before = stockOf(3);
    const r = await call('/purchases', { cookie: manager, body: { status: 'ordered', supplier: 'Brand New Distributor', items: [{ product_id: 3, qty: 24, unit_cost: 2000 }] } });
    ok(r, 201);
    orderId = r.json.id;
    assert.deepEqual(stockOf(3), before);
    assert.ok(get("SELECT 1 FROM suppliers WHERE name = 'Brand New Distributor'"), 'a new supplier is created on first use');
    const open = (await call('/purchases?status=ordered', { cookie: accountant })).json;
    assert.ok(open.purchases.some((p: any) => p.id === orderId));
  });

  test('receiving books what actually arrived, on credit with a due date', async () => {
    const before = stockOf(3);
    ok(await call(`/purchases/${orderId}/receive`, { cookie: accountant, body: { terms: 'credit' } }), 403);
    const r = await call(`/purchases/${orderId}/receive`, { cookie: manager, body: { terms: 'credit', invoice_no: 'INV-9', items: [{ product_id: 3, qty: 20, unit_cost: 2000 }] } });
    ok(r);
    assert.equal(r.json.total, 40_000);
    const after = stockOf(3);
    assert.equal(after.stock, before.stock + 20);
    assert.equal(after.avg_cost, Math.round((before.stock * before.avg_cost + 20 * 2000) / (before.stock + 20)));
    const p = get<{ status: string; due_date: string; terms: string }>('SELECT status, due_date, terms FROM purchases WHERE id = ?', orderId)!;
    assert.equal(p.status, 'received');
    assert.equal(p.terms, 'credit');
    assert.equal(p.due_date, addDays(today(), 14), 'no agreed terms: two weeks');
    ok(await call(`/purchases/${orderId}/receive`, { cookie: manager, body: { terms: 'cash' } }), 409);
    ok(await call(`/purchases/${orderId}/cancel`, { cookie: manager, body: { reason: 'too late' } }), 409);
  });

  test('the accountant pays the bill in parts, never more than is owed', async () => {
    const pay = (amount: number) => call(`/purchases/${orderId}/payments`, { cookie: accountant, body: { amount, method: 'transfer', reference: 'TRF-1' } });
    ok(await pay(15_000), 201);
    assert.equal((await pay(30_000)).status, 400);
    const payables = (await call('/payables', { cookie: auditor })).json;
    assert.equal(payables.bills.find((b: any) => b.id === orderId).owed, 25_000);
    ok(await pay(25_000), 201);
    assert.equal((await pay(1)).status, 400, 'a settled bill owes nothing, so any payment is too much');
    const book = (await call('/accounts/cashbook', { cookie: accountant })).json;
    assert.ok(book.rows.some((r: any) => r.dir === 'out' && r.source === 'Supplier bill paid' && r.amount === 25_000));
  });

  test('a paid-on-delivery purchase is money out on the day; an order can be cancelled', async () => {
    const r = await call('/purchases', { cookie: manager, body: { supplier: 'Dugbe Wholesale Mart', terms: 'cash', items: [{ product_id: 2, qty: 6, unit_cost: 1100 }] } });
    ok(r, 201);
    const book = (await call('/accounts/cashbook?method=cash', { cookie: accountant })).json;
    assert.ok(book.rows.some((x: any) => x.ref === r.json.ref && x.amount === 6600 && x.dir === 'out'));
    assert.equal((await call(`/purchases/${r.json.id}/payments`, { cookie: accountant, body: { amount: 1, method: 'cash' } })).status, 409);
    const o = await call('/purchases', { cookie: manager, body: { status: 'ordered', supplier_id: 1, items: [{ product_id: 2, qty: 1, unit_cost: 1 }] } });
    ok(await call(`/purchases/${o.json.id}/cancel`, { cookie: manager, body: { reason: 'Supplier out of stock' } }));
  });
});

describe('the cash book adds up', () => {
  test('money in less money out equals the net, channel by channel', async () => {
    const { summary, rows } = (await call('/accounts/cashbook', { cookie: auditor })).json;
    const sum = (dir: string) => rows.filter((r: any) => r.dir === dir).reduce((a: number, r: any) => a + r.amount, 0);
    assert.equal(summary.in, sum('in'));
    assert.equal(summary.out, sum('out'));
    assert.equal(summary.net, summary.in - summary.out);
    assert.equal(summary.accounts.reduce((a: number, x: any) => a + x.net, 0), summary.net);
  });

  test('company balances age from the oldest unpaid stay', async () => {
    const r = (await call('/accounts/receivables', { cookie: accountant })).json;
    for (const c of r.companies) {
      assert.equal(c.open.reduce((a: number, o: any) => a + o.amount, 0), c.balance);
      const books = get<{ v: number }>(
        `SELECT COALESCE((SELECT SUM(p.amount) FROM payments p JOIN reservations r ON r.id = p.reservation_id WHERE p.method = 'company' AND r.company_id = ?1), 0)
              - COALESCE((SELECT SUM(amount) FROM company_payments WHERE company_id = ?1), 0) v`,
        c.id,
      )!.v;
      assert.equal(c.balance, books, `${c.name} balance matches the ledger`);
    }
    assert.equal(r.total, r.guest_total + r.company_total);
  });
});

describe('bulk upload', () => {
  test('a dry run reports every problem and saves nothing', async () => {
    const n = get<{ n: number }>('SELECT COUNT(*) n FROM products')!.n;
    const r = await call('/products/import', { cookie: manager, body: { dry_run: true, rows: [
      { name: 'Zobo 50cl', category: 'drinks', price: '800', receive_qty: '24', unit_cost: '400' },
      { name: 'Puff puff', category: 'pastry', price: '200' },
      { sku: 'DRK-001', price: '1,650' },
      { sku: 'DRK-001', price: '1,700' },
    ] } });
    ok(r);
    assert.equal(r.json.summary.errors, 2);
    assert.match(r.json.errors.map((e: any) => e.message).join(' | '), /pastry.*twice|twice.*pastry/s);
    assert.equal(get<{ n: number }>('SELECT COUNT(*) n FROM products')!.n, n);
    const commit = await call('/products/import', { cookie: manager, body: { rows: [{ name: 'Puff puff', category: 'pastry', price: '200' }] } });
    assert.equal(commit.status, 400, 'a file with errors is not partly saved');
  });

  test('a clean file adds, updates and receives stock through one costed purchase', async () => {
    const star = get<{ stock: number; price: number }>("SELECT stock, price FROM products WHERE sku = 'DRK-001'")!;
    const r = await call('/products/import', { cookie: manager, body: { received_from: 'Opening count', rows: [
      { name: 'Zobo 50cl', category: 'drinks', price: '₦800', receive_qty: '24', unit_cost: '400', supplier: 'Mama Titi Snacks', barcode: '6159990001' },
      { sku: 'drk-001', price: '1,650', receive_qty: '12', unit_cost: '1100' },
    ] } });
    ok(r, 201);
    assert.equal(r.json.create, 1);
    assert.equal(r.json.update, 1);
    assert.equal(r.json.receive_units, 36);
    const zobo = get<{ stock: number; avg_cost: number; supplier_id: number }>("SELECT stock, avg_cost, supplier_id FROM products WHERE name = 'Zobo 50cl'")!;
    assert.deepEqual([zobo.stock, zobo.avg_cost], [24, 400]);
    const after = get<{ stock: number; price: number }>("SELECT stock, price FROM products WHERE sku = 'DRK-001'")!;
    assert.deepEqual([after.stock, after.price], [star.stock + 12, 1650]);
    const po = get<{ total: number; supplier: string }>('SELECT total, supplier FROM purchases WHERE ref = ?', r.json.purchase.ref)!;
    assert.deepEqual([po.total, po.supplier], [24 * 400 + 12 * 1100, 'Opening count']);
    // The stock card agrees with the shelf.
    const card = (await call(`/products/${get<{ id: number }>("SELECT id FROM products WHERE name = 'Zobo 50cl'")!.id}/card`, { cookie: bar })).json;
    assert.equal(card.moves[0].balance, 24);
    assert.equal(card.moves[0].unit_cost, undefined, 'bar staff never see cost prices');
  });

  test('the barcode scanner finds the item; codes must be unique', async () => {
    const r = await call('/products', { cookie: manager, body: { name: 'Clone', category: 'drinks', unit: 'can', price: 1, reorder_level: 1, barcode: '6159990001' } });
    assert.equal(r.status, 409);
  });

  test('export opens in Excel and round-trips', async () => {
    const res = await fetch(`${base}/products.csv`, { headers: { cookie: bar } });
    assert.equal(res.status, 200);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'starts with a BOM so Excel reads the naira sign and accents');
    const text = bytes.subarray(3).toString('utf8');
    assert.ok(text.startsWith('"sku","name","category"'), 'same columns as the upload template');
    assert.ok(!text.includes('avg_cost'), 'no costs in the bar export');
  });
});

describe('product photos', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  test('only real images are accepted, and served with their real type', async () => {
    assert.equal((await call('/products/1/image', { cookie: manager, method: 'PUT', body: { data: Buffer.from('<svg onload=alert(1)>').toString('base64') } })).status, 400);
    assert.equal((await call('/products/1/image', { cookie: bar, method: 'PUT', body: { data: png.toString('base64') } })).status, 403);
    const r = await call('/products/1/image', { cookie: manager, method: 'PUT', body: { data: png.toString('base64') } });
    ok(r);
    const img = await fetch(`${base}/products/1/image?v=${r.json.image_v}`, { headers: { cookie: bar } });
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), png);
    assert.equal((await fetch(`${base}/products/1/image`)).status, 401, 'photos are for signed-in staff');
  });
});

describe('audit: exceptions and queries', () => {
  test('write-offs and cash differences show as exceptions', async () => {
    ok(await call('/products/2/adjust', { cookie: manager, body: { change: -1, reason: 'Dropped a bottle' } }));
    const r = (await call('/review/exceptions', { cookie: auditor })).json;
    assert.ok(r.items.some((e: any) => e.kind === 'shrinkage' && /Dropped a bottle/.test(e.summary)));
    const all = (await call(`/review/exceptions?from=${addDays(today(), -120)}&to=${today()}`, { cookie: auditor })).json;
    const variances = get<{ n: number }>('SELECT COUNT(*) n FROM day_closures WHERE variance <> 0')!.n;
    assert.equal(all.summary.by_kind.find((k: any) => k.kind === 'cash_variance').count, variances);
  });

  test('the auditor asks, management answers, the auditor closes', async () => {
    const q = await call('/review/queries', { cookie: auditor, body: { kind: 'shrinkage', ref_id: 2, question: 'Who dropped it, and was it charged?' } });
    ok(q, 201);
    assert.equal((await call(`/review/queries/${q.json.id}/answer`, { cookie: auditor, body: { answer: 'me' } })).status, 403, 'the auditor cannot answer their own query');
    assert.equal((await call('/review/queries', { cookie: manager, body: { kind: 'x', question: 'Can I ask?' } })).status, 403);
    ok(await call(`/review/queries/${q.json.id}/answer`, { cookie: accountant, body: { answer: 'Bar staff; deducted from wages.' } }));
    ok(await call(`/review/queries/${q.json.id}/follow-up`, { cookie: auditor, body: { question: 'Show me the payroll line.' } }));
    assert.equal(get<{ status: string }>('SELECT status FROM audit_queries WHERE id = ?', q.json.id)!.status, 'open');
    ok(await call(`/review/queries/${q.json.id}/answer`, { cookie: manager, body: { answer: 'Line 14 of this month’s payroll.' } }));
    ok(await call(`/review/queries/${q.json.id}/close`, { cookie: auditor, body: {} }));
    const row = get<{ status: string; answer: string }>('SELECT status, answer FROM audit_queries WHERE id = ?', q.json.id)!;
    assert.equal(row.status, 'closed');
    assert.match(row.answer, /deducted from wages[\s\S]*Line 14/, 'every answer stays on record');
    assert.equal((await call(`/review/queries/${q.json.id}/answer`, { cookie: manager, body: { answer: 'late' } })).status, 409);
  });

  test('the trail can be filtered and exported, and the export itself is logged', async () => {
    const r = (await call('/review/trail?action=stock_adjust', { cookie: auditor })).json;
    assert.ok(r.rows.length > 0 && r.rows.every((x: any) => x.action === 'stock_adjust'));
    const res = await fetch(`${base}/review/trail.csv?action=stock_adjust`, { headers: { cookie: auditor } });
    assert.equal(res.status, 200);
    assert.ok(get("SELECT 1 FROM audit_log WHERE action = 'export' AND entity = 'audit_log'"));
  });
});

describe('targets and the executive view', () => {
  const month = today().slice(0, 7);
  test('the owner sets targets; the accountant sets cost budgets only', async () => {
    assert.equal((await call('/targets', { cookie: accountant, method: 'PUT', body: { month, lines: [{ key: 'revenue', amount: 1 }] } })).status, 403);
    ok(await call('/targets', { cookie: accountant, method: 'PUT', body: { month, lines: [{ key: 'expense:diesel', amount: 5_000_000 }] } }));
    ok(await call('/targets', { cookie: owner, method: 'PUT', body: { month, lines: [{ key: 'revenue', amount: 30_000_000 }, { key: 'adr', amount: null }] } }));
    assert.equal((await call('/targets', { cookie: owner, method: 'PUT', body: { month, lines: [{ key: 'occupancy', amount: 140 }] } })).status, 400);
    const b = (await call(`/accounts/budget?month=${month}`, { cookie: auditor })).json;
    assert.equal(b.lines.find((l: any) => l.key === 'diesel').budget, 5_000_000);
  });

  test('like-for-like comparisons and a month-end projection', async () => {
    const d = (await call('/executive', { cookie: owner })).json;
    assert.equal(d.month, month);
    assert.equal(d.trend.length, 12);
    const days = (s: string, e: string) => (Date.parse(e) - Date.parse(s)) / 86_400_000 + 1;
    assert.equal(days(d.previous.from, d.previous.to), Math.min(d.elapsed, days(d.previous.from, addDays(`${d.month}-01`, -1))), 'same number of days last month');
    assert.ok(d.projection.revenue >= d.now.revenue, 'the month can only end at or above what is already earned');
    const goal = d.goals.find((g: any) => g.key === 'revenue');
    assert.equal(goal.target, 30_000_000);
    assert.equal(goal.actual, d.now.revenue);
    assert.equal(d.goals.find((g: any) => g.key === 'adr'), undefined, 'a cleared target is gone');
    assert.ok(d.risks.no_two_step.length > 0, 'accounts that see money without two-step sign-in are flagged');
  });
});

describe('live updates', () => {
  test('a sale reaches an open till screen as a topic, never as data', async () => {
    const ctl = new AbortController();
    const res = await fetch(`${base}/live`, { headers: { cookie: desk }, signal: ctl.signal });
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let got = dec.decode((await reader.read()).value);
    const productId = get<{ id: number }>('SELECT id FROM products WHERE active = 1 AND stock > 5 LIMIT 1')!.id;
    ok(await call('/sales', { cookie: bar, body: { method: 'cash', items: [{ product_id: productId, qty: 1 }] } }), 201);
    while (!got.includes('event: change')) got += dec.decode((await reader.read()).value);
    const change = JSON.parse(got.split('event: change\ndata: ')[1].split('\n')[0]);
    assert.ok(change.topics.includes('sales') && change.topics.includes('stock'));
    assert.deepEqual(Object.keys(change), ['topics'], 'no amounts, names or ids are broadcast');
    ctl.abort();
  });

  test('a signed-out browser cannot listen', async () => {
    assert.equal((await fetch(`${base}/live`)).status, 401);
  });
});
