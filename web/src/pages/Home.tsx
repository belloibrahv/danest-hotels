import {
  ArrowRight,
  BadgeCheck,
  BedDouble,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Dumbbell,
  MapPin,
  MessageCircle,
  Music,
  PartyPopper,
  Phone,
  Quote,
  Receipt,
  Search,
  ShieldCheck,
  Users,
  Waves,
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FACILITY_LABELS, type Facility } from '../../../shared/constants';
import { DateInput, Field, SelectField } from '@/components/app/form';
import { ErrorNote, Money } from '@/components/app/page';
import { StatusPill } from '@/components/app/status';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { addDays, api, fmtDateLong, naira, nightsBetween, todayISO } from '@/lib/api';
import { photoUrl, time12, useHotel, type Photo, type PublicHotel } from '@/lib/hotel';
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
  images: Photo[];
}

const FAC_ICON: Record<Facility, typeof Waves> = { pool: Waves, gym: Dumbbell, lounge: Music };
const FAC_TEXT: Record<Facility, string> = {
  pool: 'A sunny outdoor pool for a morning swim or a slow afternoon in the shade.',
  gym: 'Weights, cardio and room to stretch, a few steps from your room.',
  lounge: 'Cold drinks, good music and space to unwind, or hire it for your event.',
};
const mapEmbed = (a: string) => `https://www.google.com/maps?q=${encodeURIComponent(a)}&z=15&output=embed`;
const mapsUrl = (a: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}`;
const waUrl = (n: string, text = '') => `https://wa.me/${n.replace(/\D/g, '').replace(/^0/, '234')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

function priceFrom(h: PublicHotel | null, f: Facility) {
  const items = h?.facility_items.filter((i) => i.facility === f) ?? [];
  if (!items.length) return null;
  return Math.min(...items.map((i) => i.price));
}

/** Section heading in the website's voice: serif headline, small caps eyebrow. */
function Heading({ eyebrow, title, children, center }: { eyebrow: string; title: ReactNode; children?: ReactNode; center?: boolean }) {
  return (
    <div className={cn('max-w-2xl', center && 'mx-auto text-center')}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-balance sm:text-4xl">{title}</h2>
      {children && <p className="mt-4 text-base text-pretty text-muted-foreground sm:text-lg">{children}</p>}
    </div>
  );
}

/** A photo, or until the hotel uploads one, a deliberate placeholder in the brand's colours. */
function Picture({ photo, label, icon: Icon = BedDouble, className, eager }: { photo?: Photo | null; label: string; icon?: typeof BedDouble; className?: string; eager?: boolean }) {
  if (photo) return <img src={photoUrl(photo)} alt={photo.alt || label} loading={eager ? 'eager' : 'lazy'} className={cn('size-full object-cover', className)} />;
  return (
    <div className={cn('relative flex size-full items-center justify-center overflow-hidden bg-[radial-gradient(120%_90%_at_20%_10%,var(--brand-soft),var(--muted)_70%)]', className)} role="img" aria-label={label}>
      <div className="absolute inset-0 opacity-[0.07] [background-image:repeating-linear-gradient(45deg,currentColor_0_1px,transparent_1px_14px)]" aria-hidden />
      <Icon className="size-10 text-brand-ink/60" strokeWidth={1.25} aria-hidden />
    </div>
  );
}

export default function Home() {
  const t = todayISO();
  const hotel = useHotel();
  const [checkIn, setCheckIn] = useState(t);
  const [checkOut, setCheckOut] = useState(addDays(t, 1));
  const [adults, setAdults] = useState('1');
  const [types, setTypes] = useState<RoomType[] | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [viewing, setViewing] = useState<{ photos: Photo[]; index: number; title: string } | null>(null);
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
  const cheapest = types?.length ? types.reduce((a, r) => (r.rate < a.rate ? r : a)).id : null;
  const roomiest = types && types.length > 1 ? types.reduce((a, r) => (r.capacity > a.capacity ? r : a)).id : null;
  const contact = hotel?.whatsapp ? { href: waUrl(hotel.whatsapp, `Hello ${hotel.name}, I'd like to ask about a room.`), label: 'WhatsApp us', icon: MessageCircle } : hotel?.phone ? { href: `tel:${hotel.phone}`, label: `Call ${hotel.phone}`, icon: Phone } : null;
  const hero = hotel?.images.hero;

  const search = (
    <Card className="gap-0 py-0 shadow-xl ring-1 ring-black/5">
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_0.8fr_auto] lg:items-end">
        <Field label="Check-in"><DateInput value={checkIn} min={t} onChange={setIn} /></Field>
        <Field label="Check-out"><DateInput value={checkOut} min={addDays(checkIn, 1)} onChange={setCheckOut} /></Field>
        <Field label="Guests"><SelectField value={adults} onChange={setAdults} options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n} adult${n > 1 ? 's' : ''}` }))} /></Field>
        <Button size="lg" asChild className="sm:col-span-2 lg:col-span-1">
          <a href="#rooms"><Search /> See rooms & prices</a>
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <SitePage>
      {/* ---------- hero ---------- */}
      {hero ? (
        <section className="relative isolate overflow-hidden">
          <Picture photo={hero} label={`${hotel?.name ?? 'The hotel'}`} className="absolute inset-0 -z-10" eager />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/75 via-black/45 to-black/10" aria-hidden />
          <div className="mx-auto max-w-6xl px-4 pt-20 pb-10 sm:px-6 lg:pt-32">
            <div className="max-w-xl text-white animate-in fade-in slide-in-from-bottom-2 duration-700">
              <p className="text-xs font-semibold tracking-[0.18em] text-white/80 uppercase">Old Bodija · Ibadan</p>
              <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-6xl">Rest easy in the heart of Bodija.</h1>
              <p className="mt-5 text-lg text-white/85">Comfortable rooms and suites, a pool, a gym and a lounge, all inside one gated compound. Book directly with the hotel.</p>
              <HeroActions from={from} contact={contact} dark />
            </div>
            <div className="mt-12 lg:mt-20">{search}</div>
          </div>
        </section>
      ) : (
        <section className="relative overflow-hidden bg-[linear-gradient(180deg,var(--brand-soft)_0%,var(--background)_85%)]">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-14 pb-10 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:pt-20">
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-700">
              <Eyebrow>Old Bodija · Ibadan</Eyebrow>
              <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl lg:text-6xl">Rest easy in the heart of Bodija.</h1>
              <p className="mt-5 max-w-md text-lg text-muted-foreground">Comfortable rooms and suites, a pool, a gym and a lounge, all inside one gated compound. Book directly with the hotel.</p>
              <HeroActions from={from} contact={contact} />
            </div>
            <div className="relative">
              <div className="absolute inset-x-8 bottom-4 h-24 rounded-[50%] bg-foreground/10 blur-2xl" />
              <picture>
                <source type="image/webp" srcSet="/brand/building-900.webp 900w, /brand/building-1600.webp 1600w" sizes="(max-width: 1024px) 100vw, 55vw" />
                <img src="/brand/building-1600.png" alt={`${hotel?.name ?? 'The hotel'}: a stone-clad building behind a cream wall and black gate, with palm trees`} width={1600} height={740} className="relative w-full" fetchPriority="high" />
              </picture>
            </div>
          </div>
          <div className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">{search}</div>
        </section>
      )}

      {/* the hotel's own everyday promises */}
      {!!hotel?.highlights.length && (
        <section className="border-b">
          <ul className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            {hotel.highlights.map((h) => (
              <li key={h.title} className="flex gap-3">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" />
                <span>
                  <span className="block text-sm font-semibold">{h.title}</span>
                  {h.text && <span className="block text-sm text-muted-foreground">{h.text}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------- rooms ---------- */}
      <section id="rooms" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 lg:py-24">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <Heading eyebrow="Rooms & suites" title="A room for every kind of stay.">
            From a calm room for a business night to a suite with space for the family. Prices are live for your dates.
          </Heading>
          {nights > 0 && (
            <p className="text-sm text-muted-foreground">
              Showing <b className="text-foreground">{nights} night{nights > 1 ? 's' : ''}</b> from {fmtDateLong(checkIn)}
            </p>
          )}
        </div>
        {types === null ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[30rem] rounded-2xl" />)}</div>
        ) : hotel && !hotel.bookable ? (
          <Card className="py-12 text-center shadow-xs">
            <CardContent>
              <h3 className="font-display text-2xl font-medium">Online booking opens soon</h3>
              <p className="mt-2 text-muted-foreground">{hotel.phone ? <>Call <a className="font-medium text-foreground underline" href={`tel:${hotel.phone}`}>{hotel.phone}</a> to book a room.</> : 'Please contact the front desk to book.'}</p>
            </CardContent>
          </Card>
        ) : (
          <div className={cn('grid gap-6 md:grid-cols-2', types.length === 4 ? 'xl:grid-cols-4' : 'lg:grid-cols-3')}>
            {types.map((r) => (
              <RoomCard
                key={r.id}
                r={r}
                nights={nights}
                adults={Number(adults)}
                chosen={chosen === r.id}
                badge={r.id === cheapest ? 'Best value' : r.id === roomiest ? 'Most space' : null}
                onChoose={() => choose(r.id)}
                onPhotos={(index) => setViewing({ photos: r.images, index, title: r.name })}
              />
            ))}
          </div>
        )}
      </section>

      {/* ---------- why book direct ---------- */}
      <section className="border-y bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Heading eyebrow="Book direct" title="Book with the hotel, not a middleman." center>
            The best way to stay with us is to deal with us.
          </Heading>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: BadgeCheck, title: 'Our own prices', text: 'You book with the hotel itself: no booking-site fees or mark-ups added on top.' },
              hotel?.online_payments
                ? { icon: CreditCard, title: 'Pay how you like', text: 'Pay a deposit online to confirm straight away, or reserve now and pay when you arrive.' }
                : { icon: CreditCard, title: 'No card needed', text: 'Reserve now and pay when you arrive: cash, bank transfer or POS.' },
              { icon: Receipt, title: 'Your booking, any time', text: 'A booking reference straight away, and you can check your booking online whenever you like.' },
              contact
                ? { icon: contact.icon, title: 'A real person to talk to', text: hotel?.whatsapp ? 'Questions before you book? Message the front desk on WhatsApp.' : 'Questions before you book? Call the front desk.' }
                : { icon: ShieldCheck, title: 'Your details stay private', text: 'We only use your details to look after your booking.' },
            ].map((b) => (
              <div key={b.title} className="rounded-2xl border bg-card p-6 shadow-xs">
                <span className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand-ink"><b.icon className="size-5" /></span>
                <h3 className="mt-5 font-semibold">{b.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{b.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- gallery ---------- */}
      {!!hotel?.images.gallery.length && (
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Heading eyebrow="Take a look around" title="See it before you arrive." />
          <div className="mt-10 grid auto-rows-[10rem] grid-cols-2 gap-3 sm:auto-rows-[12rem] md:grid-cols-4">
            {hotel.images.gallery.slice(0, 8).map((p, i) => (
              <button
                key={p.id}
                onClick={() => setViewing({ photos: hotel.images.gallery, index: i, title: 'Gallery' })}
                className={cn('group overflow-hidden rounded-xl bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', i === 0 && 'col-span-2 row-span-2')}
                aria-label={`Open photo ${i + 1}${p.alt ? `: ${p.alt}` : ''}`}
              >
                <Picture photo={p} label="Photo of the hotel" className="transition-transform duration-500 group-hover:scale-105" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---------- facilities ---------- */}
      <section id="facilities" className="scroll-mt-20 border-t">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <Heading eyebrow="Pool, gym & lounge" title="Everything for a good stay, inside the gate.">
              For hotel guests, and open to visitors from around Bodija with a day pass.
            </Heading>
            {contact && (
              <Button variant="outline" asChild>
                <a href={hotel?.whatsapp ? waUrl(hotel.whatsapp, 'Hello, I would like to ask about a day pass.') : contact.href} target="_blank" rel="noopener noreferrer"><contact.icon /> Ask about day passes</a>
              </Button>
            )}
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {(['pool', 'gym', 'lounge'] as Facility[]).map((f) => {
              const low = priceFrom(hotel, f);
              return (
                <article key={f} className="group relative isolate flex min-h-[22rem] flex-col justify-end overflow-hidden rounded-2xl border bg-muted">
                  <Picture photo={hotel?.images.facilities[f]} label={FACILITY_LABELS[f]} icon={FAC_ICON[f]} className="absolute inset-0 -z-10 transition-transform duration-500 group-hover:scale-105" />
                  <div className={cn('absolute inset-0 -z-10', hotel?.images.facilities[f] ? 'bg-gradient-to-t from-black/80 via-black/30 to-transparent' : 'bg-gradient-to-t from-background via-background/70 to-transparent')} aria-hidden />
                  <div className={cn('p-6', hotel?.images.facilities[f] && 'text-white')}>
                    <h3 className="font-display text-2xl font-medium">{FACILITY_LABELS[f]}</h3>
                    <p className={cn('mt-2 text-sm', hotel?.images.facilities[f] ? 'text-white/85' : 'text-muted-foreground')}>{FAC_TEXT[f]}</p>
                    {low !== null && <p className="mt-4 text-sm font-semibold">Visitors from <span className="tabular-nums">{naira(low)}</span></p>}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------- reviews (only real ones, entered by the hotel) ---------- */}
      {!!hotel?.reviews.length && (
        <section id="reviews" className="scroll-mt-20 border-t bg-muted/40">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <Heading eyebrow="Guests say" title="In our guests' own words." center />
            <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {hotel.reviews.map((r) => (
                <figure key={r.quote} className="flex flex-col rounded-2xl border bg-card p-6 shadow-xs">
                  <Quote className="size-6 text-brand" aria-hidden />
                  <blockquote className="mt-4 flex-1 font-display text-lg leading-relaxed">“{r.quote}”</blockquote>
                  <figcaption className="mt-6 border-t pt-4 text-sm">
                    <span className="font-semibold">{r.name}</span>
                    {r.detail && <span className="text-muted-foreground"> · {r.detail}</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---------- events & business ---------- */}
      <section className="border-t">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-20 sm:px-6 md:grid-cols-2">
          {[
            { icon: PartyPopper, title: 'Planning a celebration or a meeting?', text: 'Birthdays, small receptions and team get-togethers: hire the lounge, with drinks from our bar.', ask: 'Hello, I would like to ask about hiring the lounge for an event.' },
            { icon: Briefcase, title: 'Travelling for work?', text: 'Company accounts with agreed rates and one monthly bill for all your staff stays.', ask: 'Hello, I would like to ask about a company account.' },
          ].map((c) => (
            <div key={c.title} className="flex flex-col rounded-2xl bg-foreground p-8 text-background dark:border dark:bg-card dark:text-card-foreground">
              <c.icon className="size-7 text-brand" />
              <h3 className="mt-6 font-display text-2xl font-medium">{c.title}</h3>
              <p className="mt-2 max-w-md text-background/75 dark:text-muted-foreground">{c.text}</p>
              {(hotel?.whatsapp || hotel?.phone || hotel?.email) && (
                <div className="mt-auto pt-6">
                  <Button variant="secondary" asChild>
                    <a href={hotel.whatsapp ? waUrl(hotel.whatsapp, c.ask) : hotel.phone ? `tel:${hotel.phone}` : `mailto:${hotel.email}`} target="_blank" rel="noopener noreferrer">
                      Talk to us <ArrowRight />
                    </a>
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ---------- booking ---------- */}
      {hotel?.bookable !== false && <Booking types={types ?? []} hotel={hotel} chosen={chosen} setChosen={setChosen} checkIn={checkIn} checkOut={checkOut} adults={adults} setCheckIn={setIn} setCheckOut={setCheckOut} setAdults={setAdults} />}

      {/* ---------- location ---------- */}
      <section id="location" className="scroll-mt-20 border-t">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div>
            <Heading eyebrow="Location" title="On a quiet street off Old Bodija Road." />
            <dl className="mt-8 grid gap-6 text-sm">
              <div className="flex gap-3"><MapPin className="mt-0.5 size-5 text-muted-foreground" /><div><dt className="font-medium">Address</dt><dd className="text-muted-foreground">{hotel?.address}</dd></div></div>
              {hotel && <div className="flex gap-3"><Clock className="mt-0.5 size-5 text-muted-foreground" /><div><dt className="font-medium">Check-in · check-out</dt><dd className="text-muted-foreground">From {time12(hotel.check_in_time)} · by {time12(hotel.check_out_time)}</dd></div></div>}
              {hotel?.phone && <div className="flex gap-3"><Phone className="mt-0.5 size-5 text-muted-foreground" /><div><dt className="font-medium">Front desk</dt><dd><a className="text-muted-foreground hover:text-foreground" href={`tel:${hotel.phone}`}>{hotel.phone}</a>{hotel.whatsapp && <> · <a className="text-muted-foreground hover:text-foreground" href={waUrl(hotel.whatsapp)} target="_blank" rel="noopener noreferrer">WhatsApp</a></>}</dd></div></div>}
            </dl>
            {hotel && (
              <Button variant="outline" className="mt-8" asChild>
                <a href={mapsUrl(hotel.address)} target="_blank" rel="noopener noreferrer"><MapPin /> Get directions</a>
              </Button>
            )}
          </div>
          <div className="overflow-hidden rounded-2xl border bg-muted shadow-xs">
            {hotel && <iframe title={`Map of ${hotel.name}`} src={mapEmbed(hotel.address)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" className="h-96 w-full" />}
          </div>
        </div>
      </section>

      {/* ---------- faq ---------- */}
      <section className="border-t bg-muted/40">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.5fr]">
          <div>
            <Heading eyebrow="Good to know" title="Questions guests ask" />
            <p className="mt-4 text-muted-foreground">Already booked? <Link to="/booking" className="font-medium text-foreground underline underline-offset-4">Check your booking</Link>.</p>
          </div>
          <Accordion type="single" collapsible className="w-full">
            {(
              [
                ['Do I need to pay when I book?', hotel?.online_payments ? 'You can pay a deposit online by card or transfer to confirm straight away, or send a request and pay when you arrive.' : 'No. Send your request and we confirm by phone. You pay when you arrive: cash, transfer or POS.'],
                ['What do I need at check-in?', "A valid photo ID: NIN slip or card, international passport, driver's licence or voter's card."],
                hotel && ['What time is check-in and check-out?', `Check-in is from ${time12(hotel.check_in_time)}; check-out is by ${time12(hotel.check_out_time)}. Ask us about early arrival or late departure.`],
                hotel?.facility_items.some((i) => i.facility !== 'lounge') && ['Can I use the pool or gym without staying?', 'Yes. Day passes are sold at the front desk.'],
                ['Do you have rates for companies?', 'Yes. Companies can open an account with agreed rates and pay for staff stays on one monthly bill. Ask the front desk.'],
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

      {/* ---------- closing call to action ---------- */}
      <section className="border-t bg-foreground text-background dark:bg-card dark:text-card-foreground">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-4 py-16 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">Your room is waiting.</h2>
            <p className="mt-2 text-background/70 dark:text-muted-foreground">{from !== null ? `Rooms from ${naira(from)} a night, booked directly with ${hotel?.name ?? 'the hotel'}.` : `Book directly with ${hotel?.name ?? 'the hotel'}.`}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" variant="secondary" asChild><a href="#rooms">Check availability <ArrowRight /></a></Button>
            {contact && (
              <Button size="lg" variant="outline" className="border-background/30 bg-transparent text-background hover:bg-background/10 hover:text-background dark:border-border dark:text-foreground dark:hover:bg-muted" asChild>
                <a href={contact.href} target="_blank" rel="noopener noreferrer"><contact.icon /> {contact.label}</a>
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* On a phone, booking is always one tap away. */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        <span className="text-sm">{from !== null ? <>From <b className="tabular-nums">{naira(from)}</b> a night</> : hotel?.name}</span>
        <Button asChild><a href="#rooms">Book a room</a></Button>
      </div>
      <div className="h-16 md:hidden" aria-hidden />

      <PhotoViewer viewing={viewing} onClose={() => setViewing(null)} />
    </SitePage>
  );
}

function HeroActions({ from, contact, dark }: { from: number | null; contact: { href: string; label: string; icon: typeof Phone } | null; dark?: boolean }) {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      <Button size="lg" asChild className={dark ? 'bg-brand text-brand-foreground hover:bg-brand/90' : ''}>
        <a href="#rooms">Check availability <ArrowRight /></a>
      </Button>
      {contact && (
        <Button size="lg" variant="outline" asChild className={dark ? 'border-white/40 bg-white/10 text-white backdrop-blur hover:bg-white/20 hover:text-white' : ''}>
          <a href={contact.href} target="_blank" rel="noopener noreferrer"><contact.icon /> {contact.label}</a>
        </Button>
      )}
      {from !== null && (
        <span className={cn('w-full text-sm', dark ? 'text-white/80' : 'text-muted-foreground')}>
          Rooms from <b className={cn('tabular-nums', dark ? 'text-white' : 'text-foreground')}>{naira(from)}</b> a night
        </span>
      )}
    </div>
  );
}

function RoomCard({ r, nights, adults, chosen, badge, onChoose, onPhotos }: { r: RoomType; nights: number; adults: number; chosen: boolean; badge: string | null; onChoose: () => void; onPhotos: (index: number) => void }) {
  const [i, setI] = useState(0);
  const tooSmall = adults > r.capacity;
  const full = r.available === 0;
  const photos = r.images;
  return (
    <Card className={cn('group gap-0 overflow-hidden rounded-2xl py-0 shadow-xs transition-shadow hover:shadow-lg', chosen && 'ring-2 ring-brand')}>
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        {photos.length ? (
          <button className="size-full" onClick={() => onPhotos(i)} aria-label={`See photos of the ${r.name}`}>
            <Picture photo={photos[i]} label={r.name} className="transition-transform duration-500 group-hover:scale-105" />
          </button>
        ) : (
          <Picture label={r.name} />
        )}
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          {badge && <span className="rounded-full bg-background/95 px-2.5 py-1 text-xs font-semibold shadow-sm">{badge}</span>}
        </div>
        <div className="absolute top-3 right-3">
          {full ? <StatusPill tone="danger" className="shadow-sm">Fully booked</StatusPill> : r.available <= 2 ? <StatusPill tone="warning" className="shadow-sm">Only {r.available} left</StatusPill> : null}
        </div>
        {photos.length > 1 && (
          <>
            <button className="absolute top-1/2 left-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100" onClick={() => setI((i - 1 + photos.length) % photos.length)} aria-label="Previous photo"><ChevronLeft className="size-4" /></button>
            <button className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100" onClick={() => setI((i + 1) % photos.length)} aria-label="Next photo"><ChevronRight className="size-4" /></button>
            <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1" aria-hidden>
              {photos.map((p, j) => <span key={p.id} className={cn('size-1.5 rounded-full', j === i ? 'bg-white' : 'bg-white/50')} />)}
            </div>
          </>
        )}
      </div>
      <CardContent className="flex flex-1 flex-col p-6">
        <h3 className="font-display text-xl font-medium">{r.name}</h3>
        {r.description && <p className="mt-1.5 line-clamp-3 text-sm text-muted-foreground">{r.description}</p>}
        <ul className="mt-4 flex flex-wrap gap-1.5 text-xs">
          <li className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1"><Users className="size-3" /> Sleeps {r.capacity}</li>
          {r.amenities.slice(0, 4).map((a) => (
            <li key={a} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1"><Check className="size-3 text-brand" /> {a}</li>
          ))}
        </ul>
        <div className="mt-auto pt-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-2xl font-semibold tabular-nums">{naira(nights > 0 ? r.average : r.rate)}</div>
              <div className="text-xs text-muted-foreground">a night{nights > 1 ? ` · ${naira(r.total)} for ${nights} nights` : ''}</div>
            </div>
            {r.rate_note && <span className="text-right text-xs text-brand-ink">{r.rate_note} pricing</span>}
          </div>
          <Button className="mt-4 w-full" size="lg" variant={chosen ? 'default' : 'outline'} disabled={full || tooSmall} onClick={onChoose}>
            {tooSmall ? `Sleeps up to ${r.capacity}` : full ? 'Not available for these dates' : chosen ? 'Selected' : 'Book this room'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PhotoViewer({ viewing, onClose }: { viewing: { photos: Photo[]; index: number; title: string } | null; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [key, setKey] = useState<typeof viewing>(null);
  if (key !== viewing) (setKey(viewing), setI(viewing?.index ?? 0));
  if (!viewing) return null;
  const n = viewing.photos.length;
  const p = viewing.photos[i];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-5xl gap-0 overflow-hidden border-0 bg-black p-0 sm:max-w-5xl"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setI((i + 1) % n);
          if (e.key === 'ArrowLeft') setI((i - 1 + n) % n);
        }}
      >
        <DialogTitle className="sr-only">{viewing.title}: photo {i + 1} of {n}</DialogTitle>
        <img src={photoUrl(p)} alt={p.alt || viewing.title} className="max-h-[80vh] w-full object-contain" />
        {n > 1 && (
          <div className="flex items-center justify-between bg-black px-3 py-2 text-sm text-white">
            <Button size="icon" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setI((i - 1 + n) % n)} aria-label="Previous photo"><ChevronLeft /></Button>
            <span className="tabular-nums">{viewing.title} · {i + 1} / {n}</span>
            <Button size="icon" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setI((i + 1) % n)} aria-label="Next photo"><ChevronRight /></Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
    <section id="book" className="scroll-mt-20 border-t bg-muted/40">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <Eyebrow>Book direct</Eyebrow>
          <h2 className="mt-3 font-display text-3xl font-medium tracking-tight sm:text-4xl">Reserve in two minutes.</h2>
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
