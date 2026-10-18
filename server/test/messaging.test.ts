// Guest emails and the owner's daily summary, against stand-ins for the email and SMS providers.
process.env.DANEST_DB = ':memory:';

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

const outbox: { to: string; path: string; body: any }[] = [];
const provider = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c)).on('end', () => {
    const body = JSON.parse(raw);
    outbox.push({ path: req.url!, to: req.url!.includes('email') ? body.to[0] : body.to, body });
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(req.url!.includes('email') ? { id: `em_${outbox.length}` } : { message_id: `sms_${outbox.length}` }));
  });
});

const { createApp } = await import('../app.ts');
const { seed } = await import('../seed.ts');
const { addDays, today } = await import('../lib.ts');
const { get } = await import('../db.ts');
const { ownerSummary } = await import('../routes/closeday.ts');

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let owner = '';
let desk = '';
before(async () => {
  provider.listen(0);
  await new Promise((r) => provider.once('listening', r));
  const p = `http://localhost:${(provider.address() as AddressInfo).port}`;
  Object.assign(process.env, { RESEND_API_KEY: 're_test', EMAIL_FROM: 'Danest <bookings@example.com>', EMAIL_BASE_URL: `${p}/email`, TERMII_API_KEY: 'tk', TERMII_SENDER_ID: 'Danest', TERMII_BASE_URL: `${p}/sms` });
  seed();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
  const login = async (username: string) => (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-danest-request': '1' }, body: JSON.stringify({ username, password: 'Danest@2026!' }) })).headers.get('set-cookie')!.split(';')[0];
  owner = await login('owner');
  desk = await login('frontdesk');
});
after(() => {
  server.closeAllConnections();
  server.close();
  provider.close();
});

const call = (path: string, cookie?: string, body?: unknown, method?: string) =>
  fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', 'x-danest-request': '1', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));
const settle = () => new Promise((r) => setTimeout(r, 150));

describe('guest emails', () => {
  test('a website booking with an email gets a confirmation email; one without does not', async () => {
    const types = (await call(`/public/room-types?check_in=${addDays(today(), 30)}&check_out=${addDays(today(), 32)}`)).json;
    const room = types.find((t: any) => t.available > 0);
    const book = (email: string) => call('/public/booking-requests', undefined, { name: 'Ada Obi', phone: '08031234567', email, check_in: addDays(today(), 30), check_out: addDays(today(), 32), adults: 1, room_type_id: room.id });
    const before = outbox.length;
    assert.equal((await book('ada@example.com')).status, 201);
    await settle();
    const mail = outbox.at(-1)!;
    assert.equal(outbox.length, before + 1);
    assert.equal(mail.to, 'ada@example.com');
    assert.match(mail.body.subject, /We have your booking request — DH-/);
    assert.equal((await book('')).status, 201);
    await settle();
    assert.equal(outbox.length, before + 1, 'no address, no email');
  });

  test('staff can email any message, and it is on record', async () => {
    const r = get<{ id: number }>("SELECT r.id FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE g.email = 'ada@example.com' LIMIT 1")!;
    const out = await call(`/reservations/${r.id}/messages`, desk, { template: 'pre_arrival', channel: 'email' });
    assert.equal(out.status, 201);
    assert.equal(out.json.status, 'sent');
    assert.equal(get<{ channel: string; status: string }>('SELECT channel, status FROM messages WHERE reservation_id = ? ORDER BY id DESC LIMIT 1', r.id)!.channel, 'email');
    assert.deepEqual((await call('/messaging/status', desk)).json, { sms: true, email: true, online_payments: false });
  });
});

describe('the owner\'s daily summary', () => {
  test('one paragraph with the day, the cash and the month', () => {
    const d = addDays(today(), -20);
    const text = ownerSummary(d, -500);
    assert.match(text, /^Danest Hotel & Suites, \w{3} \d{1,2} \w{3,4}: earned ₦/);
    assert.match(text, /Cash drawer short by ₦500\./);
    assert.match(text, /Month so far ₦/);
  });

  test('closing the day sends it to the owner, and the phone and email never reach the website', async () => {
    const s = (await call('/settings', owner)).json;
    assert.equal((await call('/settings', owner, { ...s, summary_phone: '0803 000 1111', summary_email: 'owner@example.com' }, 'PUT')).status, 200);
    const pub = (await call('/public/hotel')).json;
    assert.equal(pub.summary_phone, undefined);
    assert.equal(pub.summary_email, undefined);
    const view = (await call('/close-day', owner)).json;
    // Sort out anything that would stop the day closing, then close it.
    for (const r of view.checks.no_shows) await call(`/reservations/${r.id}/no-show`, owner, {});
    for (const r of view.checks.overdue) await call(`/reservations/${r.id}/check-out`, owner, { force: true });
    const fresh = (await call(`/close-day?date=${view.date}`, owner)).json;
    const before = outbox.length;
    // A day can pay out more cash than it took in (topped up from the safe), so the count is never below zero.
    const counted = Math.max(0, fresh.report.expected_cash);
    const closed = await call('/close-day', owner, { date: view.date, counted_cash: counted, notes: counted === fresh.report.expected_cash ? undefined : 'Topped up from the safe' });
    assert.equal(closed.status, 201, JSON.stringify(closed.json));
    assert.deepEqual(closed.json.summary.sent.sort(), ['email', 'sms']);
    const sent = outbox.slice(before);
    assert.ok(sent.some((m) => m.path.includes('sms') && m.to === '2348030001111'));
    assert.ok(sent.some((m) => m.path.includes('email') && m.to === 'owner@example.com'));
    assert.match(closed.json.summary.whatsapp, /^https:\/\/wa\.me\/2348030001111\?text=/);
  });
});
