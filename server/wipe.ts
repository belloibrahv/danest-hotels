/**
 * Empty the database for a real start: every booking, sale, guest, account and setting goes,
 * and /setup opens again for the owner. A backup is taken first.
 *
 *   node server/wipe.ts --yes-delete-everything                 # local database
 *   node server/wipe.ts --production --yes-delete-everything    # the live database (run on the server)
 */
import { all, db, get } from './db.ts';
import { backupNow } from './backup.ts';

const args = process.argv.slice(2);
if (!args.includes('--yes-delete-everything')) {
  console.error('This deletes every booking, sale, guest, account and setting. Run again with --yes-delete-everything.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && !args.includes('--production')) {
  console.error('This is a production database. Add --production as well.');
  process.exit(1);
}

const before = get<{ n: number }>('SELECT COUNT(*) n FROM reservations')!.n;
const { name } = await backupNow('manual');
console.log(`Backed up first: ${name}`);

const tables = all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((t) => t.name);
db.exec('PRAGMA foreign_keys = OFF');
db.exec('BEGIN IMMEDIATE');
try {
  for (const t of tables) db.exec(`DELETE FROM "${t}"`);
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
} finally {
  db.exec('PRAGMA foreign_keys = ON');
}
db.exec('VACUUM');
console.log(`Emptied ${tables.length} tables (${before} reservations removed). Open /setup to create the owner's account.`);
