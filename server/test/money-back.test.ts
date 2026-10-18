// Giving money back and correcting mistakes: refunds, kept deposits, voids, overstays. Empty database.
process.env.DANEST_DB = ':memory:';
process.env.DANEST_SETUP_CODE = 'SETUP-4';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

const { createApp } = await import('../app.ts');
const { addDays, today } = await import('../lib.ts');
const { get, run } = await import('../db.ts');

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
});
after(() => server.close());

async function call(path: string, o: { cookie?: string; body?: unknown; method?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-danest-request': '1' };
  if (o.cookie) headers.cookie = o.cookie;
  const res = await fetch(base + path, { method: o.method ?? (o.body ? 'POST' : 'GET'), headers, body: o.body ? JSON.stringify(o.body) : undefined });
  const text = await res.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const ok = (r: { status: number; json: unknown }, s = 200) => assert.equal(r.status, s, JSON.stringify(r.json));
const login = async (username: string) => {
  const r = await call('/auth/login', { body: { username, password: 'a long staff password' } });
  ok(r);
  return r.cookie!;
};
const t = today();

let owner = '';
let desk = '';
let bar = '';
let hk = '';
let typeId = 0;
const RATE = 20000;

const collected = async () => (await call(`/close-day?date=${t}`, { cookie: owner })).json.report.collections.byMethod as Record<string, number>;
const pnl = async () => (await call(`/reports/pnl?from=${t}&to=${t}`, { cookie: owner })).json;
const stream = (p: { revenue: { key: string; amount: number }[] }, key: string) => p.revenue.find((r) => r.key === key)!.amount;
const book = async (cookie: string, checkIn: string, nights: number, extra: Record<string, unknown> = {}) => {
  const r = await call('/reservations', { cookie, body: { guest: { name: 'Ada Guest', phone: '08031230000' }, check_in: checkIn, check_out: addDays(checkIn, nights), room_type_id: typeId, adults: 1, source: 'phone', ...extra } });
  ok(r, 201);
  return r.json.id as number;
};
const room = (n: string) => get<{ id: number }>('SELECT id FROM rooms WHERE number = ?', n)!.id;

describe('setup', () => {
  test('an owner, three staff, two rooms and a drink in stock', async () => {
    const r = await call('/setup/owner', { body: { code: 'SETUP-4', hotel_name: 'Test Hotel', name: 'Owner Person', username: 'owner', password: 'owner passphrase 123' } });
    ok(r, 201);
    owner = r.cookie!;
    for (const [username, role] of [['desk', 'frontdesk'], ['bar', 'bar'], ['cleaner', 'housekeeping']]) {
      ok(await call('/users', { cookie: owner, body: { name: `${role} person`, username, role, password: 'a long staff password' } }), 201);
    }
    [desk, bar, hk] = [await login('desk'), await login('bar'), await login('cleaner')];
    typeId = (await call('/settings/room-types', { cookie: owner, body: { name: 'Standard', rate: RATE, capacity: 2, amenities: [] } })).json.id;
    ok(await call('/settings/rooms', { cookie: owner, body: { room_type_id: typeId, numbers: '101-102' } }), 201);
    run("UPDATE rooms SET status = 'available'");
    const product = (await call('/products', { cookie: owner, body: { name: 'Malt', category: 'drinks', unit: 'bottle', price: 1000, reorder_level: 5 } })).json.id;
    ok(await call('/purchases', { cookie: owner, body: { supplier: 'Depot', items: [{ product_id: product, qty: 10, unit_cost: 600 }] } }), 201);
  });
});

describe('cancelling a booking that was paid for', () => {
  test('front desk can keep the deposit, and it is earned that day as a cancellation fee', async () => {
    const id = await book(desk, addDays(t, 5), 2, { deposit: 10000, deposit_method: 'cash' });
    const before = await pnl();
    ok(await call(`/reservations/${id}/cancel`, { cookie: desk, body: { reason: 'Plans changed', refund: 5000, refund_method: 'cash' } }), 403);
    const r = await call(`/reservations/${id}/cancel`, { cookie: desk, body: { reason: 'Plans changed' } });
    ok(r);
    assert.deepEqual({ refunded: r.json.refunded, retained: r.json.retained }, { refunded: 0, retained: 10000 });
    const after = await pnl();
    assert.equal(stream(after, 'cancellations') - stream(before, 'cancellations'), 10000);
    assert.equal(after.kpis.adr, before.kpis.adr, 'a kept deposit is not a room night');
    const detail = (await call(`/reservations/${id}`, { cookie: desk })).json;
    assert.equal(detail.balance, 0, 'nothing more is owed on a cancelled booking');
  });

  test('a manager can give some or all of it back, and cash refunds leave the drawer', async () => {
    const id = await book(desk, addDays(t, 6), 1, { deposit: 15000, deposit_method: 'cash' });
    const cashBefore = (await collected()).cash;
    ok(await call(`/reservations/${id}/cancel`, { cookie: owner, body: { refund: 20000, refund_method: 'cash' } }), 400);
    const r = await call(`/reservations/${id}/cancel`, { cookie: owner, body: { reason: 'Hotel moved the event', refund: 12000, refund_method: 'cash' } });
    ok(r);
    assert.deepEqual({ refunded: r.json.refunded, retained: r.json.retained }, { refunded: 12000, retained: 3000 });
    assert.equal((await collected()).cash, cashBefore - 12000, 'expected cash in the drawer goes down');
    const detail = (await call(`/reservations/${id}`, { cookie: owner })).json;
    assert.equal(detail.paid, 3000);
    assert.equal(detail.refunds[0].reason, 'Hotel moved the event');
    // The kept part is settled; there is nothing more to give back.
    ok(await call(`/reservations/${id}/refunds`, { cookie: owner, body: { amount: 1000, method: 'cash', reason: 'More back' } }), 400);
  });

  test('an online payment that lands after cancelling can be given back, without touching the kept fee', async () => {
    const id = await book(desk, addDays(t, 7), 1, { deposit: 4000, deposit_method: 'cash' });
    ok(await call(`/reservations/${id}/cancel`, { cookie: desk, body: {} }));
    run("INSERT INTO payments (reservation_id, amount, method, reference, date) VALUES (?, 6000, 'online', 'LATE-REF', ?)", id, t);
    const before = stream(await pnl(), 'cancellations');
    assert.equal((await call(`/reservations/${id}`, { cookie: owner })).json.balance, -6000);
    ok(await call(`/reservations/${id}/refunds`, { cookie: owner, body: { amount: 6000, method: 'transfer', reason: 'Paid after cancelling' } }), 201);
    assert.equal((await call(`/reservations/${id}`, { cookie: owner })).json.balance, 0);
    assert.equal(stream(await pnl(), 'cancellations'), before, 'the kept ₦4,000 is still income');
  });

  test('an upcoming booking cannot be refunded outside a cancellation', async () => {
    const id = await book(desk, addDays(t, 8), 1, { deposit: 4000, deposit_method: 'cash' });
    ok(await call(`/reservations/${id}/refunds`, { cookie: owner, body: { amount: 1000, method: 'cash', reason: 'Changed mind' } }), 409);
  });

  test('a no-show keeps the deposit unless a manager decides otherwise', async () => {
    const id = await book(desk, t, 1, { deposit: 8000, deposit_method: 'transfer' });
    const r = await call(`/reservations/${id}/no-show`, { cookie: desk, body: {} });
    ok(r);
    assert.equal(r.json.retained, 8000);
    assert.equal(get<{ status: string }>('SELECT status FROM reservations WHERE id = ?', id)!.status, 'cancelled');
  });
});

describe('refunding a stay that overpaid', () => {
  let id = 0;
  test('leaving early leaves the guest in credit, and only a manager can pay it back', async () => {
    id = await book(desk, t, 3, { room_id: room('101'), check_in_now: true, deposit: 3 * RATE, deposit_method: 'cash' });
    ok(await call(`/reservations/${id}/check-out`, { cookie: desk, body: {} }));
    const detail = (await call(`/reservations/${id}`, { cookie: desk })).json;
    assert.equal(detail.nights, 1);
    assert.equal(detail.balance, -2 * RATE, 'two unused nights are owed back');

    ok(await call(`/reservations/${id}/refunds`, { cookie: desk, body: { amount: 2 * RATE, method: 'cash', reason: 'Left early' } }), 403);
    ok(await call(`/reservations/${id}/refunds`, { cookie: owner, body: { amount: 2 * RATE + 1, method: 'cash', reason: 'Left early' } }), 400);
    ok(await call(`/reservations/${id}/refunds`, { cookie: owner, body: { amount: 2 * RATE, method: 'cash', reason: 'x' } }), 400);
    ok(await call(`/reservations/${id}/refunds`, { cookie: owner, body: { amount: 2 * RATE, method: 'cash', reason: 'Left early' } }), 201);
    assert.equal((await call(`/reservations/${id}`, { cookie: desk })).json.balance, 0);
    ok(await call(`/reservations/${id}/refunds`, { cookie: owner, body: { amount: 1, method: 'cash', reason: 'Again' } }), 400);
    const audit = get<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'refund' AND entity_id = ?", id)!;
    assert.equal(JSON.parse(audit.detail).reason, 'Left early');
  });

  test('no refund is dated on a closed day', async () => {
    const id2 = await book(desk, t, 2, { room_id: room('102'), check_in_now: true, deposit: 2 * RATE, deposit_method: 'cash' });
    ok(await call(`/reservations/${id2}/check-out`, { cookie: desk, body: {} }));
    const ownerId = get<{ id: number }>("SELECT id FROM users WHERE username = 'owner'")!.id;
    run("INSERT INTO day_closures (date, closed_by, expected_cash, counted_cash, expected_transfer, expected_pos, variance, summary) VALUES (?,?,0,0,0,0,0,'{}')", t, ownerId);
    ok(await call(`/reservations/${id2}/refunds`, { cookie: owner, body: { amount: RATE, method: 'cash', reason: 'Left early' } }), 409);
    run('DELETE FROM day_closures WHERE date = ?', t);
    run("UPDATE rooms SET status = 'available'");
  });
});

describe('voiding a till mistake', () => {
  test('only a manager can void; the stock comes back and the sale leaves the books', async () => {
    const product = get<{ id: number; stock: number; avg_cost: number }>("SELECT id, stock, avg_cost FROM products WHERE name = 'Malt'")!;
    const before = await pnl();
    const sale = await call('/sales', { cookie: bar, body: { method: 'cash', items: [{ product_id: product.id, qty: 3 }] } });
    ok(sale, 201);
    assert.equal(get<{ stock: number }>('SELECT stock FROM products WHERE id = ?', product.id)!.stock, product.stock - 3);
    ok(await call(`/sales/${sale.json.id}/void`, { cookie: bar, body: { reason: 'Rang up twice' } }), 403);
    ok(await call(`/sales/${sale.json.id}/void`, { cookie: owner, body: {} }), 400);
    ok(await call(`/sales/${sale.json.id}/void`, { cookie: owner, body: { reason: 'Rang up twice' } }));
    const p = get<{ stock: number; avg_cost: number }>('SELECT stock, avg_cost FROM products WHERE id = ?', product.id)!;
    assert.deepEqual({ ...p }, { stock: product.stock, avg_cost: product.avg_cost });
    const after = await pnl();
    assert.equal(stream(after, 'drinks'), stream(before, 'drinks'));
    assert.equal(after.collections.byMethod.cash, before.collections.byMethod.cash);
    assert.ok(get("SELECT 1 FROM audit_log WHERE action = 'void' AND entity = 'sale' AND entity_id = ?", sale.json.id), 'the receipt is kept in the log');
    ok(await call(`/sales/${sale.json.id}/void`, { cookie: owner, body: { reason: 'Again' } }), 404);
  });

  test('a room charge cannot be voided once the guest has checked out', async () => {
    const id = await book(desk, t, 1, { room_id: room('101'), check_in_now: true });
    const product = get<{ id: number }>("SELECT id FROM products WHERE name = 'Malt'")!.id;
    const sale = await call('/sales', { cookie: bar, body: { method: 'room', reservation_id: id, items: [{ product_id: product, qty: 1 }] } });
    ok(sale, 201);
    const fac = await call('/facility-income', { cookie: desk, body: { facility: 'pool', item: 'Day pass', amount: 3000, method: 'room', reservation_id: id } });
    ok(fac, 201);
    ok(await call(`/reservations/${id}/payments`, { cookie: desk, body: { amount: RATE + 1000 + 3000, method: 'pos' } }), 201);
    ok(await call(`/reservations/${id}/check-out`, { cookie: desk, body: {} }));
    ok(await call(`/sales/${sale.json.id}/void`, { cookie: owner, body: { reason: 'Wrong room' } }), 409);
    ok(await call(`/facility-income/${fac.json.id}/void`, { cookie: owner, body: { reason: 'Wrong room' } }), 409);
    run("UPDATE rooms SET status = 'available'");
  });

  test('a gym, pool or lounge entry can be voided by a manager', async () => {
    const fac = await call('/facility-income', { cookie: desk, body: { facility: 'gym', item: 'Day pass', amount: 2500, method: 'cash' } });
    ok(fac, 201);
    ok(await call(`/facility-income/${fac.json.id}/void`, { cookie: desk, body: { reason: 'Typed twice' } }), 403);
    ok(await call(`/facility-income/${fac.json.id}/void`, { cookie: owner, body: { reason: 'Typed twice' } }));
    assert.equal(get('SELECT 1 FROM facility_income WHERE id = ?', fac.json.id), undefined);
  });
});

describe('a guest past departure', () => {
  test('the bill shows the extra night before check-out, and it can be paid in advance', async () => {
    const id = await book(desk, t, 1, { room_id: room('102'), check_in_now: true, deposit: RATE, deposit_method: 'cash' });
    // Two days on, the guest is still here: departure was yesterday.
    run('UPDATE reservations SET check_in = ?, check_out = ? WHERE id = ?', addDays(t, -2), addDays(t, -1), id);
    run('UPDATE reservation_nights SET date = ? WHERE reservation_id = ?', addDays(t, -2), id);
    const detail = (await call(`/reservations/${id}`, { cookie: desk })).json;
    assert.deepEqual(detail.overstay, { since: addDays(t, -1), nights: 1, amount: RATE });
    ok(await call(`/reservations/${id}/payments`, { cookie: desk, body: { amount: RATE, method: 'cash' } }), 201);
    ok(await call(`/reservations/${id}/check-out`, { cookie: desk, body: {} }));
    assert.equal((await call(`/reservations/${id}`, { cookie: desk })).json.balance, 0);
  });
});

describe('small things that used to fail', () => {
  test('housekeeping staff can open their own account and sessions', async () => {
    ok(await call('/auth/sessions', { cookie: hk }));
  });

  test("a room's type cannot change under a guest who was sold the old type", async () => {
    const other = (await call('/settings/room-types', { cookie: owner, body: { name: 'Suite', rate: 50000, capacity: 2, amenities: [] } })).json.id;
    await book(desk, addDays(t, 20), 1, { room_id: room('101') });
    ok(await call(`/settings/rooms/${room('101')}`, { cookie: owner, method: 'PUT', body: { room_type_id: other, floor: 1 } }), 409);
    ok(await call(`/settings/rooms/${room('101')}`, { cookie: owner, method: 'PUT', body: { room_type_id: 9999, floor: 1 } }), 400);
    ok(await call(`/settings/rooms/${room('101')}`, { cookie: owner, method: 'PUT', body: { room_type_id: typeId, floor: 2 } }));
  });
});
