import { naira } from './api';

/** One row of the activity log, in plain words. Shared by Team, Audit and the live feeds. */
export interface A { id: number; action: string; entity: string; entity_id: number | null; detail: string | null; created_at: string; user: string | null }

export const ACTION: Record<string, string> = {
  login: 'signed in', login_failed: 'failed sign-in', create: 'created', update: 'updated', delete: 'deleted', confirm: 'confirmed', cancel: 'cancelled',
  check_in: 'checked in', check_out: 'checked out', check_out_with_balance: 'checked out with balance owed', payment: 'took a payment on', room_status: 'changed status of',
  stock_adjust: 'adjusted stock of', rate_change: 'changed rate of', booking_request: 'website booking', password_change: 'changed password', setup_owner: 'set up the hotel',
  mfa_enabled: 'turned on two-step sign-in', mfa_disabled: 'turned off two-step sign-in', mfa_failed: 'entered a wrong code', login_recovery_code: 'used a recovery code',
  sessions_revoked: 'signed out other devices', session_revoked: 'signed out a device', room_charge: 'charged to room', change_dates: 'changed dates of', room_move: 'moved room for',
  no_show: 'marked no-show', close_day: 'closed the day', close_day_with_variance: 'closed the day with a cash difference', reopen_day: 'reopened a closed day', resolve: 'resolved',
  bill_to_company: 'billed to company', company_payment: 'received company payment', set_company: 'changed company on', online_payment: 'online payment received', online_payment_mismatch: 'online payment amount mismatch',
  message: 'messaged guest on', seed: 'loaded demo data',
  order: 'ordered stock:', receive: 'received delivery', pay_supplier: 'paid supplier bill', import: 'uploaded stock file', photo: 'added a photo to', photo_removed: 'removed the photo from',
  set_targets: 'set targets for', raise: 'raised audit query', answer: 'answered audit query', close: 'closed', follow_up: 'followed up audit query', export: 'exported', void: 'voided',
  refund: 'refunded', late_departure: 'late departure', sale: 'sold',
};
export const RED = /failed|mismatch|delete|disabled|variance|reopen|with_balance/;

export function describe(a: A) {
  let d: Record<string, unknown> = {};
  try {
    d = a.detail ? JSON.parse(a.detail) : {};
  } catch {
    /* ignore */
  }
  const bits: string[] = [];
  for (const k of ['amount', 'balance', 'total', 'variance'] as const) if (typeof d[k] === 'number') bits.push(`${k === 'balance' ? 'owed ' : ''}${naira(d[k] as number)}`);
  for (const k of ['reason', 'company', 'username', 'status', 'name', 'room', 'date', 'supplier', 'month', 'items', 'receipt_no'] as const) if (typeof d[k] === 'string') bits.push(String(d[k]));
  if (typeof d.change === 'number') bits.push(`${d.change > 0 ? '+' : ''}${d.change}`);
  return bits.join(' · ');
}
