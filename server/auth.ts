import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../shared/constants.ts';
import { get, run } from './db.ts';
import { HttpError } from './lib.ts';

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

export function checkCredentials(username: string, password: string): SessionUser | null {
  const row = get<SessionUser & { password_hash: string; active: number }>(
    'SELECT id, name, username, role, password_hash, active FROM users WHERE username = ?',
    username,
  );
  const ok = verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok || !row.active) return null;
  return { id: row.id, name: row.name, username: row.username, role: row.role };
}

export const passwordProblem = (pw: string) =>
  pw.length < 10 ? 'Password must be at least 10 characters' : pw.length > 128 ? 'Password is too long' : null;

// ---------- sessions: random token in an HttpOnly cookie, only its hash stored ----------

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function createSession(res: Response, userId: number) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000);
  run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());
  run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)', sha256(token), userId, expires.toISOString());
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

export function destroyUserSessions(userId: number) {
  run('DELETE FROM sessions WHERE user_id = ?', userId);
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
    const row = get<SessionUser & { expires_at: string; active: number }>(
      `SELECT u.id, u.name, u.username, u.role, u.active, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      sha256(token),
    );
    if (row && row.active && row.expires_at > new Date().toISOString()) {
      req.user = { id: row.id, name: row.name, username: row.username, role: row.role };
    }
  }
  next();
}

/** Deny by default: every staff route names the roles allowed to use it. */
export const allow =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'Your role does not have access to this'));
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
