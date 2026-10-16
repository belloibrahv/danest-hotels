import { get } from './db.ts';
import { HttpError } from './lib.ts';

/**
 * Closed days are locked: once the manager closes a day, no money can be recorded on or
 * before it. That stops quiet back-dating after the cash has been counted.
 */
export function lastClosedDate(): string | null {
  return get<{ d: string | null }>('SELECT MAX(date) d FROM day_closures')?.d ?? null;
}

export function assertOpen(date: string) {
  const closed = lastClosedDate();
  if (closed && date <= closed) {
    throw new HttpError(409, `The books are closed up to ${closed}. Ask the manager to reopen that day first.`);
  }
}
