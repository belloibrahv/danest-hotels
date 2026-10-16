import { Router } from 'express';
import { MESSAGE_TEMPLATES, PAYMENT_METHODS, RATE_RULE_KINDS } from '../../shared/constants.ts';
import { allow, currentUser, rateLimit } from '../auth.ts';
import { assertOpen } from '../days.ts';
import { all, audit, get, run } from '../db.ts';
import { EMAIL_RE, HttpError, PHONE_RE, addDays, bad, body, date, h, int, isDate, oneOf, str, today } from '../lib.ts';
import { deliver, smsEnabled } from '../messaging.ts';
import { initializePayment, paystackEnabled, verifyPayment } from '../paystack.ts';
import { applyRule, ruleMatches, type RateRule } from '../pricing.ts';
import { getSettings } from '../settings.ts';
import { CHARGES_SQL, PAID_SQL, companyBalance } from './reservations.ts';

/** Revenue tools: rate rules, corporate accounts, online payments and guest messages. */
export const commercial = Router();
const manager = allow('manager');
const desk = allow('manager', 'frontdesk');

// ---------- rate rules ----------

function ruleFields(b: Record<string, unknown>) {
  const kind = oneOf(b, 'kind', RATE_RULE_KINDS);
  const value = int(b, 'value', { min: kind === 'fixed' ? 1000 : -1_000_000, max: 5_000_000 });
  if (kind === 'percent' && (value < -90 || value > 300)) throw bad('Percentage must be between −90% and +300%');
  const start = b.start_date ? date(b, 'start_date') : null;
  const end = b.end_date ? date(b, 'end_date') : null;
  if (start && end && end < start) throw bad('The end date is before the start date');
  const days = Array.isArray(b.weekdays) ? [...new Set(b.weekdays.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort() : [];
  const typeId = b.room_type_id ? int(b, 'room_type_id', { min: 1 }) : null;
  if (typeId && !get('SELECT 1 FROM room_types WHERE id = ?', typeId)) throw bad('Unknown room type');
  return {
    name: str(b, 'name', { max: 60 }),
    room_type_id: typeId,
    start_date: start,
    end_date: end,
    weekdays: days.length && days.length < 7 ? days.join(',') : null,
    kind,
    value,
    priority: b.priority === undefined || b.priority === '' ? 0 : int(b, 'priority', { min: 0, max: 100 }),
  };
}

commercial.get(
  '/rate-rules',
  manager,
  h((_req, res) => {
    res.json(all('SELECT r.*, t.name AS room_type FROM rate_rules r LEFT JOIN room_types t ON t.id = r.room_type_id ORDER BY r.active DESC, r.priority DESC, r.id DESC'));
  }),
);

commercial.post(
  '/rate-rules',
  manager,
  h((req, res) => {
    const f = ruleFields(body(req));
    const { id } = run(
      'INSERT INTO rate_rules (name, room_type_id, start_date, end_date, weekdays, kind, value, priority) VALUES (?,?,?,?,?,?,?,?)',
      f.name, f.room_type_id, f.start_date, f.end_date, f.weekdays, f.kind, f.value, f.priority,
    );
    audit(currentUser(req).id, 'create', 'rate_rule', id, f);
    res.status(201).json({ id });
  }),
);

commercial.put(
  '/rate-rules/:id',
  manager,
  h((req, res) => {
    const id = Number(req.params.id);
    const b = body(req);
    const f = ruleFields(b);
    const n = run(
      'UPDATE rate_rules SET name=?, room_type_id=?, start_date=?, end_date=?, weekdays=?, kind=?, value=?, priority=?, active=? WHERE id=?',
      f.name, f.room_type_id, f.start_date, f.end_date, f.weekdays, f.kind, f.value, f.priority, b.active === false ? 0 : 1, id,
    ).changes;
    if (!n) throw new HttpError(404, 'Rule not found');
    audit(currentUser(req).id, 'update', 'rate_rule', id, { ...f, active: b.active !== false });
    res.json({ ok: true });
  }),
);

/** The price grid: what each room type sells for on each of the next N days. */
commercial.get(
  '/rate-calendar',
  manager,
  h((req, res) => {
    const from = isDate(req.query.from) ? req.query.from : today();
    const days = Math.min(Math.max(Number(req.query.days) || 14, 7), 62);
    const types = all<{ id: number; name: string; rate: number }>('SELECT id, name, rate FROM room_types WHERE active = 1 ORDER BY rate');
    const rules = all<RateRule>('SELECT * FROM rate_rules WHERE active = 1').sort(
      (a, b) => b.priority - a.priority || Number(!!b.start_date) - Number(!!a.start_date) || b.id - a.id,
    );
    const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
    res.json({
      from,
      dates,
      types: types.map((t) => ({
        ...t,
        nights: dates.map((d) => {
          const rule = rules.find((r) => ruleMatches(r, t.id, d));
          return { date: d, rate: rule ? applyRule(t.rate, rule) : t.rate, rule: rule?.name ?? null };
        }),
      })),
    });
  }),
);

// ---------- corporate accounts ----------

function companyFields(b: Record<string, unknown>) {
  return {
    name: str(b, 'name', { max: 120 }),
    contact_name: str(b, 'contact_name', { max: 120, optional: true }) || null,
    phone: str(b, 'phone', { max: 20, optional: true, pattern: PHONE_RE }) || null,
    email: str(b, 'email', { max: 254, optional: true, pattern: EMAIL_RE }) || null,
    address: str(b, 'address', { max: 200, optional: true }) || null,
    discount_pct: b.discount_pct === undefined || b.discount_pct === '' ? 0 : int(b, 'discount_pct', { min: 0, max: 90 }),
    credit_limit: b.credit_limit === undefined || b.credit_limit === '' ? 0 : int(b, 'credit_limit', { min: 0, max: 1_000_000_000 }),
    notes: str(b, 'notes', { max: 500, optional: true }) || null,
  };
}

const COMPANY_LIST = `
  SELECT c.*,
    COALESCE((SELECT SUM(p.amount) FROM payments p JOIN reservations r ON r.id = p.reservation_id WHERE p.method = 'company' AND r.company_id = c.id), 0)
      - COALESCE((SELECT SUM(amount) FROM company_payments cp WHERE cp.company_id = c.id), 0) AS balance,
    (SELECT COUNT(*) FROM reservations r WHERE r.company_id = c.id AND r.status IN ('checked_in','checked_out')) AS stays,
    (SELECT COUNT(*) FROM reservations r WHERE r.company_id = c.id AND r.status = 'checked_in') AS in_house
  FROM companies c`;

commercial.get(
  '/companies',
  desk,
  h((req, res) => {
    res.json(all(`${COMPANY_LIST} ${req.query.all === '1' ? '' : 'WHERE c.active = 1'} ORDER BY c.active DESC, c.name`));
  }),
);

commercial.post(
  '/companies',
  manager,
  h((req, res) => {
    const f = companyFields(body(req));
    if (get('SELECT 1 FROM companies WHERE name = ?', f.name)) throw new HttpError(409, 'A company with that name already exists');
    const { id } = run(
      'INSERT INTO companies (name, contact_name, phone, email, address, discount_pct, credit_limit, notes) VALUES (?,?,?,?,?,?,?,?)',
      f.name, f.contact_name, f.phone, f.email, f.address, f.discount_pct, f.credit_limit, f.notes,
    );
    audit(currentUser(req).id, 'create', 'company', id, { name: f.name, discount_pct: f.discount_pct });
    res.status(201).json({ id });
  }),
);

commercial.put(
  '/companies/:id',
  manager,
  h((req, res) => {
    const id = Number(req.params.id);
    const b = body(req);
    const f = companyFields(b);
    if (get('SELECT 1 FROM companies WHERE name = ? AND id <> ?', f.name, id)) throw new HttpError(409, 'A company with that name already exists');
    const n = run(
      'UPDATE companies SET name=?, contact_name=?, phone=?, email=?, address=?, discount_pct=?, credit_limit=?, notes=?, active=? WHERE id=?',
      f.name, f.contact_name, f.phone, f.email, f.address, f.discount_pct, f.credit_limit, f.notes, b.active === false ? 0 : 1, id,
    ).changes;
    if (!n) throw new HttpError(404, 'Company not found');
    audit(currentUser(req).id, 'update', 'company', id, f);
    res.json({ ok: true });
  }),
);

/** A statement: every stay billed to the account and every payment the company made. */
commercial.get(
  '/companies/:id',
  desk,
  h((req, res) => {
    const id = Number(req.params.id);
    const c = get(`${COMPANY_LIST} WHERE c.id = ?`, id);
    if (!c) throw new HttpError(404, 'Company not found');
    const charges = all(
      `SELECT p.id, p.date, p.amount, r.id AS reservation_id, r.code, r.check_in, r.check_out, g.name AS guest_name
         FROM payments p JOIN reservations r ON r.id = p.reservation_id JOIN guests g ON g.id = r.guest_id
        WHERE p.method = 'company' AND r.company_id = ? ORDER BY p.date, p.id`,
      id,
    );
    const payments = all(
      `SELECT cp.id, cp.date, cp.amount, cp.method, cp.reference, u.name AS received_by
         FROM company_payments cp LEFT JOIN users u ON u.id = cp.received_by WHERE cp.company_id = ? ORDER BY cp.date, cp.id`,
      id,
    );
    const stays = all(
      `SELECT r.id, r.code, r.status, r.check_in, r.check_out, g.name AS guest_name, r.bill_to_company,
              r.total + ${CHARGES_SQL} - ${PAID_SQL} AS balance
         FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE r.company_id = ? AND r.status IN ('confirmed','checked_in') ORDER BY r.check_in`,
      id,
    );
    res.json({ ...c, charges, payments, open_stays: stays });
  }),
);

commercial.post(
  '/companies/:id/payments',
  manager,
  h((req, res) => {
    const user = currentUser(req);
    const id = Number(req.params.id);
    const b = body(req);
    if (!get('SELECT 1 FROM companies WHERE id = ?', id)) throw new HttpError(404, 'Company not found');
    const amount = int(b, 'amount', { min: 1, max: 1_000_000_000 });
    const method = oneOf(b, 'method', PAYMENT_METHODS);
    const when = date(b, 'date', today());
    if (when > today()) throw bad('Date cannot be in the future');
    assertOpen(when);
    const owed = companyBalance(id);
    if (amount > owed) throw bad(`That is more than the company owes (₦${owed.toLocaleString('en-NG')})`);
    const ref = str(b, 'reference', { max: 80, optional: true });
    const { id: pid } = run('INSERT INTO company_payments (company_id, amount, method, reference, date, received_by) VALUES (?,?,?,?,?,?)', id, amount, method, ref || null, when, user.id);
    audit(user.id, 'company_payment', 'company', id, { amount, method, payment_id: pid });
    res.status(201).json({ id: pid });
  }),
);

// ---------- guest messages ----------

commercial.get(
  '/messaging/status',
  desk,
  h((_req, res) => {
    res.json({ sms: smsEnabled(), online_payments: paystackEnabled() });
  }),
);

commercial.get(
  '/reservations/:id/messages',
  desk,
  h((req, res) => {
    res.json(
      all(
        `SELECT m.id, m.template, m.channel, m.to_phone, m.body, m.status, m.error, m.created_at, u.name AS sent_by
           FROM messages m LEFT JOIN users u ON u.id = m.created_by WHERE m.reservation_id = ? ORDER BY m.id DESC`,
        Number(req.params.id),
      ),
    );
  }),
);

commercial.post(
  '/reservations/:id/messages',
  desk,
  h(async (req, res) => {
    const user = currentUser(req);
    rateLimit(`msg:${user.id}`, 60, 60 * 60_000);
    const b = body(req);
    const template = oneOf(b, 'template', MESSAGE_TEMPLATES);
    const channel = b.channel === 'sms' ? 'sms' : 'whatsapp';
    const id = Number(req.params.id);
    if (!get('SELECT 1 FROM reservations WHERE id = ?', id)) throw new HttpError(404, 'Reservation not found');
    const out = await deliver(template, id, user.id, channel);
    audit(user.id, 'message', 'reservation', id, { template, channel, status: out.status });
    res.status(201).json(out);
  }),
);

// ---------- online deposits (public) ----------

const siteUrl = (req: { protocol: string; get(name: string): string | undefined }) =>
  process.env.PUBLIC_URL ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `${req.protocol}://${req.get('host')}`);

/** Start paying the deposit for a booking: needs the reference and the phone it was booked with. */
commercial.post(
  '/public/payments/start',
  h(async (req, res) => {
    rateLimit(`pay:${req.ip}`, 10, 60 * 60_000);
    const s = getSettings();
    if (!paystackEnabled() || !s.deposit_percent) throw new HttpError(503, 'Online payment is not available. You can pay when you arrive.');
    const b = body(req);
    const ref = str(b, 'code', { max: 12 }).toUpperCase();
    const phone = str(b, 'phone', { max: 20, pattern: PHONE_RE }).replace(/\D/g, '');
    const email = str(b, 'email', { max: 254, pattern: EMAIL_RE });
    const r = get<{ id: number; status: string; total: number; phone: string; paid: number }>(
      `SELECT r.id, r.status, r.total, g.phone, COALESCE((SELECT SUM(amount) FROM payments p WHERE p.reservation_id = r.id), 0) AS paid
         FROM reservations r JOIN guests g ON g.id = r.guest_id WHERE r.code = ?`,
      ref,
    );
    if (!r || r.phone.replace(/\D/g, '') !== phone) throw new HttpError(404, "We couldn't find a booking with that reference and phone number.");
    if (r.status !== 'pending' && r.status !== 'confirmed') throw new HttpError(409, 'This booking can no longer be paid online');
    const deposit = Math.ceil((r.total * s.deposit_percent) / 100);
    const amount = Math.min(deposit, r.total - r.paid);
    if (amount <= 0) throw new HttpError(409, 'This booking is already paid');
    const { url, reference } = await initializePayment({ reservationId: r.id, amount, email, callbackUrl: `${siteUrl(req)}/booking/paid` });
    res.json({ url, reference, amount });
  }),
);

commercial.get(
  '/public/payments/verify',
  h(async (req, res) => {
    rateLimit(`verify:${req.ip}`, 30, 60 * 60_000);
    const reference = typeof req.query.reference === 'string' ? req.query.reference.slice(0, 60) : '';
    if (!/^[A-Z0-9-]+$/i.test(reference)) throw bad('Missing payment reference');
    const out = await verifyPayment(reference);
    const r = 'reservationId' in out ? get<{ code: string }>('SELECT code FROM reservations WHERE id = ?', out.reservationId) : undefined;
    res.json({ status: out.status, amount: 'amount' in out ? out.amount : undefined, code: r?.code });
  }),
);
