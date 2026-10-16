import { all, get, run } from './db.ts';
import { HttpError, addDays, daysBetween } from './lib.ts';

/**
 * Nightly pricing. Every night of a stay is priced on its own:
 *   1. start from the room type's base rate;
 *   2. apply the single best-matching rate rule (season, weekend, promotion) — highest
 *      priority wins, then the most specific (dated before undated), then the newest;
 *   3. apply the company's negotiated discount, if the guest is booked on an account.
 * A manager's override replaces all of that with one flat rate.
 * Prices are stored per night, so past nights never change when rules change later.
 */

export interface RateRule {
  id: number;
  name: string;
  room_type_id: number | null;
  start_date: string | null;
  end_date: string | null;
  weekdays: string | null; // "5,6" = Friday & Saturday nights (0 = Sunday)
  kind: 'percent' | 'amount' | 'fixed';
  value: number;
  priority: number;
  active: number;
}

export interface Night {
  date: string;
  rate: number;
  rule: string | null;
}

const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

export function ruleMatches(r: RateRule, typeId: number, date: string) {
  if (!r.active) return false;
  if (r.room_type_id && r.room_type_id !== typeId) return false;
  if (r.start_date && date < r.start_date) return false;
  if (r.end_date && date > r.end_date) return false;
  if (r.weekdays && !r.weekdays.split(',').map(Number).includes(weekday(date))) return false;
  return true;
}

export function applyRule(base: number, r: RateRule) {
  const v = r.kind === 'fixed' ? r.value : r.kind === 'amount' ? base + r.value : Math.round((base * (100 + r.value)) / 100);
  return Math.max(0, Math.round(v));
}

export function priceStay(typeId: number, checkIn: string, checkOut: string, opts: { companyId?: number | null; override?: number | null } = {}) {
  const type = get<{ rate: number; name: string }>('SELECT rate, name FROM room_types WHERE id = ?', typeId);
  if (!type) throw new HttpError(400, 'Unknown room type');
  const n = daysBetween(checkIn, checkOut);
  const rules = all<RateRule>('SELECT * FROM rate_rules WHERE active = 1').sort(
    (a, b) => b.priority - a.priority || Number(!!b.start_date) - Number(!!a.start_date) || b.id - a.id,
  );
  const company = opts.companyId ? get<{ discount_pct: number; name: string }>('SELECT discount_pct, name FROM companies WHERE id = ? AND active = 1', opts.companyId) : undefined;
  if (opts.companyId && !company) throw new HttpError(400, 'That company account is not active');

  const nights: Night[] = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(checkIn, i);
    if (opts.override) {
      nights.push({ date, rate: opts.override, rule: 'Manager rate' });
      continue;
    }
    const rule = rules.find((r) => ruleMatches(r, typeId, date));
    let rate = rule ? applyRule(type.rate, rule) : type.rate;
    if (company?.discount_pct) rate = Math.round((rate * (100 - company.discount_pct)) / 100);
    nights.push({ date, rate, rule: rule?.name ?? null });
  }

  const total = nights.reduce((a, x) => a + x.rate, 0);
  const notes = new Set<string>();
  for (const x of nights) if (x.rule) notes.add(x.rule);
  if (company?.discount_pct && !opts.override) notes.add(`${company.name} −${company.discount_pct}%`);
  return {
    nights,
    total,
    average: n ? Math.round(total / n) : 0,
    base: type.rate,
    note: notes.size ? [...notes].join(' · ') : null,
  };
}

/** Write a stay's nights and keep the reservation's totals in step. */
export function saveNights(reservationId: number, nights: Night[]) {
  for (const x of nights) {
    run('INSERT OR REPLACE INTO reservation_nights (reservation_id, date, rate) VALUES (?,?,?)', reservationId, x.date, x.rate);
  }
  syncTotals(reservationId);
}

export function syncTotals(reservationId: number) {
  const s = get<{ n: number; total: number; first: string; last: string }>(
    'SELECT COUNT(*) n, COALESCE(SUM(rate),0) total, MIN(date) first, MAX(date) last FROM reservation_nights WHERE reservation_id = ?',
    reservationId,
  )!;
  if (!s.n) return;
  run(
    'UPDATE reservations SET nights = ?, total = ?, rate = ?, check_out = ? WHERE id = ?',
    s.n, s.total, Math.round(s.total / s.n), addDays(s.last, 1), reservationId,
  );
}

/** Drop nights on or after a new departure date (early check-out, shortened stay). */
export function trimNights(reservationId: number, checkOut: string) {
  run('DELETE FROM reservation_nights WHERE reservation_id = ? AND date >= ?', reservationId, checkOut);
  syncTotals(reservationId);
}
