import { useEffect, useState } from 'react';
import { PAYMENT_LABELS, PAYMENT_METHODS, SOURCE_LABELS, type PaymentMethod, type ReservationSource, type ReservationStatus } from '../../../../shared/constants';
import { useDesk } from '../../components/Desk';
import { Drawer, ErrorBox, Field, Icon, Loading, StatusBadge, useSubmit, useToast } from '../../components/ui';
import { addDays, api, fmtDate, fmtDateLong, fmtDateTime, naira, nightsBetween, todayISO } from '../../lib/api';
import { can, useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';
import { RoomPicker } from './NewReservation';

export interface Reservation {
  id: number;
  code: string;
  check_in: string;
  check_out: string;
  nights: number;
  rate: number;
  total: number;
  charges: number;
  paid: number;
  status: ReservationStatus;
  source: ReservationSource;
  adults: number;
  notes: string | null;
  guest_id: number;
  guest_name: string;
  guest_phone: string;
  guest_email: string | null;
  guest_vip: number;
  room_type: string;
  room_type_id: number;
  room_number: string | null;
  room_id: number | null;
  created_at: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  payments?: { id: number; amount: number; method: PaymentMethod; date: string; received_by: string }[];
  folio?: { date: string; kind: string; description: string; amount: number }[];
}

export const balanceOf = (r: Pick<Reservation, 'total' | 'charges' | 'paid'>) => r.total + r.charges - r.paid;
const KIND_LABEL: Record<string, string> = { room: 'Room', bar: 'Bar', gym: 'Gym', pool: 'Pool', lounge: 'Lounge' };

export function ReservationDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { user } = useAuth();
  const desk = useDesk();
  const toast = useToast();
  const { data: r, error, reload } = useApi<Reservation>(`/reservations/${id}?v=${desk.version}`);
  const [tab, setTab] = useState<'stay' | 'folio'>('stay');
  const [roomId, setRoomId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const [newOut, setNewOut] = useState('');
  const [moveTo, setMoveTo] = useState<number | ''>('');
  const [panel, setPanel] = useState<'dates' | 'move' | null>(null);
  const { busy, error: actErr, setError, submit } = useSubmit();

  useEffect(() => {
    if (!r) return;
    setRoomId(r.room_id ?? '');
    const t0 = todayISO();
    const used = r.status === 'checked_in' && t0 < r.check_out ? Math.max(1, nightsBetween(r.check_in, t0)) : r.nights;
    // Suggest what's owed so far; the rest of a long stay can be paid later.
    setAmount(String(Math.max(0, Math.min(balanceOf(r), used * r.rate + r.charges - r.paid)) || Math.max(0, balanceOf(r)) || ''));
    setNewOut(r.check_out);
    if (r.status === 'checked_in') setTab((t) => t);
  }, [r]);
  useEffect(() => setError(null), [tab, setError]);

  const act = (path: string, body: unknown, msg: string) =>
    submit(async () => {
      await api(`/reservations/${id}/${path}`, { body });
      toast(msg);
      setPanel(null);
      reload();
      desk.changed();
    });

  if (!r) {
    return (
      <Drawer title="Reservation" onClose={onClose}>
        <div className="drawer-body">{error ? <ErrorBox error={error} /> : <Loading />}</div>
      </Drawer>
    );
  }

  const balance = balanceOf(r);
  const t = todayISO();
  const upcoming = r.status === 'pending' || r.status === 'confirmed';
  const live = upcoming || r.status === 'checked_in';
  const earlyOut = r.status === 'checked_in' && t < addDays(r.check_out, -1);
  // What the guest owes if they walk out today: early departures pay only for nights used.
  const usedNights = r.status === 'checked_in' && t < r.check_out ? Math.max(1, nightsBetween(r.check_in, t)) : r.nights;
  const leaveBalance = usedNights * r.rate + r.charges - r.paid;

  return (
    <Drawer
      title={
        <span className="row" style={{ gap: 10 }}>
          {r.guest_name}
          {!!r.guest_vip && <span className="vip">★ VIP</span>}
        </span>
      }
      sub={
        <span className="row" style={{ gap: 8 }}>
          <StatusBadge status={r.status} />
          <span>{r.code}</span>·<span>{SOURCE_LABELS[r.source]}</span>
        </span>
      }
      onClose={onClose}
      actions={
        <a className="btn sm" href={`/staff/invoice/${r.id}`} target="_blank" rel="noopener" title="Print folio / invoice">
          <Icon name="print" size={14} /> Invoice
        </a>
      }
    >
      <div className="drawer-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'stay'} onClick={() => setTab('stay')}>Stay</button>
        <button role="tab" aria-selected={tab === 'folio'} onClick={() => setTab('folio')}>
          Folio {balance > 0 && <span className="badge red plain" style={{ marginLeft: 6, height: 20 }}>{naira(balance)}</span>}
        </button>
      </div>

      <div className="drawer-body stack" style={{ gap: 18 }}>
        <div className="money-strip">
          <div><small>Charges</small><b>{naira(r.total + r.charges)}</b></div>
          <div><small>Paid</small><b>{naira(r.paid)}</b></div>
          <div><small>{balance < 0 ? 'Credit due to guest' : 'Balance'}</small><b style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }}>{balance === 0 ? 'Settled' : naira(Math.abs(balance))}</b></div>
        </div>

        <ErrorBox error={actErr} />

        {tab === 'stay' ? (
          <>
            <div className="grid-2">
              <div><div className="muted" style={{ fontSize: 12.5 }}>Arrive</div><b>{fmtDateLong(r.check_in)}</b>{r.checked_in_at && <div className="muted" style={{ fontSize: 12.5 }}>In at {fmtDateTime(r.checked_in_at.replace('T', ' ').replace(/\.\d+Z$/, ''))}</div>}</div>
              <div><div className="muted" style={{ fontSize: 12.5 }}>Leave</div><b>{fmtDateLong(r.check_out)}</b><div className="muted" style={{ fontSize: 12.5 }}>{r.nights} night{r.nights > 1 ? 's' : ''} × {naira(r.rate)}</div></div>
              <div><div className="muted" style={{ fontSize: 12.5 }}>Room</div><b>{r.room_number ? `Room ${r.room_number}` : 'Not assigned yet'}</b><div className="muted" style={{ fontSize: 12.5 }}>{r.room_type} · {r.adults} guest{r.adults > 1 ? 's' : ''}</div></div>
              <div>
                <div className="muted" style={{ fontSize: 12.5 }}>Guest</div>
                <button className="btn ghost sm" style={{ padding: 0, height: 'auto', fontWeight: 700 }} onClick={() => desk.openGuest(r.guest_id)}>
                  View profile <Icon name="arrow" size={14} />
                </button>
                <div><a href={`tel:${r.guest_phone}`} className="muted" style={{ fontSize: 13 }}>{r.guest_phone}</a></div>
              </div>
            </div>
            {r.notes && <div className="card" style={{ padding: 12, background: 'var(--cream)', fontSize: 14 }}>“{r.notes}”</div>}

            {upcoming && (
              <div className="card" style={{ padding: 16 }}>
                <div className="grid-2" style={{ alignItems: 'end' }}>
                  <RoomPicker
                    checkIn={r.check_in <= t ? t : r.check_in}
                    checkOut={r.check_out}
                    typeId={r.room_type_id}
                    exclude={r.id}
                    value={roomId}
                    onChange={setRoomId}
                    readyOnly={r.check_in <= t}
                  />
                  <div className="row">
                    {r.status === 'pending' && (
                      <button className="btn primary" disabled={busy} onClick={() => act('confirm', { room_id: roomId || undefined }, 'Booking confirmed — call the guest to let them know')}>
                        <Icon name="check" size={16} /> Confirm
                      </button>
                    )}
                    {r.check_in <= t && (
                      <button className="btn gold" disabled={busy || !roomId} onClick={() => act('check-in', { room_id: roomId }, 'Guest checked in')}>
                        Check in now
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {live && (
              <div className="row">
                <button className="btn sm" onClick={() => setPanel(panel === 'dates' ? null : 'dates')}><Icon name="calendar" size={14} /> Change dates</button>
                {r.room_id && <button className="btn sm" onClick={() => setPanel(panel === 'move' ? null : 'move')}><Icon name="swap" size={14} /> Move room</button>}
                <span className="spacer" />
                {upcoming && r.check_in <= t && (
                  <button className="btn sm" disabled={busy} onClick={() => confirm(`Mark ${r.guest_name} as a no-show?`) && act('no-show', {}, 'Marked as no-show')}>
                    No-show
                  </button>
                )}
                {upcoming && (
                  <button className="btn sm danger" disabled={busy} onClick={() => confirm('Cancel this reservation?') && act('cancel', {}, 'Reservation cancelled')}>
                    Cancel booking
                  </button>
                )}
              </div>
            )}

            {panel === 'dates' && (
              <div className="card row" style={{ padding: 16, alignItems: 'end' }}>
                <Field label="New check-out date">
                  <input className="input" type="date" min={r.status === 'checked_in' ? addDays(t, 1) : addDays(r.check_in, 1)} value={newOut} onChange={(e) => setNewOut(e.target.value)} />
                </Field>
                <span className="muted" style={{ fontSize: 14 }}>
                  {nightsBetween(r.check_in, newOut)} nights · {naira(Math.max(0, nightsBetween(r.check_in, newOut)) * r.rate)}
                </span>
                <button className="btn primary" disabled={busy || newOut === r.check_out} onClick={() => act('extend', { check_out: newOut }, newOut > r.check_out ? 'Stay extended' : 'Stay shortened')}>
                  Save dates
                </button>
              </div>
            )}
            {panel === 'move' && (
              <div className="card" style={{ padding: 16 }}>
                <div className="grid-2" style={{ alignItems: 'end' }}>
                  <RoomPicker anyType label="Move to" checkIn={r.status === 'checked_in' ? t : r.check_in} checkOut={r.check_out} typeId={0} exclude={r.id} value={moveTo} onChange={setMoveTo} readyOnly={r.status === 'checked_in'} />
                  <button className="btn primary" disabled={busy || !moveTo} onClick={() => act('move', { room_id: moveTo }, 'Room changed')}>
                    Move guest
                  </button>
                </div>
                <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>The agreed rate stays the same — a move to a better room is an upgrade, not a resale.</p>
              </div>
            )}

            {r.status === 'checked_in' && (
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }} className="row">
                {earlyOut && <span className="muted" style={{ fontSize: 13 }}>Leaving early? Checking out now charges only the nights used.</span>}
                <span className="spacer" />
                <button className="btn primary" onClick={() => setTab('folio')}>Settle & check out <Icon name="arrow" size={14} /></button>
              </div>
            )}
          </>
        ) : (
          <>
            <table className="folio">
              <tbody>
                {r.folio?.map((l, i) => (
                  <tr key={i}>
                    <td>{fmtDate(l.date)}</td>
                    <td><span className={`kind ${l.kind}`}>{KIND_LABEL[l.kind] ?? l.kind}</span>{l.description}</td>
                    <td>{naira(l.amount)}</td>
                  </tr>
                ))}
                {r.payments?.map((p) => (
                  <tr key={`p${p.id}`} className="pay">
                    <td>{fmtDate(p.date)}</td>
                    <td>Payment · {PAYMENT_LABELS[p.method]}{p.received_by ? ` · ${p.received_by}` : ''}</td>
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

            {r.status !== 'cancelled' && balance > 0 && (
              <form className="card row" style={{ padding: 16, alignItems: 'end' }} onSubmit={(e) => (e.preventDefault(), act('payments', { amount: Number(amount), method }, `${naira(Number(amount))} received`))}>
                <Field label="Take payment (₦)">
                  <input className="input num" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} style={{ width: 150 }} required />
                </Field>
                <Field label="Method">
                  <select className="input" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                    {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
                  </select>
                </Field>
                <button className="btn gold" disabled={busy || !amount}>Record</button>
              </form>
            )}

            {r.status === 'checked_in' && (
              <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 16, gap: 10 }}>
                {usedNights < r.nights && (
                  <div className="muted" style={{ fontSize: 13.5 }}>
                    Leaving today means {usedNights} night{usedNights > 1 ? 's' : ''} instead of {r.nights}: the bill becomes{' '}
                    <b style={{ color: 'var(--ink)' }}>{naira(usedNights * r.rate + r.charges)}</b>
                    {leaveBalance > 0 ? <>, with <b style={{ color: 'var(--red)' }}>{naira(leaveBalance)}</b> to pay.</> : leaveBalance < 0 ? <>, and the guest is owed <b>{naira(-leaveBalance)}</b>.</> : ', fully paid.'}
                  </div>
                )}
                <div className="row">
                  {leaveBalance > 0 && can(user, 'manager') && (
                    <button className="btn danger" disabled={busy} onClick={() => confirm(`Check out with ${naira(leaveBalance)} still owed? This is logged.`) && act('check-out', { force: true }, 'Checked out with balance owed')}>
                      Check out anyway
                    </button>
                  )}
                  <span className="spacer" />
                  <button className="btn primary" disabled={busy || leaveBalance > 0} title={leaveBalance > 0 ? 'Settle the balance first' : undefined} onClick={() => act('check-out', {}, 'Checked out — room sent to housekeeping')}>
                    <Icon name="logout" size={16} /> Check out
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
