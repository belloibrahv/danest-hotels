// Folios, stay changes, accrual revenue, two-step sign-in and guest self-service.
process.env.DANEST_DB = ':memory:';

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

const { createApp } = await import('../app.ts');
const { seed } = await import('../seed.ts');
const { addDays, today } = await import('../lib.ts');
const { all, get, run } = await import('../db.ts');
const { totpNow } = await import('../totp.ts');

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

before(async () => {
  seed();
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
const login = async (username: string, password = 'Danest@2026!') => {
  const r = await call('/auth/login', { body: { username, password } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.cookie!;
};

/** A ready, empty room for a stay from today, of any type. */
function readyRoom(nights: number) {
  const out = addDays(today(), nights);
  const rooms = all<{ id: number; room_type_id: number; rate: number }>(
    `SELECT rm.id, rm.room_type_id, t.rate FROM rooms rm JOIN room_types t ON t.id = rm.room_type_id
      WHERE rm.status IN ('available','cleaning')
        AND NOT EXISTS (SELECT 1 FROM reservations x WHERE x.room_id = rm.id AND x.status = 'checked_in')
        AND NOT EXISTS (SELECT 1 FROM reservations x WHERE x.room_id = rm.id AND x.status = 'confirmed' AND x.check_in < ? AND x.check_out > ?)`,
    out,
    today(),
  );
  assert.ok(rooms.length, 'need a free room');
  run("UPDATE rooms SET status = 'available' WHERE id = ?", rooms[0].id); // housekeeping has been
  return rooms[0];
}

async function walkIn(desk: string, nights: number, phone: string, deposit?: number) {
  const room = readyRoom(nights);
  const r = await call('/reservations', {
    cookie: desk,
    body: {
      guest: { name: 'Folio Tester', phone, id_type: 'nin', id_number: '12345678901' },
      room_type_id: room.room_type_id, room_id: room.id, check_in: today(), check_out: addDays(today(), nights),
      adults: 1, source: 'walk_in', check_in_now: true, deposit, deposit_method: 'cash',
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { id: r.json.id as number, room };
}

describe('guest folio', () => {
  test('bar and pool charges post to the room and must be settled before check-out', async () => {
    const desk = await login('frontdesk');
    const bar = await login('bar');
    const { id, room } = await walkIn(desk, 1, '08077770001', undefined);
    await call(`/reservations/${id}/payments`, { cookie: desk, body: { amount: room.rate, method: 'transfer' } });

    const inhouse = (await call('/inhouse', { cookie: bar })).json as { reservation_id: number; guest_phone?: string }[];
    assert.ok(inhouse.some((g) => g.reservation_id === id), 'bar can see the in-house guest');
    assert.equal(inhouse[0].guest_phone, undefined, 'bar never sees guest phone numbers');

    const sale = await call('/sales', { cookie: bar, body: { method: 'room', reservation_id: id, items: [{ product_id: 1, qty: 2 }] } });
    assert.equal(sale.status, 201, JSON.stringify(sale.json));
    const pool = await call('/facility-income', { cookie: desk, body: { facility: 'pool', item: 'Pool day pass — adult', amount: 5000, method: 'room', reservation_id: id } });
    assert.equal(pool.status, 201);

    const detail = (await call(`/reservations/${id}`, { cookie: desk })).json;
    assert.equal(detail.charges, sale.json.total + 5000);
    assert.equal(detail.folio.length, 3, 'one night + one bar ticket + one pool pass');

    assert.equal((await call(`/reservations/${id}/check-out`, { cookie: desk, body: {} })).status, 409, 'owes the bar tab');
    assert.equal((await call(`/reservations/${id}/payments`, { cookie: desk, body: { amount: detail.charges, method: 'pos' } })).status, 201);
    assert.equal((await call(`/reservations/${id}/check-out`, { cookie: desk, body: {} })).status, 200);
  });

  test('charges cannot go to a guest who is not in house', async () => {
    const bar = await login('bar');
    const gone = get<{ id: number }>("SELECT id FROM reservations WHERE status = 'checked_out' LIMIT 1")!;
    assert.equal((await call('/sales', { cookie: bar, body: { method: 'room', reservation_id: gone.id, items: [{ product_id: 1, qty: 1 }] } })).status, 409);
    assert.equal((await call('/sales', { cookie: bar, body: { method: 'room', items: [{ product_id: 1, qty: 1 }] } })).status, 400);
  });
});

describe('changing a stay', () => {
  test('leaving early re-prices the stay to the nights used', async () => {
    const desk = await login('frontdesk');
    const { id, room } = await walkIn(desk, 3, '08077770002', undefined);
    await call(`/reservations/${id}/payments`, { cookie: desk, body: { amount: room.rate, method: 'cash' } });
    assert.equal((await call(`/reservations/${id}/check-out`, { cookie: desk, body: {} })).status, 200);
    const r = get<{ nights: number; total: number; check_out: string }>('SELECT nights, total, check_out FROM reservations WHERE id = ?', id)!;
    assert.deepEqual({ ...r }, { nights: 1, total: room.rate, check_out: addDays(today(), 1) });
  });

  test('extending checks the room is free, then re-prices', async () => {
    const desk = await login('frontdesk');
    const ci = addDays(today(), 80);
    const free = (await call(`/availability?check_in=${ci}&check_out=${addDays(ci, 4)}&room_type_id=1`, { cookie: desk })).json[0];
    const mk = (i: string, o: string, phone: string) =>
      call('/reservations', { cookie: desk, body: { guest: { name: 'Ext', phone }, room_type_id: 1, room_id: free.id, check_in: i, check_out: o, adults: 1, source: 'phone' } });
    const a = await mk(ci, addDays(ci, 2), '08077770003');
    await mk(addDays(ci, 3), addDays(ci, 4), '08077770004');
    assert.equal((await call(`/reservations/${a.json.id}/extend`, { cookie: desk, body: { check_out: addDays(ci, 3) } })).status, 200);
    assert.equal(get<{ nights: number }>('SELECT nights FROM reservations WHERE id = ?', a.json.id)!.nights, 3);
    assert.equal((await call(`/reservations/${a.json.id}/extend`, { cookie: desk, body: { check_out: addDays(ci, 4) } })).status, 409, 'next guest already has that night');
  });

  test('moving an in-house guest frees the old room for housekeeping', async () => {
    const desk = await login('frontdesk');
    const { id, room } = await walkIn(desk, 2, '08077770005');
    const target = readyRoom(2);
    assert.equal((await call(`/reservations/${id}/move`, { cookie: desk, body: { room_id: target.id } })).status, 200);
    assert.equal(get<{ status: string }>('SELECT status FROM rooms WHERE id = ?', room.id)!.status, 'cleaning');
    assert.equal(get<{ status: string }>('SELECT status FROM rooms WHERE id = ?', target.id)!.status, 'occupied');
  });
});

describe('hotel accounting', () => {
  test("tonight's room revenue is the sum of in-house nightly rates", async () => {
    const m = await login('manager');
    const p = (await call(`/reports/pnl?from=${today()}&to=${today()}`, { cookie: m })).json;
    const expected = get<{ n: number; v: number }>(
      "SELECT COUNT(*) n, COALESCE(SUM(rate),0) v FROM reservations WHERE status IN ('checked_in','checked_out') AND check_in <= ?1 AND check_out > ?1",
      today(),
    )!;
    assert.equal(p.revenue.find((r: { key: string }) => r.key === 'rooms').amount, expected.v);
    assert.equal(p.kpis.roomNightsSold, expected.n);
    assert.equal(p.kpis.adr, expected.n ? Math.round(expected.v / expected.n) : 0);
  });

  test('collections only count money received, not room-charged sales', async () => {
    const m = await login('manager');
    const from = addDays(today(), -30);
    const p = (await call(`/reports/pnl?from=${from}&to=${today()}`, { cookie: m })).json;
    const roomCharged = get<{ v: number }>("SELECT COALESCE(SUM(total),0) v FROM sales WHERE method = 'room' AND date BETWEEN ? AND ?", from, today())!.v;
    const allSales = get<{ v: number }>('SELECT COALESCE(SUM(total),0) v FROM sales WHERE date BETWEEN ? AND ?', from, today())!.v;
    assert.ok(roomCharged > 0);
    assert.equal(p.collections.bySource['Bar & shop'], allSales - roomCharged);
  });
});

describe('two-step sign-in', () => {
  test('setup, sign in with a code, block replays, and use a recovery code once', async () => {
    let cookie = await login('frontdesk2');
    const setup = (await call('/auth/2fa/setup', { cookie, body: {} })).json;
    assert.match(setup.uri, /^otpauth:\/\/totp\//);
    assert.equal((await call('/auth/2fa/enable', { cookie, body: { code: '000000' } })).status, 400);
    const enabled = await call('/auth/2fa/enable', { cookie, body: { code: totpNow(setup.secret, Date.now() - 30_000) } });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.json.recovery_codes.length, 8);
    const stored = get<{ totp_secret: string }>("SELECT totp_secret FROM users WHERE username = 'frontdesk2'")!;
    assert.ok(stored.totp_secret.startsWith('v1:') && !stored.totp_secret.includes(setup.secret), 'secret is encrypted at rest');

    const step1 = await call('/auth/login', { body: { username: 'frontdesk2', password: 'Danest@2026!' } });
    assert.equal(step1.json.mfa_required, true);
    assert.equal(step1.cookie, undefined, 'no session before the second step');
    assert.equal((await call('/auth/login/2fa', { body: { challenge: step1.json.challenge, code: '123456' } })).status, 401);
    const code = totpNow(setup.secret);
    const ok = await call('/auth/login/2fa', { body: { challenge: step1.json.challenge, code } });
    assert.equal(ok.status, 200);
    cookie = ok.cookie!;
    assert.equal((await call('/dashboard', { cookie })).status, 200);

    const again = await call('/auth/login', { body: { username: 'frontdesk2', password: 'Danest@2026!' } });
    assert.equal((await call('/auth/login/2fa', { body: { challenge: again.json.challenge, code } })).status, 401, 'a code works once');
    const rc = enabled.json.recovery_codes[0];
    assert.equal((await call('/auth/login/2fa', { body: { challenge: again.json.challenge, code: rc } })).status, 200);
    const third = await call('/auth/login', { body: { username: 'frontdesk2', password: 'Danest@2026!' } });
    assert.equal((await call('/auth/login/2fa', { body: { challenge: third.json.challenge, code: rc } })).status, 401, 'recovery codes are single-use');
  });

  test('you can see your sessions and sign out the others', async () => {
    const a = await login('manager');
    const b = await login('manager');
    const list = (await call('/auth/sessions', { cookie: a })).json;
    assert.ok(list.sessions.length >= 2);
    assert.equal(list.sessions.filter((s: { current: boolean }) => s.current).length, 1);
    assert.ok(list.sessions.every((s: { id: string }) => s.id.length === 16), 'full session hashes never leave the server');
    assert.equal((await call('/auth/sessions/revoke', { cookie: a, body: { all_others: true } })).status, 200);
    assert.equal((await call('/auth/me', { cookie: b })).status, 401);
    assert.equal((await call('/auth/me', { cookie: a })).status, 200);
  });
});

describe('guests', () => {
  test('a guest can look up their booking only with the matching phone', async () => {
    const r = get<{ code: string; phone: string }>("SELECT r.code, g.phone FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE r.status = 'confirmed' LIMIT 1")!;
    const ok = await call('/public/booking-lookup', { body: { code: r.code.toLowerCase(), phone: r.phone } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.code, r.code);
    assert.equal(ok.json.guest_phone, undefined);
    const wrong = await call('/public/booking-lookup', { body: { code: r.code, phone: '08000000000' } });
    const missing = await call('/public/booking-lookup', { body: { code: 'DH-NOPE00', phone: r.phone } });
    assert.equal(wrong.status, 404);
    assert.deepEqual(wrong.json, missing.json, 'no hint whether the code exists');
  });

  test('profiles add up stays and refuse duplicate phone numbers', async () => {
    const desk = await login('frontdesk');
    const list = (await call('/guests', { cookie: desk })).json;
    const top = list[0];
    assert.ok(top.spend > 0 && top.stays > 0);
    const two = list.slice(0, 2);
    const clash = await call(`/guests/${two[1].id}`, { cookie: desk, method: 'PATCH', body: { name: two[1].name, phone: two[0].phone } });
    assert.equal(clash.status, 409);
  });

  test('bar staff cannot search guests', async () => {
    const bar = await login('bar');
    assert.deepEqual((await call('/search?q=ad', { cookie: bar })).json, { guests: [], reservations: [], rooms: [] });
    assert.equal((await call('/guests', { cookie: bar })).status, 403);
  });
});
