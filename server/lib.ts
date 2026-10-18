import type { NextFunction, Request, Response } from 'express';
import { HOTEL } from '../shared/constants.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const bad = (message: string) => new HttpError(400, message);

/** Wrap a sync or async handler so thrown errors reach the error middleware. */
export const h =
  (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
    try {
      const r = fn(req, res);
      if (r instanceof Promise) r.catch(next);
    } catch (err) {
      next(err);
    }
  };

// ---------- dates (always Lagos local) ----------

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: HOTEL.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });

export function today(): string {
  return dateFmt.format(new Date());
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isDate(v: unknown): v is string {
  return typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
}

// ---------- input validation (small and explicit; every field is allow-listed) ----------

type Body = Record<string, unknown>;

export function body(req: Request): Body {
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('Expected a JSON object');
  return b as Body;
}

export function str(b: Body, key: string, opts: { max?: number; min?: number; optional?: boolean; pattern?: RegExp } = {}): string {
  const v = b[key];
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return '';
    throw bad(`${key} is required`);
  }
  if (typeof v !== 'string') throw bad(`${key} must be text`);
  const s = v.trim();
  if (s.length < (opts.min ?? (opts.optional ? 0 : 1))) throw bad(`${key} is too short`);
  if (s.length > (opts.max ?? 200)) throw bad(`${key} is too long`);
  if (opts.pattern && s && !opts.pattern.test(s)) throw bad(`${key} is not valid`);
  return s;
}

export function int(b: Body, key: string, opts: { min?: number; max?: number; optional?: boolean } = {}): number {
  const v = b[key];
  if ((v === undefined || v === null || v === '') && opts.optional) return NaN;
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw bad(`${key} must be a whole number`);
  if (n < (opts.min ?? 0)) throw bad(`${key} must be at least ${opts.min ?? 0}`);
  if (n > (opts.max ?? 1_000_000_000)) throw bad(`${key} is too large`);
  return n;
}

export function oneOf<T extends string>(b: Body, key: string, allowed: readonly T[]): T {
  const v = b[key];
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw bad(`${key} must be one of: ${allowed.join(', ')}`);
  return v as T;
}

export function date(b: Body, key: string, fallback?: string): string {
  const v = b[key];
  if ((v === undefined || v === '') && fallback) return fallback;
  if (!isDate(v)) throw bad(`${key} must be a date (YYYY-MM-DD)`);
  return v;
}

export const PHONE_RE = /^[+\d][\d\s-]{6,19}$/;
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** Parse ?from=&to= with sensible defaults (month to date). */
export function range(req: Request): { from: string; to: string } {
  const t = today();
  const from = isDate(req.query.from) ? req.query.from : `${t.slice(0, 8)}01`;
  const to = isDate(req.query.to) ? req.query.to : t;
  if (to < from) throw bad('"to" must be on or after "from"');
  if (daysBetween(from, to) > 3 * 366) throw bad('Date range is too long');
  return { from, to };
}

export function code(prefix: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}-${Array.from(bytes, (x) => alphabet[x % alphabet.length]).join('')}`;
}
