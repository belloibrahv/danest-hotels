import { ArrowRight, BedDouble, Check, CheckCircle2, Clock, CreditCard, Dumbbell, MapPin, Music, Phone, Users, Waves } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { FACILITY_LABELS, type Facility } from '../../../shared/constants';
import { DateInput, Field, SelectField } from '@/components/app/form';
import { ErrorNote, Money } from '@/components/app/page';
import { StatusPill } from '@/components/app/status';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { addDays, api, fmtDateLong, naira, nightsBetween, todayISO } from '@/lib/api';
import { time12, useHotel, type PublicHotel } from '@/lib/hotel';
import { useSubmit } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Eyebrow, SitePage } from './site';

interface RoomType {
  id: number;
  name: string;
  rate: number;
  capacity: number;
  description: string;
  amenities: string[];
  available: number;
  total: number;
  average: number;
  rate_note: string | null;
}

const FAC_ICON: Record<Facility, typeof Waves> = { pool: Waves, gym: Dumbbell, lounge: Music };
const FAC_TEXT: Record<Facility, string> = {
  pool: 'A sunny outdoor pool for a morning swim or a slow afternoon.',
  gym: 'Weights, cardio and room to stretch, steps from your room.',
  lounge: 'Cold drinks and good music — or hire it for your event.',
};
const mapEmbed = (a: string) => `https://www.google.com/maps?q=${encodeURIComponent(a)}&z=15&output=embed`;
const mapsUrl = (a: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}`;

function priceFrom(h: PublicHotel | null, f: Facility) {
  const items = h?.facility_items.filter((i) => i.facility === f) ?? [];
  if (!items.length) return null;
  return Math.min(...items.map((i) => i.price));
}

export default function Home() {
  const t = todayISO();
  const hotel = useHotel();
  const [checkIn, setCheckIn] = useState(t);
  const [checkOut, setCheckOut] = useState(addDays(t, 1));
  const [adults, setAdults] = useState('1');
  const [types, setTypes] = useState<RoomType[] | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const nights = nightsBetween(checkIn, checkOut);

  useEffect(() => {
    if (checkOut <= checkIn) return;
    let live = true;
    api<RoomType[]>(`/public/room-types?check_in=${checkIn}&check_out=${checkOut}`).then((r) => live && setTypes(r), () => live && setTypes([]));
    return () => {
      live = false;
    };
  }, [checkIn, checkOut]);

  const choose = (id: number) => {
    setChosen(id);
    document.getElementById('book')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const from = types?.length ? Math.min(...types.map((r) => r.rate)) : null;
  const setIn = (v: string) => {
    setCheckIn(v);
    if (checkOut <= v) setCheckOut(addDays(v, 1));
  };

  return (
    <SitePage>
      {/* hero */}
      <section className="relative overflow-hidden border-b bg-[linear-gradient(180deg,var(--muted)_0%,var(--background)_100%)]">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-14 pb-10 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:pt-20">
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-700">
            <Eyebrow>Old Bodija · Ibadan</Eyebrow>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">A calm, comfortable stay in the heart of Bodija.</h1>
            <p className="mt-5 max-w-md text-lg text-muted-foreground">Well-kept rooms, a pool, a gym and a lounge &amp; bar inside one gated compound. Book directly with the hotel.</p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button size="lg" asChild>
                <a href="#rooms">
                  See rooms & prices <ArrowRight />
                </a>
              </Button>
              {from !== null && (
                <span className="text-sm text-muted-foreground">
                  From <b className="tabular-nums text-foreground">{naira(from)}</b> a night
                </span>
              )}
            </div>
          </div>
          <div className="relative">
            <div className="absolute inset-x-8 bottom-4 h-24 rounded-[50%] bg-foreground/10 blur-2xl" />
            <picture>
              <source type="image/webp" srcSet="/brand/building-900.webp 900w, /brand/building-1600.webp 1600w" sizes="(max-width: 1024px) 100vw, 55vw" />
              <img src="/brand/building-1600.png" alt={`${hotel?.name ?? 'The hotel'}: a stone-clad building behind a cream wall and black gate, with palm trees`} width={1600} height={740} className="relative w-full" fetchPriority="high" />
            </picture>
          </div>
        </div>

        {/* availability bar */}
        <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
          <Card className="gap-0 py-0 shadow-lg">
            <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_0.7fr_auto] lg:items-end">
              <Field label="Check-in"><DateInput value={checkIn} min={t} onChange={setIn} /></Field>
              <Field label="Check-out"><DateInput value={checkOut} min={addDays(checkIn, 1)} onChange={setCheckOut} /></Field>
              <Field label="Guests"><SelectField value={adults} onChange={setAdults} options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n} adult${n > 1 ? 's' : ''}` }))} /></Field>
              <Button size="lg" asChild className="sm:col-span-2 lg:col-span-1">
                <a href="#rooms">Check availability</a>
              </Button>
            </CardContent>
          </Card>
          {!!hotel?.highlights.length && (
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {hotel.highlights.map((h) => (
                <li key={h.title} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" />
                  <span>
                    <span className="block text-sm font-medium">{h.title}</span>
                    {h.text && <span className="block text-sm text-muted-foreground">{h.text}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* rooms */}
      <section id="rooms" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Rooms & suites</Eyebrow>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Choose your room</h2>
          </div>
          {nights > 0 && (
            <p className="text-sm text-muted-foreground">
              Prices for <b className="text-foreground">{nights} night{nights > 1 ? 's' : ''}</b> from {fmtDateLong(checkIn)}, with live availability.
            </p>
          )}
        </div>
        {types === null ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-80 rounded-xl" />)}</div>
        ) : hotel && !hotel.bookable ? (
          <Card className="py-12 text-center shadow-xs">
            <CardContent>
              <h3 className="text-lg font-semibold">Online booking opens soon</h3>
              <p className="mt-2 text-muted-foreground">{hotel.phone ? <>Call <a className="font-medium text-foreground underline" href={`tel:${hotel.phone}`}>{hotel.phone}</a> to book a room.</> : 'Please contact the front desk to book.'}</p>
            </CardContent>
          </Card>
        ) : (
          <div className={cn('grid gap-4 md:grid-cols-2', types.length === 4 ? 'xl:grid-cols-4' : 'lg:grid-cols-3')}>
            {types.map((r) => {
              const tooSmall = Number(adults) > r.capacity;
              const full = r.available === 0;
              return (
                <Card key={r.id} className={cn('gap-0 overflow-hidden py-0 shadow-xs transition-shadow hover:shadow-md', chosen === r.id && 'ring-2 ring-brand')}>
                  <CardContent className="flex h-full flex-col p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex size-10 items-center justify-center rounded-lg border bg-muted/50"><BedDouble className="size-5" /></div>
                      {full ? <StatusPill tone="danger">Fully booked</StatusPill> : r.available <= 2 ? <StatusPill tone="warning">{r.available} left</StatusPill> : <StatusPill tone="success">Available</StatusPill>}
                    </div>
                    <h3 className="mt-5 text-lg font-semibold">{r.name}</h3>
                    {r.description && <p className="mt-1.5 text-sm text-muted-foreground">{r.description}</p>}
                    <ul className="mt-4 grid gap-1.5 text-sm">
                      {r.amenities.slice(0, 5).map((a) => (
                        <li key={a} className="flex items-center gap-2"><Check className="size-3.5 text-brand" /> {a}</li>
                      ))}
                      <li className="flex items-center gap-2"><Users className="size-3.5 text-brand" /> Sleeps {r.capacity}</li>
                    </ul>
                    <div className="mt-auto pt-6">
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm text-muted-foreground">{nights > 1 ? `${nights} nights` : 'Per night'}</span>
                        <span className="text-2xl font-semibold tabular-nums">{naira(nights > 0 ? r.total : r.rate)}</span>
                      </div>
                      {r.rate_note && <p className="mt-0.5 text-right text-xs text-brand-ink">Includes {r.rate_note.toLowerCase()} pricing</p>}
                      <Button className="mt-4 w-full" variant={chosen === r.id ? 'default' : 'outline'} disabled={full || tooSmall} onClick={() => choose(r.id)}>
                        {tooSmall ? `Sleeps up to ${r.capacity}` : full ? 'Not available' : 'Select'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* facilities */}
      <section id="facilities" className="scroll-mt-20 border-y bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Eyebrow>Facilities</Eyebrow>
          <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight">Everything for a good stay, inside the gate.</h2>
          <p className="mt-3 max-w-xl text-muted-foreground">Open to hotel guests and to visitors from around Bodija.</p>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {(['pool', 'gym', 'lounge'] as Facility[]).map((f) => {
              const I = FAC_ICON[f];
              const low = priceFrom(hotel, f);
              return (
                <Card key={f} className="gap-0 py-0 shadow-xs">
                  <CardContent className="p-6">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-brand-soft text-brand-ink"><I className="size-5" /></div>
                    <h3 className="mt-5 font-semibold">{FACILITY_LABELS[f]}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground">{FAC_TEXT[f]}</p>
                    <p className="mt-4 text-sm font-medium">{low !== null ? <>From <span className="font-mono">{naira(low)}</span></> : 'Ask at the front desk'}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* booking */}
      {hotel?.bookable !== false && <Booking types={types ?? []} hotel={hotel} chosen={chosen} setChosen={setChosen} checkIn={checkIn} checkOut={checkOut} adults={adults} setCheckIn={setIn} setCheckOut={setCheckOut} setAdults={setAdults} />}

      {/* location */}
      <section id="location" className="scroll-mt-20 border-t">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div>
            <Eyebrow>Location</Eyebrow>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">On a quiet street off Old Bodija Road.</h2>
            <dl className="mt-8 grid gap-6 text-sm">
              <div className="flex gap-3"><MapPin className="mt-0.5 size-5 text-muted-foreground" /><div><dt className="font-medium">Address</dt><dd className="text-muted-foreground">{hotel?.address}</dd></div></div>
              {hotel && <div className="flex gap-3"><Clock className="mt-0.5 size-5 text-muted-foreground" /><div><dt className="font-medium">Check-in · check-out</dt><dd className="text-muted-foreground">From {time12(hotel.check_in_time)} · by {time12(hotel.check_out_time)}</dd></div></div>}
              {hotel?.phone && <div className="flex gap-3"><Phone className="mt-0.5 size-5 text-muted-foreground" /><div><dt className="font-medium">Front desk</dt><dd><a className="text-muted-foreground hover:text-foreground" href={`tel:${hotel.phone}`}>{hotel.phone}</a>{hotel.whatsapp && <> · <a className="text-muted-foreground hover:text-foreground" href={`https://wa.me/${hotel.whatsapp.replace(/\D/g, '').replace(/^0/, '234')}`} target="_blank" rel="noopener noreferrer">WhatsApp</a></>}</dd></div></div>}
            </dl>
            {hotel && (
              <Button variant="outline" className="mt-8" asChild>
                <a href={mapsUrl(hotel.address)} target="_blank" rel="noopener noreferrer"><MapPin /> Get directions</a>
              </Button>
            )}
          </div>
          <div className="overflow-hidden rounded-xl border bg-muted shadow-xs">
            {hotel && <iframe title={`Map of ${hotel.name}`} src={mapEmbed(hotel.address)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" className="h-96 w-full" />}
          </div>
        </div>
      </section>

      {/* faq */}
      <section className="border-t bg-muted/40">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.5fr]">
          <div>
            <Eyebrow>Good to know</Eyebrow>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Questions guests ask</h2>
            <p className="mt-3 text-muted-foreground">Already booked? <Link to="/booking" className="font-medium text-foreground underline underline-offset-4">Check your booking</Link>.</p>
          </div>
          <Accordion type="single" collapsible className="w-full">
            {(
              [
                ['Do I need to pay when I book?', hotel?.online_payments ? 'You can pay a deposit online by card or transfer to confirm straight away, or send a request and pay when you arrive.' : 'No. Send your request and we confirm by phone. You pay when you arrive — cash, transfer or POS.'],
                ['What do I need at check-in?', "A valid photo ID: NIN slip or card, international passport, driver's licence or voter's card."],
                hotel && ['What time is check-in and check-out?', `Check-in is from ${time12(hotel.check_in_time)}; check-out is by ${time12(hotel.check_out_time)}. Ask us about early arrival or late departure.`],
                hotel?.facility_items.some((i) => i.facility !== 'lounge') && ['Can I use the pool or gym without staying?', 'Yes — passes are sold at the front desk.'],
                ['How do I change or cancel?', `Call the front desk${hotel?.phone ? ` on ${hotel.phone}` : ''} with your booking reference.`],
              ].filter(Boolean) as [string, string][]
            ).map(([q, a], i) => (
              <AccordionItem key={q} value={`q${i}`}>
                <AccordionTrigger className="text-base">{q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>
    </SitePage>
  );
}

function Booking(p: {
  types: RoomType[];
  hotel: PublicHotel | null;
  chosen: number | null;
  setChosen: (id: number | null) => void;
  checkIn: string;
  checkOut: string;
  adults: string;
  setCheckIn: (v: string) => void;
  setCheckOut: (v: string) => void;
  setAdults: (v: string) => void;
}) {
  const t = todayISO();
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '', company: '' });
  const [done, setDone] = useState<{ code: string; total: number; nights: number; room_type: string; deposit: number } | null>(null);
  const { busy, error, submit } = useSubmit();
  const pay = useSubmit();
  const type = p.types.find((x) => x.id === p.chosen);
  const nights = Math.max(0, nightsBetween(p.checkIn, p.checkOut));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      setDone(await api('/public/booking-requests', { body: { ...form, check_in: p.checkIn, check_out: p.checkOut, adults: Number(p.adults), room_type_id: p.chosen } }));
    });
  };
  const payNow = () =>
    pay.submit(async () => {
      const r = await api<{ url: string }>('/public/payments/start', { body: { code: done!.code, phone: form.phone, email: form.email } });
      window.location.href = r.url;
    });

  return (
    <section id="book" className="scroll-mt-20 border-t">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <Eyebrow>Book direct</Eyebrow>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Reserve in two minutes.</h2>
          <p className="mt-3 max-w-md text-muted-foreground">
            {p.hotel?.online_payments ? 'Pay a deposit online to confirm instantly, or send a request and pay on arrival.' : 'No payment needed now. We call to confirm, and you pay when you arrive — cash, transfer or POS.'}
          </p>
          <ol className="mt-8 space-y-4">
            {['Choose your dates and room', p.hotel?.online_payments ? 'Pay a deposit, or send a request' : 'Send your details', 'Arrive, show your ID, and settle in'].map((s, i) => (
              <li key={s} className="flex items-center gap-3 text-sm">
                <span className="flex size-7 items-center justify-center rounded-full border text-xs font-semibold">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
          {type && (
            <Card className="mt-8 gap-0 py-0 shadow-xs">
              <CardContent className="space-y-2 p-5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Room</span><span className="font-medium">{type.name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Dates</span><span>{fmtDateLong(p.checkIn)} → {fmtDateLong(p.checkOut)}</span></div>
                <div className="flex justify-between border-t pt-2 font-semibold"><span>{nights} night{nights === 1 ? '' : 's'}</span><Money value={type.total} /></div>
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="gap-0 py-0 shadow-sm">
          <CardContent className="p-6">
            {done ? (
              <div className="py-6 text-center">
                <CheckCircle2 className="mx-auto size-12 text-success" />
                <h3 className="mt-4 text-xl font-semibold">Request received</h3>
                <p className="mt-1 text-sm text-muted-foreground">Your booking reference</p>
                <p className="mt-2 font-mono text-3xl font-semibold tracking-wider">{done.code}</p>
                <p className="mt-4 text-sm text-muted-foreground">
                  {done.room_type} · {done.nights} night{done.nights === 1 ? '' : 's'} · {naira(done.total)}
                </p>
                {done.deposit > 0 ? (
                  <div className="mx-auto mt-6 max-w-sm space-y-3 rounded-lg border bg-muted/40 p-4 text-left">
                    <p className="text-sm">Pay a <b>{naira(done.deposit)}</b> deposit now to confirm instantly.</p>
                    {!form.email && <Input type="email" placeholder="Email for your receipt" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
                    <ErrorNote error={pay.error} />
                    <Button className="w-full" disabled={pay.busy || !form.email} onClick={payNow}><CreditCard /> {pay.busy ? 'Opening Paystack…' : `Pay ${naira(done.deposit)}`}</Button>
                    <p className="text-xs text-muted-foreground">Or pay on arrival — we'll call {form.phone} to confirm.</p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">We'll call <b className="text-foreground">{form.phone}</b> shortly to confirm.</p>
                )}
                <div className="mt-6 flex justify-center gap-2">
                  <Button variant="outline" asChild><Link to={`/booking?code=${done.code}`}>Check status</Link></Button>
                  <Button variant="ghost" onClick={() => (setDone(null), setForm({ name: '', phone: '', email: '', notes: '', company: '' }), p.setChosen(null))}>New booking</Button>
                </div>
              </div>
            ) : (
              <form className="grid gap-4" onSubmit={onSubmit}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Check-in"><DateInput value={p.checkIn} min={t} onChange={p.setCheckIn} /></Field>
                  <Field label="Check-out"><DateInput value={p.checkOut} min={addDays(p.checkIn, 1)} onChange={p.setCheckOut} /></Field>
                  <Field label="Room">
                    <SelectField value={p.chosen ? String(p.chosen) : ''} onChange={(v) => p.setChosen(Number(v))} placeholder="Choose a room" options={p.types.map((r) => ({ value: String(r.id), label: `${r.name} — ${naira(r.total)}`, disabled: r.available === 0 }))} />
                  </Field>
                  <Field label="Guests"><SelectField value={p.adults} onChange={p.setAdults} options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n} adult${n > 1 ? 's' : ''}` }))} /></Field>
                </div>
                <Field label="Full name"><Input autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={120} /></Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Phone"><Input type="tel" autoComplete="tel" inputMode="tel" placeholder="080…" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required pattern="[+\d][\d\s\-]{6,19}" /></Field>
                  <Field label={p.hotel?.online_payments ? 'Email (for your receipt)' : 'Email (optional)'}><Input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={254} /></Field>
                </div>
                <Field label="Anything we should know?"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} rows={3} placeholder="Late arrival, airport pickup, a quiet room…" /></Field>
                <label className="absolute -left-[10000px] h-px w-px overflow-hidden" aria-hidden="true">
                  Company <input tabIndex={-1} autoComplete="off" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
                </label>
                <ErrorNote error={error} />
                <Button size="lg" disabled={busy || !p.chosen}>{busy ? 'Sending…' : type ? `Request booking · ${naira(type.total)}` : 'Choose a room above'}</Button>
                <p className="text-center text-xs text-muted-foreground">We only use your details to manage this booking.</p>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
