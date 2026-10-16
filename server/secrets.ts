import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Encryption for secrets at rest (two-factor seeds). The key comes from DANEST_SECRET
 * when set — recommended in production so the key lives outside the database volume.
 * Otherwise a random key is generated once and kept beside the database (0600).
 */
function loadKey(): Buffer {
  const env = process.env.DANEST_SECRET;
  if (env) return createHash('sha256').update(env).digest();
  const dbPath = process.env.DANEST_DB ?? resolve(import.meta.dirname, '../data/danest.db');
  if (dbPath === ':memory:') return randomBytes(32);
  const file = resolve(dirname(dbPath), 'secret.key');
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
    if (process.env.NODE_ENV === 'production') console.warn('DANEST_SECRET is not set; generated a key file next to the database.');
  }
  return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
}

const KEY = loadKey();

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

export function decrypt(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(':');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unreadable secret');
  const d = createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}
