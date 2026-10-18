import { todayISO } from './api';

/** 'YYYY-MM' → 'October 2026' (or 'Oct 26' when short). */
export const fmtMonth = (m: string, short = false) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', short ? { month: 'short', year: '2-digit', timeZone: 'UTC' } : { month: 'long', year: 'numeric', timeZone: 'UTC' });

export const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7);
};

/** This month and the eleven before it, newest first. */
export const recentMonths = (n = 12) => Array.from({ length: n }, (_, i) => shiftMonth(todayISO().slice(0, 7), -i));
