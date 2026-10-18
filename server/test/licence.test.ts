// Licences: signed keys, the warning and grace periods, and read-only once expired. Uses its own keypair.
import { generateKeyPairSync, sign } from 'node:crypto';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
process.env.DANEST_DB = ':memory:';
process.env.DANEST_SETUP_CODE = 'LICENCE-TEST';
process.env.LICENCE_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }) as string;

const { createApp } = await import('../app.ts');
const { readLicence, licenceStatus } = await import('../licence.ts');
const { addDays, today } = await import('../lib.ts');

const issue = (expires: string, hotel = 'Lagoon View Hotel') => {
  const body = Buffer.from(JSON.stringify({ id: 'abc', hotel, plan: 'standard', issued: today(), expires })).toString('base64url');
  return `HL1.${body}.${sign(null, Buffer.from(`HL1.${body}`), privateKey).toString('base64url')}`;
};

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let owner = '';
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
  const r = await fetch(`${base}/setup/owner`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-danest-request': '1' }, body: JSON.stringify({ code: 'LICENCE-TEST', hotel_name: 'Lagoon View Hotel', name: 'Owner Person', username: 'owner', password: 'owner passphrase 1' }) });
  owner = r.headers.get('set-cookie')!.split(';')[0];
});
after(() => {
  server.closeAllConnections();
  server.close();
});

const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-danest-request': '1', cookie: owner }, body: JSON.stringify(body) });

describe('licence keys', () => {
  test('only keys signed by the vendor are accepted, and they cannot be edited', () => {
    const key = issue('2027-10-31');
    assert.equal(readLicence(key)!.hotel, 'Lagoon View Hotel');
    const [v, body, sig] = key.split('.');
    const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), expires: '2099-12-31' })).toString('base64url');
    assert.equal(readLicence(`${v}.${edited}.${sig}`), null, 'a changed expiry date breaks the signature');
    const other = generateKeyPairSync('ed25519').privateKey;
    assert.equal(readLicence(`HL1.${body}.${sign(null, Buffer.from(`HL1.${body}`), other).toString('base64url')}`), null, 'a key signed by anyone else is refused');
    assert.equal(readLicence('nonsense'), null);
  });

  test('warned, then grace, then expired', () => {
    process.env.LICENCE_REQUIRED = '1';
    const at = (days: number) => ((process.env.LICENCE_KEY = issue(addDays(today(), days))), licenceStatus().state);
    assert.equal(at(90), 'valid');
    assert.equal(at(20), 'expiring');
    assert.equal(at(-3), 'grace');
    assert.equal(at(-30), 'expired');
    delete process.env.LICENCE_KEY;
    assert.equal(licenceStatus().state, 'missing');
    delete process.env.LICENCE_REQUIRED;
    assert.equal(licenceStatus().state, 'not_required', 'an installation that does not require one is never held to it');
  });

  test('once expired, staff screens are read-only; signing in, guests and the data still work', async () => {
    process.env.LICENCE_REQUIRED = '1';
    process.env.LICENCE_KEY = issue(addDays(today(), -40));
    const blocked = await post('/expenses', { category: 'other', description: 'x', amount: 1, method: 'cash' });
    assert.equal(blocked.status, 402);
    assert.match(((await blocked.json()) as { error: string }).error, /read-only/);
    assert.equal((await fetch(`${base}/settings`, { headers: { cookie: owner } })).status, 200, 'everything can still be read');
    assert.equal((await post('/auth/logout', {})).status, 200, 'signing out works');
    assert.equal((await fetch(`${base}/licence`, { headers: { cookie: owner } })).status, 401);
    process.env.LICENCE_KEY = issue(addDays(today(), 365));
    delete process.env.LICENCE_REQUIRED;
  });
});
