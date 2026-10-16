import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { FACILITY_LABELS, type Facility } from '../../../shared/constants';
import { GymScene, LoungeScene, PoolScene, RoomScene } from '../components/illustrations';
import { ErrorBox, Field, Icon, useSubmit } from '../components/kit';
import { addDays, api, fmtDateLong, naira, nightsBetween, todayISO } from '../lib/api';
import { sceneFor, time12, useHotel, type PublicHotel } from '../lib/hotel';

interface RoomType {
  id: number;
  name: string;
  slug: string;
  rate: number;
  capacity: number;
  description: string;
  amenities: string[];
  available: number;
}

const mapEmbed = (address: string) => `https://www.google.com/maps?q=${encodeURIComponent(address)}&z=15&output=embed`;
const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal:not(.in)');
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))), { rootMargin: '0px 0px -8% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  });
}

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`site-nav${scrolled ? ' scrolled' : ''}`}>
      <div className="wrap">
        <Link to="/" className="brand" aria-label="Danest Hotel & Suites — home">
          <img src="/brand/crest-128.png" alt="" width={44} height={44} />
          <span>
            <b>Danest</b>
            <small>Hotel &amp; Suites</small>
          </span>
        </Link>
        <nav aria-label="Main">
          <a href="/#rooms">Rooms</a>
          <a href="/#facilities">Pool, gym &amp; lounge</a>
          <a href="/#visit">Find us</a>
          <Link to="/booking">Manage booking</Link>
        </nav>
        <a href="/#book" className="btn primary">
          Book a room
        </a>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const hotel = useHotel();
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="brand">
          <img src="/brand/crest-128.png" alt="" width={44} height={44} />
          <span>
            <b>{hotel?.name ?? 'Danest Hotel & Suites'}</b>
            <small style={{ color: '#8f8676' }}>{hotel?.tagline}</small>
          </span>
        </div>
        <span>
          {hotel?.address}
          {hotel?.phone && <> · <a href={`tel:${hotel.phone}`}>{hotel.phone}</a></>}
        </span>
        <span className="row" style={{ gap: 18 }}>
          <Link to="/booking">Manage booking</Link>
          <Link to="/staff/login">Staff sign-in</Link>
        </span>
      </div>
    </footer>
  );
}

const DAY = [
  { time: '7:00', title: 'Wake rested', text: 'A comfortable room on a quiet street in Old Bodija.', scene: <RoomScene variant="deluxe" /> },
  { time: '8:30', title: 'A morning swim', text: 'Start the day in the pool before the city gets busy.', scene: <PoolScene /> },
  { time: '17:00', title: 'Work it off', text: 'The gym is downstairs when the meetings are done.', scene: <GymScene /> },
  { time: '20:00', title: 'Evenings at the lounge', text: 'Cold drinks and good music at the lounge & bar.', scene: <LoungeScene /> },
];

const FAC_SCENE: Record<Facility, React.ReactNode> = { pool: <PoolScene />, gym: <GymScene />, lounge: <LoungeScene /> };
const FAC_TEXT: Record<Facility, string> = {
  pool: 'A sunny pool for a morning swim or a lazy afternoon.',
  gym: 'Weights, cardio and space to stretch, a few steps from your room.',
  lounge: 'Cold drinks, good music and space to unwind — or hire it for your event.',
};

function priceTag(h: PublicHotel | null, f: Facility) {
  const items = h?.facility_items.filter((i) => i.facility === f) ?? [];
  if (!items.length) return 'Open to guests and visitors';
  const low = Math.min(...items.map((i) => i.price));
  return items.length === 1 ? `${items[0].name} · ${naira(low)}` : `From ${naira(low)}`;
}

export default function Home() {
  const t = todayISO();
  const [checkIn, setCheckIn] = useState(t);
  const [checkOut, setCheckOut] = useState(addDays(t, 1));
  const [adults, setAdults] = useState(1);
  const [typeId, setTypeId] = useState<number | ''>('');
  const [types, setTypes] = useState<RoomType[]>([]);
  const [moment, setMoment] = useState(0);
  const hotel = useHotel();
  useReveal();

  const validDates = checkOut > checkIn && checkIn >= t;
  useEffect(() => {
    if (!validDates) return;
    api<RoomType[]>(`/public/room-types?check_in=${checkIn}&check_out=${checkOut}`).then(setTypes).catch(() => {});
  }, [checkIn, checkOut, validDates]);

  // The "day at Danest" story advances on its own, and pauses when someone picks a moment.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setMoment((m) => (m + 1) % DAY.length), 5200);
    return () => clearInterval(id);
  }, [paused]);

  const choose = (id: number) => {
    setTypeId(id);
    document.getElementById('book')?.scrollIntoView({ behavior: 'smooth' });
  };
  const setIn = (v: string) => {
    setCheckIn(v);
    if (checkOut <= v) setCheckOut(addDays(v, 1));
  };
  const nights = nightsBetween(checkIn, checkOut);
  const from = types.length ? Math.min(...types.map((r) => r.rate)) : 0;

  return (
    <div className="site">
      <SiteNav />

      <main id="top">
        <section className="hero">
          <div className="hero-glow" aria-hidden="true" />
          <div className="wrap">
            <div className="hero-grid">
              <div className="hero-copy">
                <span className="eyebrow">Old Bodija · Ibadan</span>
                <h1 className="display">
                  Rest easy in the heart of <em>Bodija.</em>
                </h1>
                <p className="lede">Comfortable rooms and a warm Ibadan welcome — with a swimming pool, a gym and a lounge &amp; bar on site. Book directly with us.</p>
                <div className="row" style={{ gap: 12, marginTop: 28 }}>
                  <a href="#book" className="btn gold lg">Check availability</a>
                  {from > 0 && <span className="muted" style={{ fontSize: 15 }}>Rooms from <b style={{ color: 'var(--ink)' }}>{naira(from)}</b> a night</span>}
                </div>
              </div>
              <div className="hero-art">
                <picture>
                  <source type="image/webp" srcSet="/brand/building-900.webp 900w, /brand/building-1600.webp 1600w" sizes="(max-width: 900px) 100vw, 55vw" />
                  <img src="/brand/building-1600.png" alt="The Danest Hotel & Suites building: a stone-clad hotel behind a cream wall and black gate, with palm trees." width={1600} height={740} fetchPriority="high" />
                </picture>
                <img className="crest" src="/brand/crest-512.png" alt="" width={116} height={116} />
                {hotel?.highlights[0] && <div className="hero-chip c1" aria-hidden="true"><Icon name="check" size={14} /> {hotel.highlights[0].title}</div>}
                <div className="hero-chip c2" aria-hidden="true"><Icon name="wave" size={14} /> Pool, gym &amp; lounge</div>
              </div>
            </div>

            <form
              className="booker"
              aria-label="Check availability"
              onSubmit={(e) => {
                e.preventDefault();
                document.getElementById(typeId ? 'book' : 'rooms')?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              <Field label="Check-in">
                <input className="input" type="date" value={checkIn} min={t} onChange={(e) => setIn(e.target.value)} required />
              </Field>
              <Field label="Check-out">
                <input className="input" type="date" value={checkOut} min={addDays(checkIn, 1)} onChange={(e) => setCheckOut(e.target.value)} required />
              </Field>
              <Field label="Guests">
                <select className="input" value={adults} onChange={(e) => setAdults(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>{n} {n === 1 ? 'adult' : 'adults'}</option>
                  ))}
                </select>
              </Field>
              <Field label="Room">
                <select className="input" value={typeId} onChange={(e) => setTypeId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Any room</option>
                  {types.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </Field>
              <button className="btn gold lg">See rooms</button>
            </form>

            {!!hotel?.highlights.length && (
            <ul className="promises">
              {hotel.highlights.map(({ title, text }) => (
                <li key={title} className="reveal">
                  <Icon name="check" size={20} />
                  <span>
                    <b>{title}</b>
                    {text}
                  </span>
                </li>
              ))}
            </ul>
            )}
          </div>
        </section>

        <section className="section" id="rooms">
          <div className="wrap">
            <div className="section-head reveal">
              <div>
                <span className="eyebrow">Rooms &amp; suites</span>
                <h2 className="display">Four ways to stay, one standard of care.</h2>
              </div>
              <p>
                {validDates && types.length > 0 && <>Prices for <b>{nights} night{nights > 1 ? 's' : ''}</b> from {fmtDateLong(checkIn)}, with live availability.</>}
              </p>
            </div>
            <div className="rooms">
              {types.map((r, i) => {
                const tooSmall = adults > r.capacity;
                return (
                  <article className="room-card reveal" key={r.id} style={{ transitionDelay: `${i * 70}ms` }}>
                    <div className="swatch">
                      <RoomScene variant={sceneFor(r.name)} title={`Illustration of the ${r.name}`} />
                    </div>
                    <h3>{r.name}</h3>
                    <p className="muted" style={{ fontSize: 14 }}>{r.description}</p>
                    <ul>
                      {r.amenities.slice(0, 4).map((a) => <li key={a}>{a}</li>)}
                      <li>Sleeps {r.capacity}</li>
                    </ul>
                    <div className="price">
                      <b>{naira(r.rate)}</b> / night
                      {nights > 1 && <div className="muted" style={{ fontSize: 13 }}>{naira(r.rate * nights)} for {nights} nights</div>}
                    </div>
                    <div>
                      {r.available === 0 ? (
                        <span className="badge red">Fully booked for these dates</span>
                      ) : r.available <= 2 ? (
                        <span className="badge amber">Only {r.available} left for your dates</span>
                      ) : (
                        <span className="badge green">Available</span>
                      )}
                    </div>
                    <button className="btn primary block" disabled={r.available === 0 || tooSmall} onClick={() => choose(r.id)}>
                      {tooSmall ? `Sleeps up to ${r.capacity}` : 'Choose this room'}
                    </button>
                  </article>
                );
              })}
              {!hotel && types.length === 0 && Array.from({ length: 4 }, (_, i) => <div key={i} className="room-card skeleton" style={{ height: 520 }} />)}
              {hotel && !hotel.bookable && (
                <div className="room-card" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 40 }}>
                  <h3>Online booking opens soon</h3>
                  <p className="muted">{hotel.phone ? <>Call us on <a href={`tel:${hotel.phone}`}>{hotel.phone}</a> to book a room.</> : 'Please visit or call the front desk to book a room.'}</p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="section facilities" id="facilities">
          <div className="wrap">
            <div className="section-head reveal">
              <div>
                <span className="eyebrow">Pool, gym &amp; lounge</span>
                <h2 className="display">More than a place to sleep.</h2>
              </div>
              <p>Staying with us or just visiting Bodija for the day — the pool, gym and lounge are open to everyone.</p>
            </div>
            <div className="fac-grid">
              {(['pool', 'gym', 'lounge'] as Facility[]).map((k) => ({ scene: FAC_SCENE[k], name: FACILITY_LABELS[k], text: FAC_TEXT[k], tag: priceTag(hotel, k) })).map((f, i) => (
                <article className="fac reveal" key={f.name} style={{ transitionDelay: `${i * 90}ms` }}>
                  <div className="fac-art">{f.scene}</div>
                  <div className="fac-text">
                    <h3>{f.name}</h3>
                    <p>{f.text}</p>
                    <span className="tag">{f.tag}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section day" aria-labelledby="day-title">
          <div className="wrap">
            <div className="section-head reveal">
              <div>
                <span className="eyebrow">A day at Danest</span>
                <h2 className="display" id="day-title">From first light to last song.</h2>
              </div>
              <p>Everything you need for a good stay is inside our gate. Here's how a day can go.</p>
            </div>
            <div className="day-grid reveal">
              <div className="day-stage" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
                {DAY.map((d, i) => (
                  <div key={d.time} className={`day-scene${i === moment ? ' on' : ''}`} aria-hidden={i !== moment}>
                    {d.scene}
                  </div>
                ))}
                <div className="day-progress" key={`${moment}-${paused}`}>
                  <i className={paused ? 'paused' : ''} />
                </div>
              </div>
              <ol className="day-steps">
                {DAY.map((d, i) => (
                  <li key={d.time}>
                    <button aria-current={i === moment} onClick={() => (setMoment(i), setPaused(true))}>
                      <span className="time">{d.time}</span>
                      <span>
                        <b>{d.title}</b>
                        <span className="muted">{d.text}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="section" id="visit" style={{ paddingTop: 40 }}>
          <div className="wrap visit">
            <div className="reveal">
              <span className="eyebrow">Find us</span>
              <h2 className="display" style={{ fontSize: 'clamp(34px, 4.4vw, 56px)', marginTop: 12 }}>
                A quiet street, minutes from everything.
              </h2>
              <dl>
                <div>
                  <dt>Address</dt>
                  <dd>{hotel?.address}</dd>
                </div>
                {hotel && (
                  <div>
                    <dt>Check-in · Check-out</dt>
                    <dd>From {time12(hotel.check_in_time)} · By {time12(hotel.check_out_time)}</dd>
                  </div>
                )}
                {hotel?.phone && (
                  <div>
                    <dt>Front desk</dt>
                    <dd><a href={`tel:${hotel.phone}`}>{hotel.phone}</a>{hotel.whatsapp && <> · <a href={`https://wa.me/${hotel.whatsapp.replace(/\D/g, '').replace(/^0/, '234')}`} target="_blank" rel="noopener noreferrer">WhatsApp</a></>}</dd>
                  </div>
                )}
              </dl>
              {hotel && (
                <a className="btn lg" style={{ marginTop: 28 }} href={mapsUrl(hotel.address)} target="_blank" rel="noopener noreferrer">
                  <Icon name="pin" /> Get directions
                </a>
              )}
            </div>
            <div className="map-card reveal">
              {hotel && <iframe title={`Map showing ${hotel.name}`} src={mapEmbed(hotel.address)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />}
              <div style={{ padding: '16px 24px 22px', display: 'flex', gap: 12, alignItems: 'center', borderTop: '1px solid var(--line)' }}>
                <Icon name="pin" size={22} />
                <div>
                  <b>{hotel?.name}</b>
                  <div className="muted" style={{ fontSize: 14 }}>{hotel?.address}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {hotel?.bookable !== false && <BookingSection types={types} checkIn={checkIn} checkOut={checkOut} adults={adults} typeId={typeId} setCheckIn={setIn} setCheckOut={setCheckOut} setAdults={setAdults} setTypeId={setTypeId} />}

        <section className="section faq" aria-labelledby="faq-title">
          <div className="wrap faq-grid">
            <div className="reveal">
              <span className="eyebrow">Good to know</span>
              <h2 className="display" id="faq-title" style={{ fontSize: 'clamp(30px, 3.6vw, 44px)', marginTop: 12 }}>Questions guests ask us.</h2>
              <p className="muted" style={{ marginTop: 12 }}>
                Already booked? <Link to="/booking">Check your booking</Link> with your reference and phone number.
              </p>
            </div>
            <div className="reveal">
              {([
                ['Do I need to pay when I book?', 'No. Send your request and we confirm it by phone. You pay when you arrive — cash, bank transfer or POS.'],
                ['What do I need at check-in?', "Please bring a valid photo ID: NIN slip or card, international passport, driver's licence or voter's card."],
                hotel && ['What time can I check in and out?', `Check-in is from ${time12(hotel.check_in_time)} and check-out is by ${time12(hotel.check_out_time)}. Ask us about early arrival or late departure.`],
                hotel?.facility_items.some((i) => i.facility !== 'lounge') && ['Can I use the pool or gym without staying?', 'Yes. Passes are sold at the front desk.'],
                ['How do I change or cancel?', `Call the front desk${hotel?.phone ? ` on ${hotel.phone}` : ''} with your booking reference and we will sort it out with you.`],
              ].filter(Boolean) as [string, string][]).map(([q, a]) => (
                <details key={q} className="faq-item">
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function BookingSection(p: {
  types: RoomType[];
  checkIn: string;
  checkOut: string;
  adults: number;
  typeId: number | '';
  setCheckIn: (v: string) => void;
  setCheckOut: (v: string) => void;
  setAdults: (v: number) => void;
  setTypeId: (v: number | '') => void;
}) {
  const t = todayISO();
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '', company: '' });
  const [done, setDone] = useState<{ code: string; total: number; nights: number; room_type: string } | null>(null);
  const { busy, error, submit } = useSubmit();
  const type = p.types.find((x) => x.id === p.typeId);
  const nights = Math.max(0, nightsBetween(p.checkIn, p.checkOut));
  const total = useMemo(() => (type ? type.rate * nights : 0), [type, nights]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      const r = await api('/public/booking-requests', {
        body: { ...form, check_in: p.checkIn, check_out: p.checkOut, adults: p.adults, room_type_id: p.typeId },
      });
      setDone(r);
    });
  };

  return (
    <section className="section book-section" id="book">
      <div className="wrap book-grid">
        <div className="reveal">
          <span className="eyebrow">Book direct</span>
          <h2 className="display" style={{ fontSize: 'clamp(34px, 4.4vw, 56px)', margin: '12px 0 18px' }}>
            Your room, held in two minutes.
          </h2>
          <p className="muted" style={{ fontSize: 17, maxWidth: '40ch' }}>
            No card and no payment needed now. Send your request, our front desk calls you to confirm, and you pay when you arrive.
          </p>
          <ol className="steps">
            <li><span><b>Send your request</b> — takes two minutes.</span></li>
            <li><span><b>We call to confirm</b> — and answer any questions.</span></li>
            <li><span><b>Arrive and settle in</b> — pay by cash, transfer or POS.</span></li>
          </ol>
          {type && (
            <div className="card" style={{ marginTop: 28, padding: '8px 20px' }}>
              <div className="summary-line"><span>{type.name}</span><span>{naira(type.rate)} / night</span></div>
              <div className="summary-line"><span>{fmtDateLong(p.checkIn)} → {fmtDateLong(p.checkOut)}</span><span>{nights} night{nights === 1 ? '' : 's'}</span></div>
              <div className="summary-line"><span>Total, pay on arrival</span><span className="num">{naira(total)}</span></div>
            </div>
          )}
        </div>

        <div className="book-form reveal">
          {done ? (
            <div className="success" role="status">
              <div className="success-mark"><Icon name="check" size={34} /></div>
              <h3 className="display" style={{ fontSize: 28, marginTop: 8 }}>Request received</h3>
              <div className="code">{done.code}</div>
              <p className="muted">
                {done.room_type} · {done.nights} night{done.nights === 1 ? '' : 's'} · {naira(done.total)}
                <br />
                Keep this reference. We'll call <b>{form.phone}</b> shortly to confirm your stay.
              </p>
              <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
                <Link className="btn" to={`/booking?code=${done.code}`}>Check its status</Link>
                <button className="btn ghost" onClick={() => (setDone(null), setForm({ name: '', phone: '', email: '', notes: '', company: '' }))}>
                  Make another booking
                </button>
              </div>
            </div>
          ) : (
            <form className="stack" onSubmit={onSubmit}>
              <div className="grid-2">
                <Field label="Check-in">
                  <input className="input" type="date" value={p.checkIn} min={t} onChange={(e) => p.setCheckIn(e.target.value)} required />
                </Field>
                <Field label="Check-out">
                  <input className="input" type="date" value={p.checkOut} min={addDays(p.checkIn, 1)} onChange={(e) => p.setCheckOut(e.target.value)} required />
                </Field>
              </div>
              <div className="grid-2">
                <Field label="Room">
                  <select className="input" value={p.typeId} onChange={(e) => p.setTypeId(e.target.value ? Number(e.target.value) : '')} required>
                    <option value="">Choose a room…</option>
                    {p.types.map((r) => (
                      <option key={r.id} value={r.id} disabled={r.available === 0}>
                        {r.name} — {naira(r.rate)}{r.available === 0 ? ' (full)' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Guests">
                  <select className="input" value={p.adults} onChange={(e) => p.setAdults(Number(e.target.value))}>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'adult' : 'adults'}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Full name">
                <input className="input" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={120} />
              </Field>
              <div className="grid-2">
                <Field label="Phone number">
                  <input className="input" type="tel" autoComplete="tel" inputMode="tel" placeholder="080…" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required pattern="[+\d][\d\s\-]{6,19}" />
                </Field>
                <Field label="Email (optional)">
                  <input className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={254} />
                </Field>
              </div>
              <Field label="Anything we should know? (optional)">
                <textarea className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} placeholder="Late arrival, airport pickup, a quiet room…" />
              </Field>
              <label className="hp" aria-hidden="true">
                Company
                <input tabIndex={-1} autoComplete="off" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              </label>
              <ErrorBox error={error} />
              <button className="btn gold lg block" disabled={busy || !p.typeId}>
                {busy ? 'Sending…' : type ? `Request booking · ${naira(total)}` : 'Request booking'}
              </button>
              <p className="muted" style={{ fontSize: 13, textAlign: 'center' }}>We only use your details to confirm this booking.</p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
