/**
 * For the vendor only: issue and check licence keys.
 *
 *   node scripts/licence.ts issue --hotel "Lagoon View Hotel" --expires 2027-10-31 [--plan standard]
 *   node scripts/licence.ts check <key>
 *
 * The private key is read from LICENCE_PRIVATE_KEY_FILE, or ~/.config/hotel-licensing/licence-private.pem.
 * Keep that file (and a backup of it) private: anyone with it can issue licences.
 */
import { createPrivateKey, randomBytes, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readLicence } from '../server/licence.ts';

const [cmd, ...rest] = process.argv.slice(2);
const arg = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const b64u = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

if (cmd === 'issue') {
  const hotel = arg('hotel');
  const expires = arg('expires');
  if (!hotel || !expires || !/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
    console.error('Usage: node scripts/licence.ts issue --hotel "<name>" --expires YYYY-MM-DD [--plan standard]');
    process.exit(1);
  }
  const keyFile = process.env.LICENCE_PRIVATE_KEY_FILE ?? join(homedir(), '.config/hotel-licensing/licence-private.pem');
  const payload = { id: randomBytes(6).toString('hex'), hotel, plan: arg('plan') ?? 'standard', issued: new Date().toISOString().slice(0, 10), expires };
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  const sig = b64u(sign(null, Buffer.from(`HL1.${body}`), createPrivateKey(readFileSync(keyFile))));
  const key = `HL1.${body}.${sig}`;
  if (!readLicence(key)) throw new Error('The key does not verify against the public key built into the app. Wrong private key file?');
  console.log(key);
  console.error(`\nLicence ${payload.id} for ${hotel}, ${payload.plan}, valid to ${expires}. Set it on the hotel's server as LICENCE_KEY.`);
} else if (cmd === 'check') {
  const p = readLicence(rest[0]);
  console.log(p ? JSON.stringify(p, null, 2) : 'Not a valid licence key');
  process.exit(p ? 0 : 1);
} else {
  console.error('Commands: issue, check');
  process.exit(1);
}
