/**
 * Restore from a backup. Stop the app first; this replaces the database file.
 *
 *   node server/restore.ts <backup file>                 # a copy from the backups folder (.db)
 *   BACKUP_PASSPHRASE=… node server/restore.ts <file>.enc  # an off-site copy (encrypted)
 *
 * The current database is kept beside it as danest.db.before-restore-<time>.
 */
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { unseal } from './seal.ts';

const [file] = process.argv.slice(2);
if (!file || !existsSync(file)) {
  console.error('Usage: node server/restore.ts <backup file>');
  process.exit(1);
}
const target = process.env.DANEST_DB ?? resolve(import.meta.dirname, '../data/danest.db');
let bytes: Buffer = readFileSync(file);
if (file.endsWith('.enc')) {
  const pass = process.env.BACKUP_PASSPHRASE || process.env.DANEST_SECRET;
  if (!pass) throw new Error('Set BACKUP_PASSPHRASE (or DANEST_SECRET) to the value used when the backup was made');
  bytes = unseal(bytes, pass);
}
const tmp = `${target}.restoring`;
writeFileSync(tmp, bytes);
const check = new DatabaseSync(tmp, { readOnly: true });
const ok = (check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
const version = (check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
check.close();
if (ok !== 'ok') throw new Error(`The backup failed its integrity check: ${ok}`);
if (existsSync(target)) copyFileSync(target, `${target}.before-restore-${Date.now()}`);
for (const ext of ['-wal', '-shm']) rmSync(`${target}${ext}`, { force: true });
renameSync(tmp, target);
console.log(`Restored ${file} (schema version ${version}) to ${target}. Start the app again.`);
