import { CalendarCheck, CreditCard, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Field } from '@/components/app/form';
import { ErrorNote, Money } from '@/components/app/page';
import { StatusPill, type Tone } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, fmtDateLong, naira } from '@/lib/api';
import { time12, useHotel } from '@/lib/hotel';
import { useSubmit } from '@/lib/hooks';
import { Eyebrow, SitePage } from './site';

interface Booking {
  code: string;
  status: 'pending' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';
  check_in: string;
  check_out: string;
  nights: number;
  room_type: string;
  total: number;
  paid: number;
  first_name: string;
}
const STATUS: Record<Booking['status'], { title: string; text: string; tone: Tone }> = {
  pending: { title: 'Request received', text: "We'll call you to confirm. Nothing to pay until you arrive.", tone: 'brand' },
  confirmed: { title: 'Confirmed', text: 'We look forward to welcoming you. Please bring a valid photo ID.', tone: 'success' },
  checked_in: { title: 'Checked in', text: 'Welcome. The front desk is here for anything you need.', tone: 'info' },
  checked_out: { title: 'Completed', text: 'Thank you for staying with us.', tone: 'neutral' },
  cancelled: { title: 'Cancelled', text: 'If that is a surprise, please call the front desk.', tone: 'danger' },
};

/** Guest self-service: find a booking with its reference and the phone used. */
export default function ManageBooking() {
  const [params] = useSearchParams();
  const hotel = useHotel();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [b, setB] = useState<Booking | null>(null);
  const { busy, error, submit } = useSubmit();
  const pay = useSubmit();
  const s = b ? STATUS[b.status] : null;
  const owed = b ? Math.max(0, b.total - b.paid) : 0;

  return (
    <SitePage>
      <div className="mx-auto grid max-w-5xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1fr]">
        <div>
          <Eyebrow>Manage booking</Eyebrow>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">{b ? `Hello, ${b.first_name}.` : 'Find your booking.'}</h1>
          <p className="mt-3 text-muted-foreground">{b ? 'Here are the details of your stay.' : 'Enter the reference we gave you (it starts with “DH-”) and the phone number you booked with.'}</p>
          {b && hotel?.phone && (
            <p className="mt-6 text-sm text-muted-foreground">
              To change dates or cancel, call <a href={`tel:${hotel.phone}`} className="font-medium text-foreground underline">{hotel.phone}</a> and quote <span className="font-mono">{b.code}</span>.
            </p>
          )}
        </div>
        <Card className="gap-0 py-0 shadow-sm">
          <CardContent className="p-6">
            {!b ? (
              <form className="grid gap-4" onSubmit={(e: FormEvent) => (e.preventDefault(), submit(async () => setB(await api<Booking>('/public/booking-lookup', { body: { code, phone } }))))}>
                <Field label="Booking reference"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DH-XXXXXX" required maxLength={12} className="font-mono uppercase" /></Field>
                <Field label="Phone number"><Input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required pattern="[+\d][\d\s\-]{6,19}" /></Field>
                <ErrorNote error={error} />
                <Button size="lg" disabled={busy}><Search /> {busy ? 'Looking…' : 'Find my booking'}</Button>
              </form>
            ) : (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <StatusPill tone={s!.tone}>{s!.title}</StatusPill>
                    <p className="mt-2 text-sm text-muted-foreground">{s!.text}</p>
                  </div>
                  <CalendarCheck className="size-6 text-muted-foreground" />
                </div>
                <dl className="divide-y rounded-lg border text-sm">
                  {[
                    ['Reference', <span className="font-mono">{b.code}</span>],
                    ['Room', b.room_type],
                    ['Arrive', `${fmtDateLong(b.check_in)}${hotel ? `, from ${time12(hotel.check_in_time)}` : ''}`],
                    ['Leave', `${fmtDateLong(b.check_out)}${hotel ? `, by ${time12(hotel.check_out_time)}` : ''}`],
                    [`${b.nights} night${b.nights > 1 ? 's' : ''}`, <Money value={b.total} />],
                    ...(b.paid > 0 ? [['Paid so far', <Money value={b.paid} className="text-success" />]] : []),
                    ['To pay', <Money value={owed} className="font-semibold" />],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="flex justify-between gap-4 px-4 py-2.5">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="text-right">{v}</dd>
                    </div>
                  ))}
                </dl>
                {hotel?.online_payments && owed > 0 && (b.status === 'pending' || b.status === 'confirmed') && (
                  <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
                    <p className="text-sm font-medium">Pay your deposit online</p>
                    <Input type="email" placeholder="Email for your receipt" value={email} onChange={(e) => setEmail(e.target.value)} />
                    <ErrorNote error={pay.error} />
                    <Button className="w-full" disabled={pay.busy || !email} onClick={() => pay.submit(async () => { window.location.href = (await api<{ url: string }>('/public/payments/start', { body: { code: b.code, phone, email } })).url; })}>
                      <CreditCard /> {pay.busy ? 'Opening Paystack…' : 'Pay with Paystack'}
                    </Button>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" asChild><Link to="/">Back to the hotel</Link></Button>
                  <Button variant="ghost" onClick={() => (setB(null), setPhone(''))}>Look up another</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </SitePage>
  );
}
