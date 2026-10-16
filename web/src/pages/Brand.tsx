import { useEffect } from 'react';
import { EmptyIllo, GymScene, LoungeScene, PoolScene, RoomScene } from '../components/illustrations';
import { Icon } from '../components/kit';
import { SiteFooter, SiteNav } from './Home';

const COLORS = [
  { name: 'Crest Gold', token: '--gold', hex: '#B8862B', from: 'The ring of the crest', use: 'Primary action, highlights, chart marks', ink: '#fff' },
  { name: 'Gold Ink', token: '--gold-ink', hex: '#8A6216', from: 'Gold, deepened for text', use: 'Gold text on light backgrounds (passes AA)', ink: '#fff' },
  { name: 'Gate Black', token: '--ink', hex: '#17140F', from: 'The "DH" mark and the iron gate', use: 'Text, primary buttons, sidebar', ink: '#fff' },
  { name: 'Motto Red', token: '--red', hex: '#B3261E', from: '"Experience a great comfort"', use: 'Errors, money owed, the tagline — sparingly', ink: '#fff' },
  { name: 'Stone', token: '--stone', hex: '#C79F73', from: 'The building’s stone cladding', use: 'Illustration warmth, room scenes', ink: '#17140F' },
  { name: 'Palm', token: '--palm', hex: '#2E6B3F', from: 'The palms by the gate', use: 'Illustration greenery; success is its sibling', ink: '#fff' },
  { name: 'Ivory', token: '--cream', hex: '#FBF7EF', from: 'The cream perimeter wall', use: 'Guest website background', ink: '#17140F' },
  { name: 'Linen', token: '--canvas', hex: '#F7F4EE', from: 'Ivory, a shade quieter', use: 'Back-office canvas', ink: '#17140F' },
];

const STATUS = [
  { name: 'Ready / paid', hex: '#2E7D4F', soft: '#E4F2E9' },
  { name: 'In house / info', hex: '#2B5C9E', soft: '#E5EDF8' },
  { name: 'Needs attention', hex: '#A86400', soft: '#FDF0D9' },
  { name: 'Owed / out of order', hex: '#B3261E', soft: '#FBE9E7' },
];

/** The Danest "Crest" design language: a living style guide built from the same code as the product. */
export default function Brand() {
  useEffect(() => {
    document.title = 'Crest — the Danest design language';
  }, []);
  return (
    <div className="site brand-page">
      <SiteNav />
      <main>
        <section className="hero" style={{ borderTop: 0, paddingBottom: 40 }}>
          <div className="wrap" style={{ maxWidth: 980 }}>
            <span className="eyebrow">Design language · v2</span>
            <h1 className="display" style={{ fontSize: 'clamp(44px, 6vw, 76px)', margin: '14px 0 18px' }}>
              Crest.
            </h1>
            <p className="lede" style={{ maxWidth: '52ch' }}>
              Every colour, typeface and motion in Danest's software comes from two things the hotel already owns: its crest and its building. Guests and staff see one
              brand, from the website to the receipt.
            </p>
            <div className="row" style={{ marginTop: 28, gap: 28, alignItems: 'center' }}>
              <img src="/brand/crest-512.png" alt="The Danest crest" width={140} height={140} style={{ borderRadius: '50%', boxShadow: 'var(--shadow-lg)' }} />
              <img src="/brand/building-900.webp" alt="The Danest building" width={380} height={176} style={{ maxWidth: '100%' }} />
            </div>
          </div>
        </section>

        <section>
          <div className="wrap" style={{ maxWidth: 980 }}>
            <span className="eyebrow">Principles</span>
            <h2 className="display">Warm, calm, exact.</h2>
            <ul className="promises" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginTop: 24 }}>
              {[
                ['sparkle', 'Warm like a welcome', 'Ivory and gold, serif headlines, plain friendly words. Never cold, never corporate.'],
                ['moon', 'Calm under pressure', 'One obvious action per screen. Quiet surfaces so what matters (money owed, arrivals) stands out.'],
                ['check', 'Exact with money', 'Tabular figures, the naira sign on every amount, nothing rounded in a way that hides a number.'],
                ['users', 'Built for real shifts', 'Big tap targets for the till, keyboard shortcuts for the desk, works on a phone at the gate.'],
              ].map(([icon, title, text]) => (
                <li key={title}>
                  <Icon name={icon} size={20} />
                  <span><b>{title}</b>{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section>
          <div className="wrap" style={{ maxWidth: 980 }}>
            <span className="eyebrow">Colour</span>
            <h2 className="display">Drawn from the crest and the building.</h2>
            <div className="swatches">
              {COLORS.map((c) => (
                <div className="sw" key={c.name}>
                  <div className="chip" style={{ background: c.hex, color: c.ink }}>{c.hex}</div>
                  <div className="meta">
                    <b>{c.name}</b>
                    <code>var({c.token})</code>
                    <span className="muted">{c.from}</span>
                    <span>{c.use}</span>
                  </div>
                </div>
              ))}
            </div>
            <h3 style={{ margin: '32px 0 12px', fontSize: 16 }}>Status colours</h3>
            <p className="muted" style={{ marginBottom: 12 }}>Reserved for state. Always paired with a word or icon, never colour alone.</p>
            <div className="row">
              {STATUS.map((s) => (
                <span key={s.name} className="badge" style={{ background: s.soft, color: s.hex, height: 30, padding: '0 12px' }}>{s.name}</span>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="wrap" style={{ maxWidth: 980 }}>
            <span className="eyebrow">Type</span>
            <h2 className="display">A hospitable serif, a hard-working sans.</h2>
            <div className="type-row"><small>Display · Fraunces 500</small><span className="display" style={{ fontSize: 56 }}>Rest easy in Bodija.</span></div>
            <div className="type-row"><small>Heading · Fraunces 500</small><span className="display" style={{ fontSize: 32 }}>Good evening, Folake</span></div>
            <div className="type-row"><small>Figure · Fraunces 500, tabular</small><span className="display num" style={{ fontSize: 32 }}>₦1,284,500</span></div>
            <div className="type-row"><small>Body · Manrope 400, 15/1.5</small><span>Send your request, our front desk calls you to confirm, and you pay when you arrive.</span></div>
            <div className="type-row"><small>Label · Manrope 650, 12.5</small><span style={{ fontWeight: 650, fontSize: 12.5, color: 'var(--ink-2)' }}>Check-in date</span></div>
            <div className="type-row"><small>Eyebrow · Manrope 800, tracked</small><span className="eyebrow">Rooms &amp; suites</span></div>
          </div>
        </section>

        <section>
          <div className="wrap" style={{ maxWidth: 980 }}>
            <span className="eyebrow">Voice</span>
            <h2 className="display">Say what happens, in the guest's words.</h2>
            <p className="muted" style={{ marginBottom: 20, maxWidth: '60ch' }}>
              Lead with the result someone wants. Use plain Nigerian English. Name the next step. Never blame the user in an error.
            </p>
            <div className="voice">
              <div className="do"><small>Do</small>Your room, held in two minutes.</div>
              <div className="dont"><small>Don't</small>Seamless online reservation solution.</div>
              <div className="do"><small>Do</small>Outstanding balance of ₦31,800 — record payment first.</div>
              <div className="dont"><small>Don't</small>Error 409: folio not settled.</div>
              <div className="do"><small>Do</small>We couldn't find a booking with that reference and phone number.</div>
              <div className="dont"><small>Don't</small>Invalid credentials supplied.</div>
            </div>
          </div>
        </section>

        <section>
          <div className="wrap" style={{ maxWidth: 980 }}>
            <span className="eyebrow">Illustration</span>
            <h2 className="display">Flat, geometric, one loop of life.</h2>
            <p className="muted" style={{ marginBottom: 20, maxWidth: '60ch' }}>
              Each scene is vector, drawn in the brand palette, and has one gentle motion: water moving, a lamp breathing, music rising. Motion stops for anyone who asks
              their device to reduce it.
            </p>
            <div className="illo-grid">
              {[
                ['Swimming pool', <PoolScene key="p" />],
                ['Gym', <GymScene key="g" />],
                ['Lounge & bar', <LoungeScene key="l" />],
                ['Standard room', <RoomScene key="s" variant="standard" />],
                ['Deluxe room', <RoomScene key="d" variant="deluxe" />],
                ['Executive suite', <RoomScene key="e" variant="executive" />],
                ['Royal suite', <RoomScene key="r" variant="royal" />],
              ].map(([name, scene]) => (
                <figure key={name as string}>
                  <div>{scene}</div>
                  <figcaption>{name}</figcaption>
                </figure>
              ))}
              <figure>
                <div className="row" style={{ justifyContent: 'space-around', padding: 16, background: 'var(--canvas)' }}>
                  <EmptyIllo kind="bell" />
                  <EmptyIllo kind="glass" />
                </div>
                <figcaption>Empty-state spots</figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section>
          <div className="wrap" style={{ maxWidth: 980 }}>
            <span className="eyebrow">Motion</span>
            <h2 className="display">Quick, soft landings. Nothing bounces.</h2>
            <div className="motion-demo">
              {[
                ['Fast · 120ms', 'Hovers, presses, toggles', 'var(--t-fast)'],
                ['Base · 200ms', 'Menus, tabs, toasts', 'var(--t)'],
                ['Slow · 360ms', 'Drawers, page entrances', 'var(--t-slow)'],
              ].map(([name, use, dur]) => (
                <div key={name}>
                  <div className="ball" style={{ transition: `transform ${dur} var(--ease)` }} />
                  <b>{name}</b>
                  <p className="muted" style={{ fontSize: 14 }}>{use} · hover to play</p>
                </div>
              ))}
            </div>
            <p className="muted" style={{ marginTop: 16, fontSize: 14 }}>
              Easing: <code>cubic-bezier(0.2, 0.8, 0.2, 1)</code>. Things arrive quickly and settle gently. Motion explains where something came from; it never decorates.
            </p>
          </div>
        </section>

        <section>
          <div className="wrap" style={{ maxWidth: 980 }}>
            <span className="eyebrow">Components</span>
            <h2 className="display">One kit for the website and the back office.</h2>
            <div className="stack">
              <div className="row">
                <button className="btn gold">Primary for guests</button>
                <button className="btn primary">Primary for staff</button>
                <button className="btn">Secondary</button>
                <button className="btn ghost">Quiet</button>
                <button className="btn danger">Destructive</button>
              </div>
              <div className="row">
                <span className="badge green">Ready</span>
                <span className="badge blue">In house</span>
                <span className="badge gold">Request</span>
                <span className="badge amber">Reorder</span>
                <span className="badge red">Owes ₦31,800</span>
                <span className="vip">★ VIP</span>
              </div>
              <div className="grid-3" style={{ maxWidth: 640 }}>
                <label className="field"><span>Guest name</span><input className="input" defaultValue="Folake Adeyemi" /></label>
                <label className="field"><span>Phone</span><input className="input" placeholder="080…" /></label>
                <label className="field"><span>Room</span><select className="input"><option>Deluxe Room</option></select></label>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
