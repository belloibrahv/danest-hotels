// Backups against a real database file and a stand-in for off-site storage (an S3-style bucket).
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'danest-backup-'));
process.env.DANEST_DB = join(dir, 'hotel.db');
process.env.DANEST_SETUP_CODE = 'BACKUP-TEST';
process.env.BACKUP_PASSPHRASE = 'a long backup passphrase';

const received: { path: string; headers: Record<string, unknown>; body: Buffer }[] = [];
const bucket = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c)).on('end', () => {
    received.push({ path: req.url!, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(200).end();
  });
});

const { createApp } = await import('../app.ts');
const { unseal } = await import('../seal.ts');

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let owner = '';
before(async () => {
  bucket.listen(0);
  await new Promise((r) => bucket.once('listening', r));
  Object.assign(process.env, {
    BACKUP_S3_ENDPOINT: `http://localhost:${(bucket.address() as AddressInfo).port}`,
    BACKUP_S3_BUCKET: 'hotel-backups',
    BACKUP_S3_KEY_ID: 'TESTKEY',
    BACKUP_S3_SECRET: 'testsecret',
  });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
  const r = await fetch(`${base}/setup/owner`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-danest-request': '1' }, body: JSON.stringify({ code: 'BACKUP-TEST', hotel_name: 'Backup Test Hotel', name: 'The Owner', username: 'owner', password: 'owner passphrase 1' }) });
  owner = r.headers.get('set-cookie')!.split(';')[0];
});
after(() => {
  server.closeAllConnections();
  server.close();
  bucket.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = (path: string, body?: unknown) =>
  fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-danest-request': '1', cookie: owner }, body: body ? JSON.stringify(body) : undefined });

describe('backups', () => {
  let name = '';
  test('a backup is a full copy on the volume, and an encrypted copy off-site', async () => {
    const r = await call('/admin/backups', {});
    assert.equal(r.status, 201);
    const out = (await r.json()) as { name: string; offsite: string };
    name = out.name;
    assert.equal(out.offsite, 'sent');
    assert.ok(existsSync(join(dir, 'backups', name)));
    const put = received.at(-1)!;
    assert.equal(put.path, `/hotel-backups/danest/${name}.enc`);
    assert.match(String(put.headers.authorization), /^AWS4-HMAC-SHA256 Credential=TESTKEY\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    assert.ok(!put.body.includes(Buffer.from('SQLite format 3')), 'what leaves the server is encrypted');
    assert.equal(unseal(put.body, 'a long backup passphrase').subarray(0, 15).toString(), 'SQLite format 3');
    assert.throws(() => unseal(put.body, 'the wrong passphrase'));
    const status = (await (await call('/admin/backups')).json()) as { last: { ok: boolean }; backups: { name: string }[] };
    assert.equal(status.last.ok, true);
    assert.equal(status.backups[0].name, name);
  });

  test('only the owner downloads, with their password', async () => {
    assert.equal((await call('/admin/backups/download', { name, password: 'wrong' })).status, 400);
    assert.equal((await call('/admin/backups/download', { name: '../hotel.db', password: 'owner passphrase 1' })).status, 404, 'only files in the backups folder');
    const r = await call('/admin/backups/download', { name, password: 'owner passphrase 1' });
    assert.equal(r.status, 200);
    assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');
  });

  test('the restore command checks a backup and puts it in place', () => {
    const target = join(dir, 'restored.db');
    const enc = join(dir, 'offsite.enc');
    writeFileSync(enc, received.at(-1)!.body);
    const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(import.meta.dirname, '../restore.ts'), enc], { env: { ...process.env, DANEST_DB: target }, encoding: 'utf8' });
    assert.match(out, /Restored .* \(schema version \d+\)/);
    assert.equal(readFileSync(target).subarray(0, 15).toString(), 'SQLite format 3');
  });
});
