// A brand-new hotel, from an empty database: no demo data anywhere in this file.
process.env.DANEST_DB = ':memory:';
process.env.DANEST_SETUP_CODE = 'TEST-SETUP-CODE';

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
const ok = (r: { status: number; json: unknown }, status = 200) => assert.equal(r.status, status, JSON.stringify(r.json));
const login = async (username: string, password: string) => {
  const r = await call('/auth/login', { body: { username, password } });
  ok(r);
  return r.cookie!;
};

const OWNER_PW = 'a long owner passphrase';
let owner = '';
let desk = '';
let bar = '';
let hk = '';

describe('first run', () => {
  test('a new install has no accounts and no data', async () => {
    assert.equal((await call('/setup/status')).json.needs_setup, true);
    assert.equal(get<{ n: number }>('SELECT COUNT(*) n FROM reservations')!.n, 0);
    assert.equal(get<{ n: number }>('SELECT COUNT(*) n FROM rooms')!.n, 0);
    const site = (await call('/public/hotel')).json;
    assert.equal(site.bookable, false, 'website does not take bookings with no rooms set up');
    assert.equal(site.phone, '', 'no invented phone number');
  });

  test('the owner account needs the setup code, and can only be created once', async () => {
    ok(await call('/setup/owner', { body: { code: 'WRONG', name: 'Owner Name', username: 'owner', password: OWNER_PW } }), 403);
    const r = await call('/setup/owner', { body: { code: 'test-setup-code', name: 'Owner Name', username: 'owner', password: OWNER_PW } });
    ok(r, 201);
    owner = r.cookie!;
    assert.equal((await call('/auth/me', { cookie: owner })).json.role, 'manager');
    ok(await call('/setup/owner', { body: { code: 'TEST-SETUP-CODE', name: 'Intruder', username: 'x2', password: 'another long one' } }), 409);
    assert.equal((await call('/setup/status')).json.needs_setup, false);
  });
});

describe('the owner configures the real hotel', () => {
  test('hotel profile shows on the website, bank details do not', async () => {
    ok(await call('/settings', { cookie: owner, method: 'PUT', body: {
      name: 'Danest Hotel & Suites', tagline: 'Experience a great comfort', address: '4 Beckley Street, Old Bodija, Ibadan',
      phone: '08012345678', whatsapp: '', email: '', check_in_time: '14:00', check_out_time: '12:00',
      bank_details: 'Acct 0123456789', invoice_note: 'Thank you', highlights: [{ title: 'Free Wi-Fi', text: 'Everywhere' }],
    } }));
    const site = (await call('/public/hotel')).json;
    assert.equal(site.phone, '08012345678');
    assert.equal(site.bank_details, undefined);
    assert.deepEqual(site.highlights, [{ title: 'Free Wi-Fi', text: 'Everywhere' }]);
  });

  test('room types and rooms (including ranges like 101-103)', async () => {
    const t = await call('/settings/room-types', { cookie: owner, body: { name: 'Deluxe', rate: 40000, capacity: 2, description: 'King bed', amenities: ['King bed', 'Wi-Fi'] } });
    ok(t, 201);
    assert.equal((await call('/public/room-types')).json.length, 0, 'a type with no rooms is not bookable yet');
    ok(await call('/settings/rooms', { cookie: owner, body: { room_type_id: t.json.id, numbers: '101-103, 201' } }), 201);
    ok(await call('/settings/rooms', { cookie: owner, body: { room_type_id: t.json.id, numbers: '103' } }), 409);
    const types = (await call('/public/room-types')).json;
    assert.equal(types.length, 1);
    assert.equal(types[0].available, 4);
    assert.equal(get<{ floor: number }>("SELECT floor FROM rooms WHERE number = '201'")!.floor, 2);
    assert.equal((await call('/public/hotel')).json.bookable, true);
  });

  test('staff accounts with their real roles', async () => {
    for (const [name, username, role] of [['Front Desk Person', 'desk1', 'frontdesk'], ['Bar Person', 'bar1', 'bar'], ['Housekeeping Person', 'hk1', 'housekeeping']]) {
      ok(await call('/users', { cookie: owner, body: { name, username, role, password: 'a strong staff password' } }), 201);
    }
    desk = await login('desk1', 'a strong staff password');
    bar = await login('bar1', 'a strong staff password');
    hk = await login('hk1', 'a strong staff password');
    ok(await call('/settings', { cookie: desk, method: 'PUT', body: {} }), 403);
    ok(await call('/reservations', { cookie: hk }), 403);
  });

  test('stock goes in through a purchase, facility prices through settings', async () => {
    const p = await call('/products', { cookie: owner, body: { name: 'Star Lager 60cl', category: 'drinks', unit: 'bottle', price: 1500, reorder_level: 12 } });
    ok(p, 201);
    ok(await call('/purchases', { cookie: owner, body: { supplier: 'Bodija Drinks Depot', items: [{ product_id: p.json.id, qty: 48, unit_cost: 1000 }] } }), 201);
    assert.equal(get<{ stock: number }>('SELECT stock FROM products WHERE id = ?', p.json.id)!.stock, 48);
    ok(await call('/settings/facility-items', { cookie: owner, body: { facility: 'pool', name: 'Pool day pass — adult', price: 5000 } }), 201);
    assert.equal((await call('/public/hotel')).json.facility_items.length, 1);
  });
});

describe('a guest, start to finish', () => {
  let resId = 0;
  let roomId = 0;
  test('books online, is confirmed, checks in, drinks at the bar, pays, leaves', async () => {
    const type = (await call('/public/room-types')).json[0];
    const req = await call('/public/booking-requests', { body: { name: 'Real Guest', phone: '08099990000', check_in: today(), check_out: addDays(today(), 2), room_type_id: type.id, adults: 1 } });
    ok(req, 201);
    resId = (await call('/reservations?status=pending', { cookie: desk })).json[0].id;
    roomId = get<{ id: number }>("SELECT id FROM rooms WHERE number = '101'")!.id;
    ok(await call(`/reservations/${resId}/confirm`, { cookie: desk, body: { room_id: roomId } }));
    ok(await call(`/reservations/${resId}/check-in`, { cookie: desk, body: {} }));
    const product = get<{ id: number }>('SELECT id FROM products LIMIT 1')!.id;
    ok(await call('/sales', { cookie: bar, body: { method: 'room', reservation_id: resId, items: [{ product_id: product, qty: 2 }] } }), 201);
    ok(await call('/sales', { cookie: bar, body: { method: 'cash', items: [{ product_id: product, qty: 1 }] } }), 201);
    const bill = (await call(`/reservations/${resId}`, { cookie: desk })).json;
    assert.equal(bill.total + bill.charges, 80000 + 3000);
    ok(await call(`/reservations/${resId}/payments`, { cookie: desk, body: { amount: 83000, method: 'cash' } }), 201);
    // Leaves a night early: pays for one night, is owed the difference.
    ok(await call(`/reservations/${resId}/check-out`, { cookie: desk, body: {} }));
    const after = (await call(`/reservations/${resId}`, { cookie: desk })).json;
    assert.equal(after.total, 40000);
    assert.equal(after.total + after.charges - after.paid, -40000, 'the guest is owed a night back');
  });

  test("today's numbers are exactly what happened", async () => {
    const p = (await call(`/reports/pnl?from=${today()}&to=${today()}`, { cookie: owner })).json;
    const rev = Object.fromEntries(p.revenue.map((r: { key: string; amount: number }) => [r.key, r.amount]));
    assert.equal(rev.rooms, 40000);
    assert.equal(rev.drinks, 4500);
    assert.equal(p.collections.total, 83000 + 1500);
    assert.equal(p.collections.byMethod.cash, 84500);
    assert.equal(p.kpis.roomNightsSold, 1);
    assert.equal(p.kpis.roomNightsAvailable, 4);
  });
});

describe('housekeeping and maintenance', () => {
  test('a checked-out room goes to housekeeping, gets assigned, and is cleaned on a phone', async () => {
    const room = get<{ id: number; status: string }>("SELECT id, status FROM rooms WHERE number = '101'")!;
    assert.equal(room.status, 'cleaning');
    const board = (await call('/housekeeping', { cookie: hk })).json;
    const staff = board.staff.find((s: { name: string }) => s.name === 'Housekeeping Person');
    ok(await call(`/rooms/${room.id}/assign`, { cookie: desk, body: { user_id: staff.id } }));
    ok(await call(`/rooms/${room.id}/assign`, { cookie: hk, body: { user_id: staff.id } }), 403);
    ok(await call(`/rooms/${room.id}/clean`, { cookie: hk, body: {} }));
    assert.equal(get<{ status: string }>('SELECT status FROM rooms WHERE id = ?', room.id)!.status, 'available');
    ok(await call(`/rooms/${room.id}/clean`, { cookie: hk, body: {} }), 409);
  });

  test('a repair takes a room out of order; fixing it records the cost as an expense', async () => {
    const room = get<{ id: number }>("SELECT id FROM rooms WHERE number = '102'")!;
    const t = await call('/maintenance', { cookie: hk, body: { room_id: room.id, title: 'AC not cooling', priority: 'urgent', blocks_room: true } });
    ok(t, 201);
    assert.equal(get<{ status: string }>('SELECT status FROM rooms WHERE id = ?', room.id)!.status, 'maintenance');
    assert.equal((await call('/public/room-types')).json[0].available, 3, 'out-of-order room is not sold');
    ok(await call(`/rooms/${room.id}/status`, { cookie: desk, method: 'PATCH', body: { status: 'available' } }), 409);
    ok(await call(`/maintenance/${t.json.id}/resolve`, { cookie: hk, body: { resolution: 'Gas refilled', cost: 25000, method: 'cash' } }), 403);
    ok(await call(`/maintenance/${t.json.id}/resolve`, { cookie: owner, body: { resolution: 'Gas refilled', cost: 25000, method: 'cash', paid_to: 'CoolAir' } }));
    assert.equal(get<{ status: string }>('SELECT status FROM rooms WHERE id = ?', room.id)!.status, 'cleaning', 'needs a clean before guests');
    const exp = get<{ amount: number; category: string }>("SELECT amount, category FROM expenses WHERE description = 'Repair: AC not cooling'")!;
    assert.deepEqual({ ...exp }, { amount: 25000, category: 'repairs' });
  });
});

describe('closing the day', () => {
  test('no-shows are cleared, cash is counted, and the day is locked', async () => {
    const type = get<{ id: number }>('SELECT id FROM room_types LIMIT 1')!.id;
    // A booking for yesterday that never arrived.
    run(
      "INSERT INTO guests (name, phone) VALUES ('No Show Guest', '08011112222')",
    );
    const g = get<{ id: number }>("SELECT id FROM guests WHERE phone = '08011112222'")!.id;
    const y = addDays(today(), -1);
    run("INSERT INTO reservations (code, guest_id, room_type_id, check_in, check_out, nights, rate, total, status, source) VALUES ('DH-NOSHOW', ?, ?, ?, ?, 1, 40000, 40000, 'confirmed', 'phone')", g, type, y, today());
    const view = (await call(`/close-day?date=${today()}`, { cookie: owner })).json;
    const ns = view.checks.no_shows.find((r: { code: string }) => r.code === 'DH-NOSHOW');
    assert.ok(ns);
    ok(await call(`/reservations/${ns.id}/no-show`, { cookie: desk, body: {} }));

    assert.equal(view.report.collections.byMethod.cash, 84500, 'expected cash from the till and the front desk');
    ok(await call('/close-day', { cookie: desk, body: { date: today(), counted_cash: 84500 } }), 403);
    ok(await call('/close-day', { cookie: owner, body: { date: today(), counted_cash: 84000 } }), 400);
    const closed = await call('/close-day', { cookie: owner, body: { date: today(), counted_cash: 84000, notes: '₦500 short — change given twice' } });
    ok(closed, 201);
    assert.equal(closed.json.variance, -500);

    // Locked: no more money on a closed day.
    ok(await call('/expenses', { cookie: owner, body: { category: 'diesel', description: 'Diesel', amount: 1000, method: 'cash', date: today() } }), 409);
    const product = get<{ id: number }>('SELECT id FROM products LIMIT 1')!.id;
    ok(await call('/sales', { cookie: bar, body: { method: 'cash', items: [{ product_id: product, qty: 1 }] } }), 409);

    ok(await call('/close-day/reopen', { cookie: owner, body: { reason: 'Forgot a diesel receipt' } }));
    ok(await call('/expenses', { cookie: owner, body: { category: 'diesel', description: 'Diesel', amount: 1000, method: 'cash', date: today() } }), 201);
  });
});
