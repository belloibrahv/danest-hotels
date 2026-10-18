import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { audit, get, run, tx } from './db.ts';
import { lastClosedDate } from './days.ts';
import { HttpError, addDays, today } from './lib.ts';
import { availabilityByType } from './routes/reservations.ts';

/**
 * Paystack (hosted checkout). The browser never sees the secret key: the server starts a
 * transaction, sends the guest to Paystack's own page, and only records money after asking
 * Paystack directly (verify) or receiving a signed webhook. A payment reference is recorded
 * once, whichever of those arrives first.
 */

const secret = () => process.env.PAYSTACK_SECRET_KEY ?? '';
const base = () => process.env.PAYSTACK_BASE_URL ?? 'https://api.paystack.co';
export const paystackEnabled = () => !!secret();

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(base() + path, {
    method: init?.method ?? 'GET',
    headers: { authorization: `Bearer ${secret()}`, 'content-type': 'application/json' },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T };
  if (!res.ok || !data.status) throw new HttpError(502, `Paystack: ${data.message ?? 'could not reach the payment provider'}`);
  return data.data as T;
}

export async function initializePayment(opts: { reservationId: number; amount: number; email: string; callbackUrl: string }) {
  if (!paystackEnabled()) throw new HttpError(503, 'Online payment is not set up');
  const reference = `DH-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`.toUpperCase();
  const data = await call<{ authorization_url: string; reference: string }>('/transaction/initialize', {
    method: 'POST',
    body: {
      email: opts.email,
      amount: opts.amount * 100, // kobo
      currency: 'NGN',
      reference,
      callback_url: opts.callbackUrl,
      metadata: { reservation_id: opts.reservationId },
    },
  });
  run("INSERT INTO online_payments (reference, reservation_id, amount, status) VALUES (?,?,?, 'initialized')", reference, opts.reservationId, opts.amount);
  return { reference, url: data.authorization_url };
}

/** Money received on a closed day is booked on the first open day, so the locked books stay locked. */
const bookingDate = () => {
  const closed = lastClosedDate();
  const t = today();
  return closed && t <= closed ? addDays(closed, 1) : t;
};

/** Record a successful payment exactly once. Returns the reservation it belongs to. */
export function recordSuccess(reference: string, amountKobo: number, raw: unknown) {
  const out = tx(() => {
    const op = get<{ reservation_id: number; amount: number; status: string }>('SELECT reservation_id, amount, status FROM online_payments WHERE reference = ?', reference);
    if (!op) throw new HttpError(404, 'Unknown payment reference');
    if (op.status === 'success') return { reservationId: op.reservation_id, amount: op.amount, duplicate: true };
    // Never trust an amount we didn't ask for.
    if (amountKobo !== op.amount * 100) {
      // Saved as failed (not rolled back) so the attempt stays on record, then refused below.
      run("UPDATE online_payments SET status = 'failed', gateway_response = ?, verified_at = datetime('now') WHERE reference = ?", `amount mismatch: got ${amountKobo} kobo`, reference);
      audit(null, 'online_payment_mismatch', 'reservation', op.reservation_id, { reference, expected: op.amount * 100, got: amountKobo });
      return null;
    }
    run("UPDATE online_payments SET status = 'success', gateway_response = ?, verified_at = datetime('now') WHERE reference = ?", JSON.stringify(raw).slice(0, 2000), reference);
    run("INSERT INTO payments (reservation_id, amount, method, reference, date) VALUES (?,?, 'online', ?, ?)", op.reservation_id, op.amount, reference, bookingDate());
    // A paid deposit turns a website request into a confirmed booking, if a room is still free.
    // Otherwise the money is kept on the request and the front desk decides (it stays pending).
    const r = get<{ status: string; room_type_id: number; check_in: string; check_out: string }>(
      'SELECT status, room_type_id, check_in, check_out FROM reservations WHERE id = ?',
      op.reservation_id,
    )!;
    const roomFree = (availabilityByType(r.check_in, r.check_out, op.reservation_id).get(r.room_type_id) ?? 0) > 0;
    if (r.status === 'pending' && roomFree) run("UPDATE reservations SET status = 'confirmed' WHERE id = ?", op.reservation_id);
    audit(null, 'online_payment', 'reservation', op.reservation_id, { amount: op.amount, reference, ...(r.status === 'pending' && !roomFree && { left_pending: 'no room free' }) });
    return { reservationId: op.reservation_id, amount: op.amount, duplicate: false };
  });
  if (!out) throw new HttpError(409, 'Payment amount does not match');
  return out;
}

export async function verifyPayment(reference: string) {
  const op = get<{ status: string }>('SELECT status FROM online_payments WHERE reference = ?', reference);
  if (!op) throw new HttpError(404, 'Unknown payment reference');
  const data = await call<{ status: string; amount: number; reference: string; gateway_response?: string }>(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (data.status === 'success') return { ...recordSuccess(reference, data.amount, data), status: 'success' as const };
  if (data.status === 'failed' || data.status === 'abandoned') {
    run("UPDATE online_payments SET status = 'failed', gateway_response = ?, verified_at = datetime('now') WHERE reference = ? AND status <> 'success'", data.gateway_response ?? data.status, reference);
  }
  return { status: data.status };
}

/** Webhooks are only believed if Paystack signed them with our secret key. */
export function validSignature(rawBody: Buffer, signature: string | undefined) {
  if (!signature || !paystackEnabled()) return false;
  const expected = createHmac('sha512', secret()).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
