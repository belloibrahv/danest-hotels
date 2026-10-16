import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SOURCE_LABELS } from '../../../../shared/constants';
import { useDesk } from '../../components/Desk';
import { EmptyIllo } from '../../components/illustrations';
import { Card, EmptyState, ErrorBox, Icon, Loading, PageHead, StatusBadge, Tabs } from '../../components/ui';
import { fmtDate, naira } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { balanceOf, type Reservation } from './ReservationDrawer';

type View = 'upcoming' | 'pending' | 'inhouse' | 'arrivals' | 'departures' | 'balances' | 'all';
const VIEWS: { value: View; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'pending', label: 'Website requests' },
  { value: 'arrivals', label: 'Arriving today' },
  { value: 'inhouse', label: 'In house' },
  { value: 'departures', label: 'Leaving today' },
  { value: 'balances', label: 'Owing' },
  { value: 'all', label: 'All' },
];

export default function Reservations() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('status') === 'pending' ? 'pending' : ((params.get('view') as View) ?? 'upcoming');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const desk = useDesk();

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const qs = new URLSearchParams();
  if (view === 'pending') qs.set('status', 'pending');
  else if (view !== 'all') qs.set('view', view);
  if (query) qs.set('q', query);
  qs.set('v', String(desk.version));
  const { data, error } = useApi<Reservation[]>(`/reservations?${qs}`);

  const setView = (v: View) => setParams(v === 'pending' ? { status: 'pending' } : v === 'upcoming' ? {} : { view: v });

  return (
    <>
      <PageHead title="Reservations" sub="Bookings from the website, the phone and walk-ins — all in one list.">
        <button className="btn primary" onClick={() => desk.newReservation()} title="Shortcut: N">
          <Icon name="plus" size={16} /> New reservation
        </button>
      </PageHead>

      <div className="row" style={{ marginBottom: 16 }}>
        <Tabs value={view} onChange={setView} options={VIEWS} />
        <span className="spacer" />
        <label className="row" style={{ gap: 0, position: 'relative' }}>
          <span className="sr-only">Search</span>
          <Icon name="search" size={16} className="muted" />
          <input className="input" style={{ width: 260, marginLeft: -26, paddingLeft: 32 }} placeholder="Guest, phone, room or code" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      <Card pad={false}>
        <ErrorBox error={error} />
        {!data ? (
          <Loading />
        ) : data.length === 0 ? (
          <EmptyState illo={<EmptyIllo kind="bell" />} title="Nothing here right now">
            {view === 'pending' ? 'New website booking requests will appear here.' : 'Try another tab or search.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Stay</th>
                  <th>Room</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th className="r">Total</th>
                  <th className="r">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => {
                  const bal = balanceOf(r);
                  return (
                    <tr key={r.id} className="click" onClick={() => desk.openReservation(r.id)}>
                      <td>
                        <div className="strong">{r.guest_name} {!!r.guest_vip && <span className="vip">★</span>}</div>
                        <div className="muted" style={{ fontSize: 12.5 }}>{r.code} · {r.guest_phone}</div>
                      </td>
                      <td className="num">
                        {fmtDate(r.check_in)} → {fmtDate(r.check_out)}
                        <div className="muted" style={{ fontSize: 12.5 }}>{r.nights} night{r.nights > 1 ? 's' : ''}</div>
                      </td>
                      <td>
                        {r.room_number ? <b>{r.room_number}</b> : <span className="muted">Not assigned</span>}
                        <div className="muted" style={{ fontSize: 12.5 }}>{r.room_type}</div>
                      </td>
                      <td><StatusBadge status={r.status} /></td>
                      <td className="muted">{SOURCE_LABELS[r.source]}</td>
                      <td className="r">{naira(r.total + r.charges)}</td>
                      <td className="r">
                        {r.status === 'cancelled' ? '—' : bal > 0 ? <span style={{ color: 'var(--red)', fontWeight: 700 }}>{naira(bal)}</span> : bal < 0 ? <span className="badge amber">Credit {naira(-bal)}</span> : <span className="badge green">Paid</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

    </>
  );
}
