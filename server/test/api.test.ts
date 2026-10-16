// Runs the real app against an in-memory database seeded with the demo data.
process.env.DANEST_DB = ':memory:';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

const { createApp } = await import('../app.ts');
const { seed } = await import('../seed.ts');
const { addDays, today } = await import('../lib.ts');
const { get } = await import('../db.ts');

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

before(async () => {
  seed();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
});
after(() => server.close());

type Opts = { cookie?: string; body?: unknown; method?: string; csrf?: boolean; origin?: string };
async function call(path: string, o: Opts = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (o.csrf !== false) headers['x-danest-request'] = '1';
  if (o.cookie) headers.cookie = o.cookie;
  if (o.origin) headers.origin = o.origin;
  const res = await fetch(base + path, { method: o.method ?? (o.body ? 'POST' : 'GET'), headers, body: o.body ? JSON.stringify(o.body) : undefined });
  const text = await res.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, headers: res.headers };
}

async function login(username: string) {
  const r = await call('/auth/login', { body: { username, password: 'Danest@2026!' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.headers.get('set-cookie')!.split(';')[0];
}

describe('security', () => {
  test('mutations without the CSRF header are refused', async () => {
    const r = await call('/auth/login', { body: { username: 'manager', password: 'Danest@2026!' }, csrf: false });
    assert.equal(r.status, 403);
  });

  test('cross-origin mutations are refused', async () => {
    const r = await call('/auth/login', { body: { username: 'manager', password: 'Danest@2026!' }, origin: 'https://evil.example' });
    assert.equal(r.status, 403);
  });

  test('session cookie is HttpOnly and SameSite=Strict', async () => {
    const r = await call('/auth/login', { body: { username: 'bar', password: 'Danest@2026!' } });
    const c = r.headers.get('set-cookie')!;
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Strict/);
  });

  test('wrong password and unknown user give the same answer', async () => {
    const a = await call('/auth/login', { body: { username: 'manager', password: 'nope-nope-nope' } });
    const b = await call('/auth/login', { body: { username: 'ghost', password: 'nope-nope-nope' } });
    assert.equal(a.status, 401);
    assert.deepEqual(a.json, b.json);
  });

  test('login is rate limited per account', async () => {
    let last = 0;
    for (let i = 0; i < 9; i++) last = (await call('/auth/login', { body: { username: 'frontdesk2', password: 'wrong-password' } })).status;
    assert.equal(last, 429);
  });

  test('roles are enforced: bar staff cannot see finances or reservations', async () => {
    const bar = await login('bar');
    for (const p of ['/reports/pnl', '/expenses', '/reservations', '/users', '/purchases', '/dashboard']) {
      assert.equal((await call(p, { cookie: bar })).status, 403, p);
    }
    assert.equal((await call('/products', { cookie: bar })).json[0].avg_cost, undefined, 'cost prices are manager-only');
  });

  test('front desk cannot override the room rate or see the P&L', async () => {
    const desk = await login('frontdesk');
    assert.equal((await call('/reports/pnl', { cookie: desk })).status, 403);
    const r = await call('/reservations', {
      cookie: desk,
      body: { guest: { name: 'Rate Cheat', phone: '08030000000' }, room_type_id: 1, check_in: addDays(today(), 40), check_out: addDays(today(), 41), adults: 1, source: 'phone', rate: 1000 },
    });
    assert.equal(r.status, 403);
  });

  test('unauthenticated staff routes return 401', async () => {
    assert.equal((await call('/dashboard')).status, 401);
  });

  test('CSV export neutralises formula injection', async () => {
    const m = await login('manager');
    await call('/expenses', { cookie: m, body: { category: 'other', description: '=HYPERLINK("http://x")', amount: 100, method: 'cash' } });
    const r = await call('/reports/pnl.csv', { cookie: m });
    assert.equal(r.status, 200);
    assert.doesNotMatch(String(r.json), /^"=/m);
  });
});

describe('business flows', () => {
  test('website booking request → confirm → check in → pay → check out', async () => {
    const ci = today();
    const co = addDays(ci, 2);
    const types = (await call(`/public/room-types?check_in=${ci}&check_out=${co}`)).json as { id: number; available: number; rate: number }[];
    const type = types.find((t) => t.available > 0);
    assert.ok(type, 'some room type should be free tonight');

    const req = await call('/public/booking-requests', { body: { name: 'Test Guest', phone: '08031234567', check_in: ci, check_out: co, room_type_id: type.id, adults: 1 } });
    assert.equal(req.status, 201, JSON.stringify(req.json));
    assert.equal(req.json.total, type.rate * 2);

    const desk = await login('frontdesk');
    const list = (await call(`/reservations?status=pending&q=Test%20Guest`, { cookie: desk })).json;
    const id = list[0].id;
    const rooms = (await call(`/availability?check_in=${ci}&check_out=${co}&room_type_id=${type.id}`, { cookie: desk })).json as { id: number; status: string }[];
    const room = rooms[0];
    assert.ok(room);

    assert.equal((await call(`/reservations/${id}/confirm`, { cookie: desk, body: { room_id: room.id } })).status, 200);
    if (room.status !== 'available') {
      assert.equal((await call(`/reservations/${id}/check-in`, { cookie: desk, body: {} })).status, 409, 'room must be ready');
      assert.equal((await call(`/rooms/${room.id}/status`, { cookie: desk, method: 'PATCH', body: { status: 'available' } })).status, 200);
    }
    assert.equal((await call(`/reservations/${id}/check-in`, { cookie: desk, body: {} })).status, 200);
    assert.equal(get<{ status: string }>('SELECT status FROM rooms WHERE id = ?', room.id)!.status, 'occupied');

    // Can't leave owing money.
    assert.equal((await call(`/reservations/${id}/check-out`, { cookie: desk, body: {} })).status, 409);
    assert.equal((await call(`/reservations/${id}/payments`, { cookie: desk, body: { amount: type.rate * 3, method: 'pos' } })).status, 400, 'overpayment refused');
    assert.equal((await call(`/reservations/${id}/payments`, { cookie: desk, body: { amount: type.rate * 2, method: 'pos' } })).status, 201);
    assert.equal((await call(`/reservations/${id}/check-out`, { cookie: desk, body: {} })).status, 200);
    assert.equal(get<{ status: string }>('SELECT status FROM rooms WHERE id = ?', room.id)!.status, 'cleaning');
  });

  test('a room cannot be double-booked', async () => {
    const desk = await login('frontdesk');
    const ci = addDays(today(), 60);
    const co = addDays(ci, 3);
    const room = (await call(`/availability?check_in=${ci}&check_out=${co}&room_type_id=1`, { cookie: desk })).json[0];
    const mk = (i: string, o: string) =>
      call('/reservations', { cookie: desk, body: { guest: { name: 'Double', phone: '08030000001' }, room_type_id: 1, room_id: room.id, check_in: i, check_out: o, adults: 1, source: 'phone' } });
    assert.equal((await mk(ci, co)).status, 201);
    assert.equal((await mk(addDays(ci, 1), addDays(co, 1))).status, 409);
    assert.equal((await mk(co, addDays(co, 1))).status, 201, 'back-to-back stays are fine');
  });

  test('a sale uses database prices, reduces stock and records cost', async () => {
    const bar = await login('bar');
    const before = get<{ stock: number; price: number; avg_cost: number }>('SELECT stock, price, avg_cost FROM products WHERE id = 13')!;
    const r = await call('/sales', { cookie: bar, body: { method: 'cash', items: [{ product_id: 13, qty: 2, unit_price: 1 }] } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.total, before.price * 2);
    assert.equal(get<{ stock: number }>('SELECT stock FROM products WHERE id = 13')!.stock, before.stock - 2);
  });

  test('cannot sell more than is in stock', async () => {
    const bar = await login('bar');
    const p = get<{ stock: number }>('SELECT stock FROM products WHERE id = 1')!;
    assert.equal((await call('/sales', { cookie: bar, body: { method: 'cash', items: [{ product_id: 1, qty: p.stock + 1 }] } })).status, 409);
  });

  test('a purchase adds stock and moves the average cost', async () => {
    const m = await login('manager');
    const p = get<{ stock: number; avg_cost: number }>('SELECT stock, avg_cost FROM products WHERE id = 2')!;
    const r = await call('/purchases', { cookie: m, body: { supplier: 'Test supplier', items: [{ product_id: 2, qty: 10, unit_cost: 2000 }] } });
    assert.equal(r.status, 201);
    const after = get<{ stock: number; avg_cost: number }>('SELECT stock, avg_cost FROM products WHERE id = 2')!;
    assert.equal(after.stock, p.stock + 10);
    assert.equal(after.avg_cost, Math.round((p.stock * p.avg_cost + 20000) / (p.stock + 10)));
  });

  test('P&L adds up', async () => {
    const m = await login('manager');
    const p = (await call(`/reports/pnl?from=${addDays(today(), -60)}&to=${today()}`, { cookie: m })).json;
    const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0);
    assert.equal(sum(p.revenue), p.totalRevenue);
    assert.equal(p.totalRevenue - sum(p.costOfSales) - sum(p.operating), p.netProfit);
    assert.ok(p.totalRevenue > 0 && p.totalOperating > 0);
  });
});
