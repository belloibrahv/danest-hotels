import { createPublicKey, verify } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { addDays, daysBetween, today } from './lib.ts';

/**
 * Licences, for hotels that buy the system. A licence key is signed by the vendor's private key
 * (kept on the vendor's machine, never here) and checked against this public key, so it cannot
 * be edited or made up. It names the hotel, the plan and the last day it is valid.
 *
 * Only an installation with LICENCE_REQUIRED=1 is held to it. There, managers are warned from 30
 * days out; after expiry there are 14 days' grace; after that the staff screens are read-only
 * until a new key is set (LICENCE_KEY). Guests can always book and pay, and the hotel can always
 * sign in and download its data.
 */
const VENDOR_PUBLIC_KEY = process.env.LICENCE_PUBLIC_KEY ?? `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAitU7lIeZch7Wi6DYa4EPTXG8LfIXy74hOMeeAv42yN8=
-----END PUBLIC KEY-----`;

export const GRACE_DAYS = 14;
export const WARN_DAYS = 30;

export interface LicencePayload {
  id: string;
  hotel: string;
  plan: string;
  issued: string;
  expires: string;
}

export type LicenceState = 'not_required' | 'valid' | 'expiring' | 'grace' | 'expired' | 'missing' | 'invalid';

const b64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** "HL1.<payload>.<signature>", both base64url; the signature covers "HL1.<payload>". */
export function readLicence(key: string | undefined, publicKey = VENDOR_PUBLIC_KEY): LicencePayload | null {
  if (!key) return null;
  const [v, body, sig] = key.trim().split('.');
  if (v !== 'HL1' || !body || !sig) return null;
  // Exactly one spelling per key: re-encoding must give back what was written.
  const canon = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (canon(b64u(body)) !== body || canon(b64u(sig)) !== sig) return null;
  try {
    if (!verify(null, Buffer.from(`HL1.${body}`), createPublicKey(publicKey), b64u(sig))) return null;
    const p = JSON.parse(b64u(body).toString('utf8')) as LicencePayload;
    return p && typeof p.expires === 'string' && typeof p.hotel === 'string' ? p : null;
  } catch {
    return null;
  }
}

export function licenceStatus(now = today()) {
  const required = process.env.LICENCE_REQUIRED === '1';
  const raw = process.env.LICENCE_KEY;
  const p = readLicence(raw);
  const base = { required, licence: p ? { hotel: p.hotel, plan: p.plan, expires: p.expires } : null };
  let state: LicenceState;
  let days: number | null = null;
  if (!p) state = raw ? 'invalid' : 'missing';
  else {
    days = daysBetween(now, p.expires);
    state = days < -GRACE_DAYS ? 'expired' : days < 0 ? 'grace' : days <= WARN_DAYS ? 'expiring' : 'valid';
  }
  if (!required && state !== 'valid' && state !== 'expiring' && state !== 'grace') return { ...base, state: 'not_required' as LicenceState, days, read_only_from: null };
  return { ...base, state, days, read_only_from: p ? addDays(p.expires, GRACE_DAYS + 1) : null };
}

export const readOnly = () => {
  const s = licenceStatus();
  return s.required && (s.state === 'expired' || s.state === 'missing' || s.state === 'invalid');
};

/** What keeps working without a licence: signing in and out, guests, payments, and the hotel's own data leaving. */
const ALWAYS = [/^\/auth\//, /^\/setup\//, /^\/public\//, /^\/admin\/backups\/download$/];

export function enforceLicence(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || ALWAYS.some((r) => r.test(req.path)) || !readOnly()) return next();
  res.status(402).json({ error: 'The licence for this system has run out, so it is read-only. Ask the owner to renew it; nothing already recorded is lost.' });
}
