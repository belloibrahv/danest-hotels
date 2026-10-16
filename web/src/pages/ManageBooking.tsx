import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RoomScene } from '../components/illustrations';
import { ErrorBox, Field, Icon, useSubmit } from '../components/kit';
import { api, fmtDateLong, naira } from '../lib/api';
import { SiteFooter, SiteNav } from './Home';
import { sceneFor, time12, useHotel } from '../lib/hotel';

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

const STATUS: Record<Booking['status'], { title: string; text: string; tone: string }> = {
  pending: { title: "We've got your request", text: "Our front desk will call you to confirm. Nothing to pay until you arrive.", tone: 'gold' },
  confirmed: { title: 'Your room is confirmed', text: "We're looking forward to welcoming you. Bring a valid photo ID to check in.", tone: 'green' },
  checked_in: { title: "You're checked in", text: 'Welcome to Danest. The front desk is here for anything you need.', tone: 'blue' },
  checked_out: { title: 'Thanks for staying with us', text: 'We hope to see you again soon.', tone: '' },
  cancelled: { title: 'This booking was cancelled', text: 'If that is a surprise, please call the front desk.', tone: 'red' },
};

/** Guest self-service: look up a booking with its reference and the phone number used. */
export default function ManageBooking() {
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [phone, setPhone] = useState('');
  const [b, setB] = useState<Booking | null>(null);
  const hotel = useHotel();
  const { busy, error, submit } = useSubmit();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => setB(await api<Booking>('/public/booking-lookup', { body: { code, phone } })));
  };

  const s = b ? STATUS[b.status] : null;
  const variant = b ? sceneFor(b.room_type) : 'deluxe';

  return (
    <div className="site">
      <SiteNav />
      <main className="section" style={{ paddingTop: 56 }}>
        <div className="wrap manage">
          <div>
            <span className="eyebrow">Manage booking</span>
            <h1 className="display" style={{ fontSize: 'clamp(36px, 5vw, 60px)', margin: '12px 0 16px' }}>
              {b ? `Hello, ${b.first_name}.` : 'Find your booking.'}
            </h1>
            {!b ? (
              <form className="stack book-form" onSubmit={onSubmit} style={{ maxWidth: 460 }}>
                <p className="muted">Enter the reference we gave you (it starts with “DH-”) and the phone number you booked with.</p>
                <Field label="Booking reference">
                  <input className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DH-XXXXXX" required maxLength={12} autoCapitalize="characters" />
                </Field>
                <Field label="Phone number">
                  <input className="input" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required pattern="[+\d][\d\s\-]{6,19}" />
                </Field>
                <ErrorBox error={error} />
                <button className="btn gold lg block" disabled={busy}>{busy ? 'Looking…' : 'Find my booking'}</button>
              </form>
            ) : (
              <div className="stack" style={{ maxWidth: 520 }}>
                <div className={`status-card ${s!.tone}`}>
                  <b>{s!.title}</b>
                  <p>{s!.text}</p>
                </div>
                <div className="card" style={{ padding: '6px 20px' }}>
                  <div className="summary-line"><span>Reference</span><span className="num">{b.code}</span></div>
                  <div className="summary-line"><span>Room</span><span>{b.room_type}</span></div>
                  <div className="summary-line"><span>Arrive</span><span>{fmtDateLong(b.check_in)}{hotel ? `, from ${time12(hotel.check_in_time)}` : ''}</span></div>
                  <div className="summary-line"><span>Leave</span><span>{fmtDateLong(b.check_out)}{hotel ? `, by ${time12(hotel.check_out_time)}` : ''}</span></div>
                  <div className="summary-line"><span>{b.nights} night{b.nights > 1 ? 's' : ''}</span><span className="num">{naira(b.total)}</span></div>
                  {b.paid > 0 && <div className="summary-line" style={{ fontWeight: 400 }}><span>Paid so far</span><span className="num">{naira(b.paid)}</span></div>}
                  <div className="summary-line"><span>To pay on arrival</span><span className="num">{naira(Math.max(0, b.total - b.paid))}</span></div>
                </div>
                <p className="muted" style={{ fontSize: 14 }}>Need to change your dates or cancel? Call the front desk{hotel?.phone ? <> on <a href={`tel:${hotel.phone}`}>{hotel.phone}</a></> : ''} and quote <b>{b.code}</b>.</p>
                <div className="row">
                  <Link to="/" className="btn"><Icon name="arrow" size={14} /> Back to the hotel</Link>
                  <button className="btn ghost" onClick={() => (setB(null), setPhone(''))}>Look up another</button>
                </div>
              </div>
            )}
          </div>
          <div className="manage-art" aria-hidden="true">
            <RoomScene variant={variant} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
