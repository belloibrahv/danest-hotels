import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DB_PATH, db, get, run } from './db.ts';
import { today } from './lib.ts';
import { seal } from './seal.ts';

/**
 * Backups. Every night the whole database is copied to a backups folder beside it (the last
 * 14 kept), and — when off-site storage is set up — sent, encrypted, to any S3-compatible bucket
 * (Cloudflare R2, Backblaze B2, AWS S3). A copy on the same disk survives mistakes; only the
 * off-site copy survives losing the disk.
 *
 *   BACKUP_S3_ENDPOINT   https://<account>.r2.cloudflarestorage.com (or s3.<region>.amazonaws.com …)
 *   BACKUP_S3_BUCKET     bucket name
 *   BACKUP_S3_KEY_ID / BACKUP_S3_SECRET   access keys with write access to that bucket
 *   BACKUP_S3_REGION     'auto' for R2 (default), the bucket's region elsewhere
 *   BACKUP_PASSPHRASE    encrypts off-site copies; falls back to DANEST_SECRET. Keep it somewhere
 *                        other than the server: it is the only way to read an off-site copy.
 */
const KEEP = 14;
export const BACKUP_DIR = DB_PATH === ':memory:' ? null : join(dirname(DB_PATH), 'backups');

const s3 = () => {
  const { BACKUP_S3_ENDPOINT: endpoint, BACKUP_S3_BUCKET: bucket, BACKUP_S3_KEY_ID: keyId, BACKUP_S3_SECRET: secret } = process.env;
  return endpoint && bucket && keyId && secret ? { endpoint, bucket, keyId, secret, region: process.env.BACKUP_S3_REGION || 'auto' } : null;
};
const passphrase = () => process.env.BACKUP_PASSPHRASE || process.env.DANEST_SECRET || null;

export function offsiteStatus() {
  if (!s3()) return { configured: false, reason: 'Off-site storage is not set up (BACKUP_S3_* settings).' };
  if (!passphrase()) return { configured: false, reason: 'Set BACKUP_PASSPHRASE (or DANEST_SECRET) so off-site copies can be encrypted.' };
  return { configured: true, reason: null };
}

// ---------- S3 PUT with AWS Signature v4 (path-style; works with R2, B2 and AWS) ----------

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const hmac = (k: Buffer | string, s: string) => createHmac('sha256', k).update(s).digest();

export async function s3Put(cfg: NonNullable<ReturnType<typeof s3>>, key: string, body: Buffer, now = new Date()) {
  const url = new URL(cfg.endpoint);
  const path = `/${encodeURIComponent(cfg.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const hash = sha256(body);
  const signed = 'host;x-amz-content-sha256;x-amz-date';
  const canonical = ['PUT', path, '', `host:${url.host}`, `x-amz-content-sha256:${hash}`, `x-amz-date:${amzDate}`, '', signed, hash].join('\n');
  const scope = `${day}/${cfg.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${cfg.secret}`, day), cfg.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  const res = await fetch(`${url.origin}${path}`, {
    method: 'PUT',
    headers: {
      'x-amz-content-sha256': hash,
      'x-amz-date': amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${cfg.keyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
      'content-type': 'application/octet-stream',
    },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Off-site storage refused the backup (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

// ---------- taking and listing backups ----------

export function listBackups() {
  if (!BACKUP_DIR || !existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .filter((f) => /^danest-\d{4}-\d{2}-\d{2}T\d{4}\.db$/.test(f))
    .sort()
    .reverse()
    .map((name) => ({ name, bytes: statSync(join(BACKUP_DIR!, name)).size, at: statSync(join(BACKUP_DIR!, name)).mtime.toISOString() }));
}

let running: Promise<unknown> | null = null;

/** Take a backup now. Never two at once; the newest 14 are kept on the volume. */
export function backupNow(reason: 'nightly' | 'manual' | 'startup', userId: number | null = null) {
  if (!BACKUP_DIR) throw new Error('This database lives in memory; there is nothing to back up');
  if (running) return running as Promise<{ name: string; offsite: string }>;
  const work = (async () => {
    mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace(/^(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    const name = `danest-${stamp}.db`;
    const file = join(BACKUP_DIR, name);
    if (existsSync(file)) unlinkSync(file);
    // VACUUM INTO writes a consistent copy while the hotel keeps working.
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    for (const old of listBackups().slice(KEEP)) unlinkSync(join(BACKUP_DIR, old.name));
    let offsite = 'not set up';
    const cfg = s3();
    const pass = passphrase();
    if (cfg && pass) {
      try {
        await s3Put(cfg, `danest/${name}.enc`, seal(readFileSync(file), pass));
        offsite = 'sent';
      } catch (err) {
        offsite = `failed: ${(err as Error).message}`;
        console.error('backup upload', err);
      }
    }
    run('INSERT INTO audit_log (user_id, action, entity, detail) VALUES (?,?,?,?)', userId, offsite.startsWith('failed') ? 'backup_failed' : 'backup', 'system',
      JSON.stringify({ name, reason, bytes: statSync(file).size, offsite }));
    return { name, offsite };
  })();
  running = work.finally(() => (running = null));
  return work;
}

export function lastBackup() {
  return get<{ created_at: string; action: string; detail: string }>("SELECT created_at, action, detail FROM audit_log WHERE action IN ('backup','backup_failed') ORDER BY id DESC LIMIT 1");
}

/** Once an hour: if today (Lagos) has no backup yet and it is past 3 am, take one. */
export function scheduleBackups() {
  if (!BACKUP_DIR || process.env.DANEST_BACKUPS === 'off') return;
  const tick = () => {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Africa/Lagos' }).format(new Date()));
    // A failed upload counts as not done, so the next hour tries again.
    const done = !!get("SELECT 1 FROM audit_log WHERE action = 'backup' AND date(created_at, '+1 hour') = ?", today());
    if (hour >= 3 && !done) backupNow('nightly').catch((e) => console.error('nightly backup', e));
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 3600_000).unref();
}

export const backupPath = (name: string) => {
  if (!BACKUP_DIR || !/^danest-\d{4}-\d{2}-\d{2}T\d{4}\.db$/.test(basename(name)) || name !== basename(name)) return null;
  const p = join(BACKUP_DIR, name);
  return existsSync(p) ? p : null;
};
