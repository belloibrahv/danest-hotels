import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { hasRole, type Role } from '../shared/constants.ts';
import { get, run } from './db.ts';
import { HttpError } from './lib.ts';
import { keyedHash } from './secrets.ts';

export interface SessionUser {
  id: number;
  name: string;
  username: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
  }
}

export const SESSION_COOKIE = 'dh_sid';
const SESSION_HOURS = 12;
const isProd = process.env.NODE_ENV === 'production';

// ---------- passwords: scrypt (N=2^15) with per-user salt ----------

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return timingSafeEqual(expected, actual);
}

// Burn the same CPU for unknown usernames so response time doesn't reveal which accounts exist.
const DUMMY_HASH = hashPassword(randomBytes(12).toString('hex'));

export function checkCredentials(username: string, password: string): (SessionUser & { mfa: boolean }) | null {
  const row = get<SessionUser & { password_hash: string; active: number; totp_enabled: number }>(
    'SELECT id, name, username, role, password_hash, active, totp_enabled FROM users WHERE username = ?',
    username,
  );
  const ok = verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok || !row.active) return null;
  return { id: row.id, name: row.name, username: row.username, role: row.role, mfa: !!row.totp_enabled };
}

// ---------- second factor: a short-lived, single-purpose challenge between the two sign-in steps ----------

const MFA_MINUTES = 5;

export function createMfaChallenge(userId: number): string {
  const token = randomBytes(32).toString('base64url');
  run('DELETE FROM mfa_challenges WHERE expires_at < ? OR user_id = ?', new Date().toISOString(), userId);
  run('INSERT INTO mfa_challenges (id, user_id, expires_at) VALUES (?,?,?)', sha256(token), userId, new Date(Date.now() + MFA_MINUTES * 60_000).toISOString());
  return token;
}

/** Returns the user id if the challenge is live; counts the attempt; burns it after 5 tries. */
export function useMfaChallenge(token: string): number | null {
  if (typeof token !== 'string' || token.length > 100) return null;
  const id = sha256(token);
  const row = get<{ user_id: number; expires_at: string; attempts: number }>('SELECT user_id, expires_at, attempts FROM mfa_challenges WHERE id = ?', id);
  if (!row || row.expires_at < new Date().toISOString() || row.attempts >= 5) {
    if (row) run('DELETE FROM mfa_challenges WHERE id = ?', id);
    return null;
  }
  run('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = ?', id);
  return row.user_id;
}

export const finishMfaChallenge = (token: string) => run('DELETE FROM mfa_challenges WHERE id = ?', sha256(token));

export const hashCode = (code: string) => keyedHash(`recovery:${code.toUpperCase().replace(/[^A-Z0-9]/g, '')}`);

export const passwordProblem = (pw: string) =>
  pw.length < 10 ? 'Password must be at least 10 characters' : pw.length > 128 ? 'Password is too long' : null;

// ---------- sessions: random token in an HttpOnly cookie, only its hash stored ----------

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function createSession(req: Request, res: Response, userId: number) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000);
  const now = new Date().toISOString();
  run('DELETE FROM sessions WHERE expires_at < ?', now);
  run(
    'INSERT INTO sessions (id, user_id, expires_at, user_agent, ip, last_seen_at) VALUES (?,?,?,?,?,?)',
    sha256(token), userId, expires.toISOString(), (req.get('user-agent') ?? '').slice(0, 200), req.ip ?? null, now,
  );
  run('UPDATE users SET last_login_at = ? WHERE id = ?', now, userId);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProd,
    path: '/api',
    expires,
  });
}

export function destroySession(req: Request, res: Response) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) run('DELETE FROM sessions WHERE id = ?', sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/api' });
}

export function destroyUserSessions(userId: number, exceptReq?: Request) {
  const keep = exceptReq ? currentSessionId(exceptReq) : null;
  run('DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?', userId, keep);
}

/** The stored id (hash) of the session making this request. */
export function currentSessionId(req: Request): string | null {
  const token = readCookie(req, SESSION_COOKIE);
  return token ? sha256(token) : null;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** Attaches req.user when a valid session cookie is present. Never rejects on its own. */
export function loadSession(req: Request, _res: Response, next: NextFunction) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token && token.length < 100) {
    const sid = sha256(token);
    const row = get<SessionUser & { expires_at: string; active: number; last_seen_at: string | null }>(
      `SELECT u.id, u.name, u.username, u.role, u.active, s.expires_at, s.last_seen_at
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      sid,
    );
    const now = new Date();
    if (row && row.active && row.expires_at > now.toISOString()) {
      req.user = { id: row.id, name: row.name, username: row.username, role: row.role };
      // Cheap "last active" for the sessions list: write at most every 5 minutes.
      if (!row.last_seen_at || Date.parse(row.last_seen_at) < now.getTime() - 5 * 60_000) {
        run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', now.toISOString(), sid);
      }
    }
  }
  next();
}

/** Deny by default: every staff route names the roles allowed to use it. The owner/CEO passes any manager gate. */
export const allow =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in'));
    if (!hasRole(req.user.role, roles)) return next(new HttpError(403, 'Your role does not have access to this'));
    next();
  };

export const currentUser = (req: Request): SessionUser => {
  if (!req.user) throw new HttpError(401, 'Please sign in');
  return req.user;
};

// ---------- rate limiting (fixed window, persisted so restarts don't reset it) ----------

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const row = get<{ count: number; reset_at: number }>('SELECT count, reset_at FROM rate_limits WHERE key = ?', key);
  if (!row || row.reset_at <= now) {
    run('INSERT OR REPLACE INTO rate_limits (key, count, reset_at) VALUES (?,?,?)', key, 1, now + windowMs);
    return;
  }
  if (row.count >= limit) {
    const mins = Math.ceil((row.reset_at - now) / 60_000);
    throw new HttpError(429, `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
  run('UPDATE rate_limits SET count = count + 1 WHERE key = ?', key);
}

export function clearRateLimit(key: string) {
  run('DELETE FROM rate_limits WHERE key = ?', key);
}
