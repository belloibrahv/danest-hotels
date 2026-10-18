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
    const r = await call('/setup/owner', { body: { code: 'test-setup-code', hotel_name: 'Danest Hotel & Suites', hotel_address: '4 Beckley Street, Old Bodija, Ibadan', name: 'Owner Name', username: 'owner', password: OWNER_PW } });
    ok(r, 201);
    owner = r.cookie!;
    assert.equal((await call('/auth/me', { cookie: owner })).json.role, 'ceo', 'the person who sets the hotel up is its owner');
    ok(await call('/setup/owner', { body: { code: 'TEST-SETUP-CODE', name: 'Intruder', username: 'x2', password: 'another long one' } }), 409);
    assert.equal((await call('/setup/status')).json.needs_setup, false);
    const site = (await call('/public/hotel')).json;
    assert.equal(site.name, 'Danest Hotel & Suites', 'the hotel is named at setup');
    assert.equal(site.short_name, 'Danest');
    assert.equal(site.builtin_brand, false, 'a new installation starts without any built-in artwork');
    const { monogramSvg } = await import('../branding.ts');
    assert.match(monogramSvg(), />D</, 'its icon is its initials until a logo is uploaded');
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

    assert.equal(view.report.collections.byMethod.cash, 84500, 'cash taken in at the till and the front desk');
    assert.equal(view.report.paid_out.total, 25000, 'the AC repair was paid in cash from the drawer');
    assert.equal(view.report.expected_cash, 59500, 'the drawer should hold what came in less what went out');
    ok(await call('/close-day', { cookie: desk, body: { date: today(), counted_cash: 59500 } }), 403);
    ok(await call('/close-day', { cookie: owner, body: { date: today(), counted_cash: 59000 } }), 400);
    const closed = await call('/close-day', { cookie: owner, body: { date: today(), counted_cash: 59000, notes: '₦500 short — change given twice' } });
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

describe('the night audit keeps room nights honest', () => {
  const t = today();
  const y = addDays(t, -1);
  const stay = (code: string, roomNumber: string, checkIn: string, checkOut: string, status: string) => {
    const type = get<{ id: number; rate: number }>('SELECT id, rate FROM room_types LIMIT 1')!;
    const room = get<{ id: number }>('SELECT id FROM rooms WHERE number = ?', roomNumber)!.id;
    run("UPDATE rooms SET status = ? WHERE id = ?", status === 'checked_in' ? 'occupied' : 'available', room);
    run("INSERT OR IGNORE INTO guests (name, phone) VALUES ('Audit Guest', '08077770000')");
    const g = get<{ id: number }>("SELECT id FROM guests WHERE phone = '08077770000'")!.id;
    const id = run(
      "INSERT INTO reservations (code, guest_id, room_type_id, room_id, check_in, check_out, nights, rate, total, status, source) VALUES (?,?,?,?,?,?,1,0,0,?,'phone')",
      code, g, type.id, room, checkIn, checkOut, status,
    ).id;
    for (let d = checkIn; d < checkOut; d = addDays(d, 1)) run('INSERT INTO reservation_nights (reservation_id, date, rate) VALUES (?,?,?)', id, d, type.rate);
    run('UPDATE reservations SET nights = (SELECT COUNT(*) FROM reservation_nights WHERE reservation_id = ?1), total = (SELECT SUM(rate) FROM reservation_nights WHERE reservation_id = ?1) WHERE id = ?1', id);
    return { id, rate: type.rate };
  };
  const nights = (id: number) => get<{ nights: number; total: number; check_in: string; check_out: string }>('SELECT nights, total, check_in, check_out FROM reservations WHERE id = ?', id)!;

  test('a day cannot close while a guest is past departure or has not arrived', async () => {
    const late = stay('DH-AUDIT-NS', '101', y, addDays(t, 2), 'confirmed');
    const over = stay('DH-AUDIT-OV', '201', addDays(t, -2), y, 'checked_in');
    const view = (await call(`/close-day?date=${t}`, { cookie: owner })).json;
    assert.equal(view.checks.no_shows.length, 1);
    assert.equal(view.checks.overdue.length, 1);
    const refused = await call('/close-day', { cookie: owner, body: { date: t, counted_cash: 0, notes: 'test' } });
    ok(refused, 409);
    assert.match(refused.json.error, /1 not arrived, 1 past departure/);
    assert.equal(get<{ n: number }>('SELECT COUNT(*) n FROM day_closures WHERE date = ?', t)!.n, 0);

    // The guest who arrived a day late pays from tonight, not for the night they missed.
    ok(await call(`/reservations/${late.id}/check-in`, { cookie: desk, body: {} }));
    assert.deepEqual({ ...nights(late.id) }, { nights: 2, total: 2 * late.rate, check_in: t, check_out: addDays(t, 2) });
    assert.equal(get<{ n: number }>('SELECT COUNT(*) n FROM reservation_nights WHERE reservation_id = ? AND date < ?', late.id, t)!.n, 0);

    // The guest who stayed on without extending pays for the extra night at check-out.
    const refusedOut = await call(`/reservations/${over.id}/check-out`, { cookie: desk, body: {} });
    ok(refusedOut, 409);
    assert.match(refusedOut.json.error, /Outstanding balance of ₦/);
    assert.deepEqual({ ...nights(over.id) }, { nights: 2, total: 2 * over.rate, check_in: addDays(t, -2), check_out: t }, 'the overstay was billed even though check-out was refused');
  });

  test('extra nights are never posted on a day that is already closed', async () => {
    const overdue = get<{ id: number }>("SELECT id FROM reservations WHERE code = 'DH-AUDIT-OV'")!.id;
    // Charging the night at the refused check-out moved departure to today, so the guest is no longer overdue.
    assert.equal(nights(overdue).check_out, t);
    // Simulate books closed before this guard existed: yesterday locked while a guest overstayed from it.
    run("UPDATE reservations SET check_out = ? WHERE id = ?", y, overdue);
    run('DELETE FROM reservation_nights WHERE reservation_id = ? AND date >= ?', overdue, y);
    const ownerId = get<{ id: number }>("SELECT id FROM users WHERE username = 'owner'")!.id;
    run("INSERT INTO day_closures (date, closed_by, expected_cash, counted_cash, expected_transfer, expected_pos, variance, summary) VALUES (?,?,0,0,0,0,0,'{}')", y, ownerId);
    ok(await call(`/reservations/${overdue}/check-out`, { cookie: desk, body: {} }), 409);
    ok(await call(`/reservations/${overdue}/extend`, { cookie: desk, body: { check_out: addDays(t, 1) } }), 409);
    assert.equal(get<{ n: number }>('SELECT COUNT(*) n FROM reservation_nights WHERE reservation_id = ? AND date >= ?', overdue, y)!.n, 0, 'nothing was posted on the closed day');
    run('DELETE FROM day_closures WHERE date = ?', y);
  });
});
