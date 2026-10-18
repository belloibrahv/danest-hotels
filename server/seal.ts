import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/** Backup encryption, kept apart from the database so a restore can read a backup without opening the live file. */
const MAGIC = Buffer.from('DANESTBK1');

export function seal(data: Buffer, pass: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(pass, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
}

export function unseal(file: Buffer, pass: string): Buffer {
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a Danest backup');
  let o = MAGIC.length;
  const salt = file.subarray(o, (o += 16));
  const iv = file.subarray(o, (o += 12));
  const tag = file.subarray(o, (o += 16));
  const key = scryptSync(pass, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(file.subarray(o)), d.final()]);
}

