import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { HOTEL } from '../../../shared/constants';
import { ErrorBox, Field, Icon, useSubmit } from '../components/ui';
import { addDays, api, fmtDateLong, naira, nightsBetween, todayISO } from '../lib/api';

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

const SWATCH: Record<string, string> = {
  standard: 'linear-gradient(135deg, #f4ead3, #e9d6ad)',
  deluxe: 'linear-gradient(135deg, #efe2c4, #d9b874)',
  executive: 'linear-gradient(135deg, #3a332a, #17140f)',
  royal: 'linear-gradient(135deg, #b8862b, #6f4c0e)',
};

const MAP_EMBED = `https://www.google.com/maps?q=${encodeURIComponent('Beckley Street, Old Bodija, Ibadan')}&z=15&output=embed`;
const MAPS_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('4 Beckley Street, Old Bodija, Ibadan')}`;

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal');
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))), { rootMargin: '0px 0px -10% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

export default function Home() {
  const t = todayISO();
  const [checkIn, setCheckIn] = useState(t);
  const [checkOut, setCheckOut] = useState(addDays(t, 1));
  const [adults, setAdults] = useState(1);
  const [typeId, setTypeId] = useState<number | ''>('');
  const [types, setTypes] = useState<RoomType[]>([]);
  const [scrolled, setScrolled] = useState(false);
  useReveal();

  const validDates = checkOut > checkIn && checkIn >= t;
  useEffect(() => {
    if (!validDates) return;
    api<RoomType[]>(`/public/room-types?check_in=${checkIn}&check_out=${checkOut}`).then(setTypes).catch(() => {});
  }, [checkIn, checkOut, validDates]);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  const choose = (id: number) => {
    setTypeId(id);
    document.getElementById('book')?.scrollIntoView({ behavior: 'smooth' });
  };

  const setIn = (v: string) => {
    setCheckIn(v);
    if (checkOut <= v) setCheckOut(addDays(v, 1));
  };

  return (
    <div className="site">
      <header className={`site-nav${scrolled ? ' scrolled' : ''}`}>
        <div className="wrap">
          <a href="#top" className="brand" aria-label="Danest Hotel & Suites — home">
            <img src="/brand/crest-128.png" alt="" width={44} height={44} />
            <span>
              <b>Danest</b>
              <small>Hotel &amp; Suites</small>
            </span>
          </a>
          <nav aria-label="Main">
            <a href="#rooms">Rooms</a>
            <a href="#facilities">Pool, gym &amp; lounge</a>
            <a href="#visit">Find us</a>
          </nav>
          <a href="#book" className="btn primary">
            Book a room
          </a>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="wrap">
            <div className="hero-grid">
              <div>
                <span className="eyebrow">Old Bodija · Ibadan</span>
                <h1 className="display">
                  Rest easy in the heart of <em>Bodija.</em>
                </h1>
                <p className="lede">Quiet rooms, steady power and a warm Ibadan welcome — with a pool, a gym and a lounge just downstairs. Book direct for our best rate.</p>
                <div className="trust">
                  <span><Icon name="bolt" />24-hour power</span>
                  <span><Icon name="shield" />Gated &amp; secure</span>
                  <span><Icon name="wifi" />Free Wi-Fi</span>
                  <span><Icon name="car" />On-site parking</span>
                </div>
              </div>
              <div className="hero-art">
                <picture>
                  <source srcSet="/brand/building-900.jpg" media="(max-width: 900px)" />
                  <img src="/brand/building-1600.jpg" alt="The Danest Hotel & Suites building: a stone-clad two-storey hotel behind a cream wall and black gate, with palm trees." width={1600} height={870} fetchPriority="high" />
                </picture>
                <img className="crest" src="/brand/crest-512.png" alt="" width={116} height={116} />
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
              <button className="btn gold lg">Check availability</button>
            </form>
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
                Every room has air conditioning, power that stays on, and housekeeping every day.{' '}
                {validDates && <>Showing prices for <b>{nightsBetween(checkIn, checkOut)} night{nightsBetween(checkIn, checkOut) > 1 ? 's' : ''}</b> from {fmtDateLong(checkIn)}.</>}
              </p>
            </div>
            <div className="rooms">
              {types.map((r, i) => {
                const tooSmall = adults > r.capacity;
                return (
                  <article className="room-card reveal" key={r.id} style={{ transitionDelay: `${i * 70}ms` }}>
                    <div className="swatch" style={{ background: SWATCH[r.slug] }}>
                      <Icon name="bed" className={r.slug === 'executive' || r.slug === 'royal' ? 'light' : ''} />
                    </div>
                    <div className="row">
                      <h3>{r.name}</h3>
                    </div>
                    <p className="muted" style={{ fontSize: 14 }}>{r.description}</p>
                    <ul>
                      {r.amenities.slice(0, 4).map((a) => <li key={a}>{a}</li>)}
                      <li>Sleeps {r.capacity}</li>
                    </ul>
                    <div className="price"><b>{naira(r.rate)}</b> / night</div>
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
              {[
                { icon: 'wave', name: 'Swimming pool', text: 'A clean, sunny pool for a morning swim or a lazy afternoon. Weekend pool parties on request.', tag: 'Day passes from ₦3,000' },
                { icon: 'dumbbell', name: 'Gym', text: 'Free weights, cardio machines and space to stretch. Train alone or book a personal trainer.', tag: 'Day pass ₦3,000 · Monthly ₦25,000' },
                { icon: 'music', name: 'Lounge & bar', text: 'Cold drinks, good music and Friday karaoke. Reserve a VIP table, or hire the lounge for your event.', tag: 'Private hire available' },
              ].map((f, i) => (
                <article className="fac reveal" key={f.name} style={{ transitionDelay: `${i * 90}ms` }}>
                  <Icon name={f.icon} />
                  <h3>{f.name}</h3>
                  <p>{f.text}</p>
                  <span className="tag">{f.tag}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="visit">
          <div className="wrap visit">
            <div className="reveal">
              <span className="eyebrow">Find us</span>
              <h2 className="display" style={{ fontSize: 'clamp(34px, 4.4vw, 56px)', marginTop: 12 }}>
                A quiet street, minutes from everything.
              </h2>
              <dl>
                <div>
                  <dt>Address</dt>
                  <dd>
                    4, Beckley Street, off Adeyi-Estate,
                    <br />
                    Old Bodija Road, Ibadan, Oyo State
                  </dd>
                </div>
                <div>
                  <dt>Check-in · Check-out</dt>
                  <dd>From 2:00 pm · By 12:00 noon</dd>
                </div>
              </dl>
              <a className="btn lg" style={{ marginTop: 28 }} href={MAPS_URL} target="_blank" rel="noopener noreferrer">
                <Icon name="pin" /> Get directions
              </a>
            </div>
            <div className="map-card reveal">
              <iframe
                title="Map showing Danest Hotel & Suites on Beckley Street, Old Bodija, Ibadan"
                src={MAP_EMBED}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
              <div style={{ padding: '16px 24px 22px', display: 'flex', gap: 12, alignItems: 'center', borderTop: '1px solid var(--line)' }}>
                <Icon name="pin" size={22} />
                <div>
                  <b>Danest Hotel &amp; Suites</b>
                  <div className="muted" style={{ fontSize: 14 }}>Look for the black gate on Beckley Street</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <BookingSection
          types={types}
          checkIn={checkIn}
          checkOut={checkOut}
          adults={adults}
          typeId={typeId}
          setCheckIn={setIn}
          setCheckOut={setCheckOut}
          setAdults={setAdults}
          setTypeId={setTypeId}
        />
      </main>

      <footer className="site-footer">
        <div className="wrap">
          <div className="brand">
            <img src="/brand/crest-128.png" alt="" width={44} height={44} />
            <span>
              <b>{HOTEL.name}</b>
              <small style={{ color: '#8f8676' }}>{HOTEL.tagline}</small>
            </span>
          </div>
          <span>{HOTEL.address}</span>
          <Link to="/staff/login">Staff sign-in</Link>
        </div>
      </footer>
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
            No card and no payment needed now. Send your request, our front desk calls you to confirm, and you pay when you arrive — cash, transfer or POS.
          </p>
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
              <Icon name="check" size={40} />
              <h3 className="display" style={{ fontSize: 28, marginTop: 8 }}>Request received</h3>
              <div className="code">{done.code}</div>
              <p className="muted">
                {done.room_type} · {done.nights} night{done.nights === 1 ? '' : 's'} · {naira(done.total)}
                <br />
                Keep this reference. We'll call <b>{form.phone}</b> shortly to confirm your stay.
              </p>
              <button className="btn" style={{ marginTop: 20 }} onClick={() => (setDone(null), setForm({ name: '', phone: '', email: '', notes: '', company: '' }))}>
                Make another booking
              </button>
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
