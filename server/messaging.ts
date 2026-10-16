import type { MessageTemplate } from '../shared/constants.ts';
import { get, run } from './db.ts';
import { HttpError } from './lib.ts';
import { getSettings } from './settings.ts';

/**
 * Guest messages. With an SMS provider configured (Termii, the common choice in Nigeria)
 * messages are sent from the server. Without one, the message is prepared and staff send it
 * on WhatsApp with one tap — the system never pretends something was sent when it wasn't.
 */

export const smsEnabled = () => !!process.env.TERMII_API_KEY && !!process.env.TERMII_SENDER_ID;

/** 0803 123 4567 → 2348031234567 */
export function intlPhone(phone: string) {
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('234')) return d;
  if (d.startsWith('0')) return `234${d.slice(1)}`;
  return d;
}

const ngn = (n: number) => `₦${Math.round(n).toLocaleString('en-NG')}`;
const longDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const time12 = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
};

export function compose(template: MessageTemplate, reservationId: number) {
  const r = get<{
    code: string; check_in: string; check_out: string; nights: number; total: number; guest_name: string; guest_phone: string;
    room_type: string; paid: number; charges: number;
  }>(
    `SELECT r.code, r.check_in, r.check_out, r.nights, r.total, g.name AS guest_name, g.phone AS guest_phone, t.name AS room_type,
            COALESCE((SELECT SUM(amount) FROM payments p WHERE p.reservation_id = r.id), 0) AS paid,
            COALESCE((SELECT SUM(total) FROM sales s WHERE s.reservation_id = r.id), 0) + COALESCE((SELECT SUM(amount) FROM facility_income f WHERE f.reservation_id = r.id), 0) AS charges
       FROM reservations r JOIN guests g ON g.id = r.guest_id JOIN room_types t ON t.id = r.room_type_id WHERE r.id = ?`,
    reservationId,
  );
  if (!r) throw new HttpError(404, 'Reservation not found');
  const h = getSettings();
  const first = r.guest_name.split(' ')[0];
  const contact = h.phone ? ` Questions? Call ${h.phone}.` : '';
  const balance = r.total + r.charges - r.paid;
  const stay = `${r.room_type}, ${longDate(r.check_in)} to ${longDate(r.check_out)} (${r.nights} night${r.nights > 1 ? 's' : ''})`;
  const body: Record<MessageTemplate, string> = {
    booking_received: `Hello ${first}, thank you for choosing ${h.name}. We have your request for a ${stay}. Ref ${r.code}. We will call you shortly to confirm.${contact}`,
    booking_confirmed: `Hello ${first}, your stay at ${h.name} is confirmed: ${stay}. Total ${ngn(r.total)}${r.paid ? `, paid ${ngn(r.paid)}` : ''}. Ref ${r.code}. Check-in from ${time12(h.check_in_time)}. Please bring a valid photo ID.${contact}`,
    pre_arrival: `Hello ${first}, we look forward to welcoming you to ${h.name} tomorrow. Check-in from ${time12(h.check_in_time)}. Address: ${h.address}. Ref ${r.code}.${contact}`,
    balance_due: `Hello ${first}, a gentle reminder that ${ngn(Math.max(0, balance))} is outstanding on your ${h.name} bill (ref ${r.code}).${h.bank_details ? ` Transfer to: ${h.bank_details}.` : ''}${contact}`,
    thank_you: `Thank you for staying at ${h.name}, ${first}. We hope to see you again soon. ${h.tagline ? `${h.tagline}.` : ''}`.trim(),
  };
  return { to: intlPhone(r.guest_phone), text: body[template] };
}

async function sendSms(to: string, text: string) {
  const res = await fetch(process.env.TERMII_BASE_URL ?? 'https://api.ng.termii.com/api/sms/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to, from: process.env.TERMII_SENDER_ID, sms: text, type: 'plain', channel: 'generic', api_key: process.env.TERMII_API_KEY }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { message_id?: string; message?: string };
  if (!res.ok || !data.message_id) throw new Error(data.message ?? `SMS provider returned ${res.status}`);
  return data.message_id;
}

/** Sends (SMS) or prepares (WhatsApp) a message, and keeps a record either way. */
export async function deliver(template: MessageTemplate, reservationId: number, userId: number | null, channel: 'sms' | 'whatsapp') {
  const { to, text } = compose(template, reservationId);
  if (channel === 'sms' && smsEnabled()) {
    try {
      const ref = await sendSms(to, text);
      run("INSERT INTO messages (reservation_id, template, channel, to_phone, body, status, provider_ref, created_by) VALUES (?,?, 'sms', ?, ?, 'sent', ?, ?)", reservationId, template, to, text, ref, userId);
      return { status: 'sent' as const, text };
    } catch (e) {
      run("INSERT INTO messages (reservation_id, template, channel, to_phone, body, status, error, created_by) VALUES (?,?, 'sms', ?, ?, 'failed', ?, ?)", reservationId, template, to, text, (e as Error).message.slice(0, 300), userId);
      return { status: 'failed' as const, text, error: (e as Error).message };
    }
  }
  run("INSERT INTO messages (reservation_id, template, channel, to_phone, body, status, created_by) VALUES (?,?, 'whatsapp', ?, ?, 'manual', ?)", reservationId, template, to, text, userId);
  return { status: 'manual' as const, text, link: `https://wa.me/${to}?text=${encodeURIComponent(text)}` };
}
