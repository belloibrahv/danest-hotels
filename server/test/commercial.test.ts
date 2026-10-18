// Phase 3 on an empty database: rate rules, corporate accounts, Paystack deposits, guest messages.
process.env.DANEST_DB = ':memory:';
process.env.DANEST_SETUP_CODE = 'SETUP-3';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_danest';

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

const { createApp } = await import('../app.ts');
const { addDays, today } = await import('../lib.ts');
const { all, get } = await import('../db.ts');

// ---- a tiny stand-in for Paystack and the SMS provider ----
const paystack = { status: 'success', amountOverride: null as number | null, initialized: new Map<string, number>() };
const sms: { to: string; sms: string }[] = [];
let mock: Server;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let base = '';

before(async () => {
  mock = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/transaction/initialize') {
        const b = JSON.parse(raw);
        assert.equal(req.headers.authorization, 'Bearer sk_test_danest');
        paystack.initialized.set(b.reference, b.amount);
        return res.end(JSON.stringify({ status: true, data: { authorization_url: `https://checkout.paystack.test/${b.reference}`, reference: b.reference } }));
      }
      const m = req.url?.match(/^\/transaction\/verify\/(.+)$/);
      if (m) {
        const ref = decodeURIComponent(m[1]);
        return res.end(JSON.stringify({ status: true, data: { status: paystack.status, reference: ref, amount: paystack.amountOverride ?? paystack.initialized.get(ref) } }));
      }
      if (req.url === '/sms') {
        const b = JSON.parse(raw);
        if (b.sms.includes('FAIL')) return (res.statusCode = 400), res.end(JSON.stringify({ message: 'Insufficient balance' }));
        sms.push(b);
        return res.end(JSON.stringify({ message_id: `msg-${sms.length}` }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => mock.listen(0, r));
  const mockUrl = `http://localhost:${(mock.address() as AddressInfo).port}`;
  process.env.PAYSTACK_BASE_URL = mockUrl;
  process.env.TERMII_BASE_URL = `${mockUrl}/sms`;
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
});
after(() => (server.close(), mock.close()));

async function call(path: string, o: { cookie?: string; body?: unknown; method?: string; headers?: Record<string, string>; raw?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-danest-request': '1', ...o.headers };
  if (o.cookie) headers.cookie = o.cookie;
  const res = await fetch(base + path, { method: o.method ?? (o.body || o.raw ? 'POST' : 'GET'), headers, body: o.raw ?? (o.body ? JSON.stringify(o.body) : undefined) });
  const text = await res.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const ok = (r: { status: number; json: unknown }, s = 200) => assert.equal(r.status, s, JSON.stringify(r.json));

/** Next date (on or after `from`) that falls on the given weekday (0 = Sunday). */
function nextWeekday(day: number, from = addDays(today(), 7)) {
  let d = from;
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== day) d = addDays(d, 1);
  return d;
}

let owner = '';
let typeId = 0;

describe('setup', () => {
  test('owner, hotel, one room type at ₦30,000 with three rooms', async () => {
    const r = await call('/setup/owner', { body: { code: 'SETUP-3', hotel_name: 'Test Hotel', name: 'Owner Person', username: 'owner', password: 'owner passphrase 123' } });
    ok(r, 201);
    owner = r.cookie!;
    ok(await call('/settings', { cookie: owner, method: 'PUT', body: { name: 'Danest Hotel & Suites', tagline: '', address: '4 Beckley Street, Ibadan', phone: '08012345678', check_in_time: '14:00', check_out_time: '12:00', highlights: [], deposit_percent: 30, bank_details: 'GTB 0123456789' } }));
    typeId = (await call('/settings/room-types', { cookie: owner, body: { name: 'Deluxe', rate: 30000, capacity: 2, amenities: [] } })).json.id;
    ok(await call('/settings/rooms', { cookie: owner, body: { room_type_id: typeId, numbers: '101-103' } }), 201);
  });
});

describe('rate rules', () => {
  test('weekend nights cost more, a holiday season overrides it, and the quote adds up night by night', async () => {
    ok(await call('/rate-rules', { cookie: owner, body: { name: 'Weekend', kind: 'percent', value: 20, weekdays: [5, 6] } }), 201);
    const thu = nextWeekday(4);
    // Thu, Fri, Sat nights → 30,000 + 36,000 + 36,000
    const q = (await call(`/quote?room_type_id=${typeId}&check_in=${thu}&check_out=${addDays(thu, 3)}`, { cookie: owner })).json;
    assert.deepEqual(q.nights.map((n: { rate: number }) => n.rate), [30000, 36000, 36000]);
    assert.equal(q.total, 102000);
    assert.equal(q.note, 'Weekend');

    ok(await call('/rate-rules', { cookie: owner, body: { name: 'Festive season', kind: 'fixed', value: 50000, start_date: addDays(thu, 1), end_date: addDays(thu, 1), priority: 10 } }), 201);
    const q2 = (await call(`/quote?room_type_id=${typeId}&check_in=${thu}&check_out=${addDays(thu, 3)}`, { cookie: owner })).json;
    assert.deepEqual(q2.nights.map((n: { rate: number }) => n.rate), [30000, 50000, 36000], 'the dated, higher-priority rule wins on the Friday');

    const site = (await call(`/public/room-types?check_in=${thu}&check_out=${addDays(thu, 3)}`)).json[0];
    assert.equal(site.total, 116000, 'the website shows the same price the desk would charge');
  });

  test('a booked stay keeps its prices when the rules change later', async () => {
    const sat = nextWeekday(6, addDays(today(), 21));
    const r = await call('/reservations', { cookie: owner, body: { guest: { name: 'Rate Keeper', phone: '08020000001' }, room_type_id: typeId, check_in: sat, check_out: addDays(sat, 2), adults: 1, source: 'phone' } });
    ok(r, 201);
    const before = get<{ total: number }>('SELECT total FROM reservations WHERE id = ?', r.json.id)!.total;
    assert.equal(before, 36000 + 30000);
    const rule = get<{ id: number }>("SELECT id FROM rate_rules WHERE name = 'Weekend'")!.id;
    ok(await call(`/rate-rules/${rule}`, { cookie: owner, method: 'PUT', body: { name: 'Weekend', kind: 'percent', value: 50, weekdays: [5, 6] } }));
    assert.equal(get<{ total: number }>('SELECT total FROM reservations WHERE id = ?', r.json.id)!.total, before);
    // Extending adds the new night at today's price (Monday, no rule).
    ok(await call(`/reservations/${r.json.id}/extend`, { cookie: owner, body: { check_out: addDays(sat, 3) } }));
    assert.equal(get<{ total: number }>('SELECT total FROM reservations WHERE id = ?', r.json.id)!.total, before + 30000);
    // Shortening drops nights from the end.
    ok(await call(`/reservations/${r.json.id}/extend`, { cookie: owner, body: { check_out: addDays(sat, 1) } }));
    assert.deepEqual({ ...get<{ total: number; nights: number }>('SELECT total, nights FROM reservations WHERE id = ?', r.json.id)! }, { total: 36000, nights: 1 });
  });
});

describe('corporate accounts', () => {
  let companyId = 0;
  test('negotiated discount, bill to company at check-out, credit limit, and payment on account', async () => {
    const c = await call('/companies', { cookie: owner, body: { name: 'Shell Nigeria (Ibadan)', contact_name: 'Accounts', discount_pct: 10, credit_limit: 50000 } });
    ok(c, 201);
    companyId = c.json.id;
    const q = (await call(`/quote?room_type_id=${typeId}&check_in=${today()}&check_out=${addDays(today(), 1)}&company_id=${companyId}`, { cookie: owner })).json;
    const tonight = q.nights[0].rate;

    const room = get<{ id: number }>("SELECT id FROM rooms WHERE number = '101'")!.id;
    const stay = await call('/reservations', { cookie: owner, body: {
      guest: { name: 'Corporate Guest', phone: '08030000001' }, room_type_id: typeId, room_id: room, check_in: today(), check_out: addDays(today(), 1),
      adults: 1, source: 'phone', check_in_now: true, company_id: companyId, bill_to_company: true,
    } });
    ok(stay, 201);
    const res = get<{ total: number; rate_note: string }>('SELECT total, rate_note FROM reservations WHERE id = ?', stay.json.id)!;
    assert.equal(res.total, tonight);
    assert.match(res.rate_note, /Shell Nigeria \(Ibadan\) −10%/);

    ok(await call(`/reservations/${stay.json.id}/check-out`, { cookie: owner, body: {} }));
    const st = (await call(`/companies/${companyId}`, { cookie: owner })).json;
    assert.equal(st.balance, tonight);
    assert.equal(st.charges.length, 1);

    // Cash collected today does not include money the company hasn't paid yet.
    const day = (await call(`/reports/pnl?from=${today()}&to=${today()}`, { cookie: owner })).json;
    assert.equal(day.collections.total, 0);

    // A second stay would take the account over its ₦50,000 limit: refused, unless a manager overrides.
    const room2 = get<{ id: number }>("SELECT id FROM rooms WHERE number = '102'")!.id;
    const big = await call('/reservations', { cookie: owner, body: {
      guest: { name: 'Second Guest', phone: '08030000002' }, room_type_id: typeId, room_id: room2, check_in: today(), check_out: addDays(today(), 2),
      adults: 1, source: 'phone', check_in_now: true, company_id: companyId, bill_to_company: true, rate: 40000,
    } });
    ok(big, 201);
    const refused = await call(`/reservations/${big.json.id}/check-out`, { cookie: owner, body: {} });
    ok(refused, 409);
    assert.match(refused.json.error, /credit limit/);
    ok(await call(`/reservations/${big.json.id}/check-out`, { cookie: owner, body: { force: true } }));
    // Leaving after one night of two: the company is billed for one night at the manager's rate.
    assert.equal((await call(`/companies/${companyId}`, { cookie: owner })).json.balance, tonight + 40000);
    assert.ok(all("SELECT 1 FROM audit_log WHERE action = 'bill_to_company'").length === 2);
  });

  test('company payments reduce what is owed and count as cash collected', async () => {
    const before = (await call(`/companies/${companyId}`, { cookie: owner })).json.balance;
    ok(await call(`/companies/${companyId}/payments`, { cookie: owner, body: { amount: before + 1, method: 'transfer' } }), 400);
    ok(await call(`/companies/${companyId}/payments`, { cookie: owner, body: { amount: before, method: 'transfer', reference: 'TRF-001' } }), 201);
    assert.equal((await call(`/companies/${companyId}`, { cookie: owner })).json.balance, 0);
    const day = (await call(`/reports/pnl?from=${today()}&to=${today()}`, { cookie: owner })).json;
    assert.equal(day.collections.bySource['Company accounts'], before);
  });
});

describe('Paystack deposits', () => {
  let code = '';
  test('a website booking shows the deposit and starts a payment only with the right phone', async () => {
    const ci = addDays(today(), 40);
    const req = await call('/public/booking-requests', { body: { name: 'Online Payer', phone: '08040000001', email: 'payer@example.com', check_in: ci, check_out: addDays(ci, 1), room_type_id: typeId, adults: 1 } });
    ok(req, 201);
    code = req.json.code;
    assert.equal(req.json.deposit, Math.ceil(req.json.total * 0.3));
    ok(await call('/public/payments/start', { body: { code, phone: '08099999999', email: 'payer@example.com' } }), 404);
    const start = await call('/public/payments/start', { body: { code, phone: '0804 000 0001', email: 'payer@example.com' } });
    ok(start);
    assert.match(start.json.url, /^https:\/\/checkout\.paystack\.test\//);
    assert.equal(start.json.amount, req.json.deposit);

    const v = await call(`/public/payments/verify?reference=${start.json.reference}`);
    ok(v);
    assert.equal(v.json.status, 'success');
    const r = get<{ status: string; id: number }>('SELECT id, status FROM reservations WHERE code = ?', code)!;
    assert.equal(r.status, 'confirmed', 'paying the deposit confirms the booking');
    // Verifying again (or a webhook arriving later) never records the money twice.
    ok(await call(`/public/payments/verify?reference=${start.json.reference}`));
    assert.equal(all("SELECT 1 FROM payments WHERE method = 'online' AND reservation_id = ?", r.id).length, 1);
  });

  test('webhooks need a valid signature, and a tampered amount is refused', async () => {
    const start = (await call('/public/payments/start', { body: { code, phone: '08040000001', email: 'payer@example.com' } })).json;
    const event = JSON.stringify({ event: 'charge.success', data: { reference: start.reference, amount: start.amount * 100 } });
    ok(await call('/paystack/webhook', { raw: event, headers: { 'x-paystack-signature': 'forged' } }), 401);
    const sig = createHmac('sha512', 'sk_test_danest').update(event).digest('hex');
    ok(await call('/paystack/webhook', { raw: event, headers: { 'x-paystack-signature': sig, 'x-danest-request': '' } }));
    assert.equal(get<{ status: string }>('SELECT status FROM online_payments WHERE reference = ?', start.reference)!.status, 'success');

    const third = (await call('/public/payments/start', { body: { code, phone: '08040000001', email: 'payer@example.com' } })).json;
    paystack.amountOverride = 100; // ₦1 instead of the deposit
    ok(await call(`/public/payments/verify?reference=${third.reference}`), 409);
    paystack.amountOverride = null;
    assert.equal(get<{ status: string }>('SELECT status FROM online_payments WHERE reference = ?', third.reference)!.status, 'failed');
  });

  test('a deposit paid after the hotel filled up is kept, but does not overbook', async () => {
    const ci = addDays(today(), 60);
    const req = await call('/public/booking-requests', { body: { name: 'Late Payer', phone: '08040000002', email: 'late@example.com', check_in: ci, check_out: addDays(ci, 1), room_type_id: typeId, adults: 1 } });
    ok(req, 201);
    // The front desk sells all three rooms while the request is still waiting.
    for (const n of [1, 2, 3]) {
      ok(await call('/reservations', { cookie: owner, body: { guest: { name: `Walk In ${n}`, phone: `0805000000${n}` }, check_in: ci, check_out: addDays(ci, 1), room_type_id: typeId, adults: 1, source: 'phone' } }), 201);
    }
    const start = (await call('/public/payments/start', { body: { code: req.json.code, phone: '08040000002', email: 'late@example.com' } })).json;
    const v = await call(`/public/payments/verify?reference=${start.reference}`);
    ok(v);
    assert.equal(v.json.status, 'success');
    assert.equal(v.json.booking_status, 'pending', 'the guest is told the desk still has to confirm');
    const r = get<{ id: number; status: string }>('SELECT id, status FROM reservations WHERE code = ?', req.json.code)!;
    assert.equal(r.status, 'pending');
    assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM reservations WHERE status = 'confirmed' AND check_in = ?", ci)!.n, 3, 'never more confirmed stays than rooms');
    assert.equal(get<{ v: number }>("SELECT SUM(amount) v FROM payments WHERE method = 'online' AND reservation_id = ?", r.id)!.v, start.amount, 'the money is still on record');
  });
});

describe('guest messages', () => {
  test('without an SMS provider, staff get a ready WhatsApp message', async () => {
    const id = get<{ id: number }>("SELECT id FROM reservations WHERE status = 'confirmed' LIMIT 1")!.id;
    const r = await call(`/reservations/${id}/messages`, { cookie: owner, body: { template: 'booking_confirmed', channel: 'sms' } });
    ok(r, 201);
    assert.equal(r.json.status, 'manual');
    assert.match(r.json.link, /^https:\/\/wa\.me\/234\d{10}\?text=/);
    assert.match(r.json.text, /is confirmed/);
  });

  test('with Termii configured, SMS is sent and failures are recorded honestly', async () => {
    process.env.TERMII_API_KEY = 'tk_test';
    process.env.TERMII_SENDER_ID = 'Danest';
    const id = get<{ id: number }>("SELECT id FROM reservations WHERE status = 'confirmed' LIMIT 1")!.id;
    const r = await call(`/reservations/${id}/messages`, { cookie: owner, body: { template: 'pre_arrival', channel: 'sms' } });
    assert.equal(r.json.status, 'sent');
    assert.equal(sms.at(-1)!.to.startsWith('234'), true);
    const log = (await call(`/reservations/${id}/messages`, { cookie: owner })).json;
    assert.equal(log[0].status, 'sent');
    delete process.env.TERMII_API_KEY;
  });
});
