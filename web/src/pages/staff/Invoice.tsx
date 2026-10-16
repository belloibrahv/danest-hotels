import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { PAYMENT_LABELS, type HotelSettings } from '../../../../shared/constants';
import { ErrorBox, Icon, Loading } from '../../components/ui';
import { fmtDate, fmtDateLong, naira, todayISO } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { balanceOf, type Reservation } from './ReservationDrawer';

/** A print-ready guest folio / invoice. Opens in its own tab; Ctrl+P gives a clean A4. */
export default function Invoice() {
  const { id } = useParams();
  const { data: r, error } = useApi<Reservation>(`/reservations/${Number(id)}`);
  const { data: hotel } = useApi<HotelSettings>('/settings');
  useEffect(() => {
    if (r) document.title = `Invoice ${r.code} — ${r.guest_name}`;
  }, [r]);

  if (error) return <div className="invoice-page"><ErrorBox error={error} /></div>;
  if (!r || !hotel) return <Loading />;
  const balance = balanceOf(r);
  const settled = r.status === 'checked_out' && balance <= 0;

  return (
    <div className="invoice-page">
      <div className="row no-print" style={{ width: 'min(800px, 100%)', margin: '0 auto 16px' }}>
        <span className="muted">Folio for {r.guest_name}</span>
        <span className="spacer" />
        <button className="btn primary" onClick={() => print()}>
          <Icon name="print" size={16} /> Print or save as PDF
        </button>
      </div>
      <article className="invoice">
        <header>
          <div className="row" style={{ gap: 14, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <img src="/brand/crest-128.png" alt="" width={64} height={64} />
            <div>
              <b style={{ fontFamily: 'var(--serif)', fontSize: 20 }}>{hotel.name}</b>
              <div className="muted" style={{ fontSize: 13, maxWidth: 280 }}>
                {hotel.address}
                {(hotel.phone || hotel.email) && <br />}
                {[hotel.phone, hotel.email].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h1>{settled ? 'Receipt' : 'Invoice'}</h1>
            <div className="muted">No. {r.code}</div>
            <div className="muted">{fmtDateLong(todayISO())}</div>
          </div>
        </header>

        <div className="meta">
          <div><small>Guest</small><b>{r.guest_name}</b><div className="muted">{r.guest_phone}</div></div>
          <div><small>Stay</small>{fmtDate(r.check_in)} → {fmtDate(r.check_out)}<div className="muted">{r.nights} night{r.nights > 1 ? 's' : ''}</div></div>
          <div><small>Room</small>{r.room_number ? `Room ${r.room_number}` : '—'}<div className="muted">{r.room_type}</div></div>
        </div>

        <table className="folio">
          <thead>
            <tr>
              <td><small className="muted">Date</small></td>
              <td><small className="muted">Description</small></td>
              <td><small className="muted">Amount (₦)</small></td>
            </tr>
          </thead>
          <tbody>
            {r.folio?.map((l, i) => (
              <tr key={i}>
                <td>{fmtDate(l.date)}</td>
                <td>{l.kind === 'room' ? `Accommodation — ${l.description}` : l.description}</td>
                <td>{naira(l.amount)}</td>
              </tr>
            ))}
            <tr>
              <td />
              <td style={{ fontWeight: 700 }}>Total charges</td>
              <td style={{ fontWeight: 700 }}>{naira(r.total + r.charges)}</td>
            </tr>
            {r.payments?.map((p) => (
              <tr key={p.id} className="pay">
                <td>{fmtDate(p.date)}</td>
                <td>Payment received — {PAYMENT_LABELS[p.method]}</td>
                <td>−{naira(p.amount)}</td>
              </tr>
            ))}
            <tr className="total">
              <td />
              <td>{balance < 0 ? 'Credit due to guest' : 'Balance due'}</td>
              <td>{naira(Math.abs(balance))}</td>
            </tr>
          </tbody>
        </table>

        <footer style={{ marginTop: 40, display: 'flex', justifyContent: 'space-between', gap: 24, fontSize: 13 }} className="muted">
          <span style={{ maxWidth: 380 }}>
            {hotel.invoice_note}
            {hotel.bank_details && balance > 0 && (
              <>
                <br />
                <b style={{ color: 'var(--ink)' }}>Pay by transfer:</b> {hotel.bank_details}
              </>
            )}
            {hotel.tagline && (
              <>
                <br />
                <i style={{ fontFamily: 'var(--serif)', color: 'var(--red)' }}>{hotel.tagline}.</i>
              </>
            )}
          </span>
          <span style={{ textAlign: 'right' }}>
            Guest signature
            <br />
            <span style={{ display: 'inline-block', width: 200, borderBottom: '1px solid var(--ink-3)', height: 28 }} />
          </span>
        </footer>
      </article>
    </div>
  );
}
