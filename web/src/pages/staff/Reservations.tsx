import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PAYMENT_LABELS, PAYMENT_METHODS, SOURCE_LABELS, type PaymentMethod, type ReservationSource, type ReservationStatus } from '../../../../shared/constants';
import { Card, Empty, ErrorBox, Field, Icon, Loading, Modal, PageHead, StatusBadge, Tabs, useSubmit, useToast } from '../../components/ui';
import { addDays, api, fmtDate, fmtDateLong, naira, nightsBetween, todayISO } from '../../lib/api';
import { can, useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';

export interface Reservation {
  id: number;
  code: string;
  check_in: string;
  check_out: string;
  nights: number;
  rate: number;
  total: number;
  paid: number;
  status: ReservationStatus;
  source: ReservationSource;
  adults: number;
  notes: string | null;
  guest_name: string;
  guest_phone: string;
  guest_email: string | null;
  room_type: string;
  room_type_id: number;
  room_number: string | null;
  room_id: number | null;
  created_at: string;
  payments?: { id: number; amount: number; method: PaymentMethod; date: string; received_by: string }[];
}

type View = 'upcoming' | 'pending' | 'inhouse' | 'arrivals' | 'departures' | 'all';
const VIEWS: { value: View; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'pending', label: 'Website requests' },
  { value: 'arrivals', label: 'Arriving today' },
  { value: 'inhouse', label: 'In house' },
  { value: 'departures', label: 'Leaving today' },
  { value: 'all', label: 'All' },
];

export default function Reservations() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('status') === 'pending' ? 'pending' : ((params.get('view') as View) ?? 'upcoming');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const qs = new URLSearchParams();
  if (view === 'pending') qs.set('status', 'pending');
  else if (view !== 'all') qs.set('view', view);
  if (query) qs.set('q', query);
  const { data, error, reload } = useApi<Reservation[]>(`/reservations?${qs}`);

  const setView = (v: View) => setParams(v === 'pending' ? { status: 'pending' } : v === 'upcoming' ? {} : { view: v });

  return (
    <>
      <PageHead title="Reservations" sub="Bookings from the website, the phone and walk-ins — all in one list.">
        <button className="btn primary" onClick={() => setCreating(true)}>
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
          <Empty>No reservations here.</Empty>
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
                  const bal = r.total - r.paid;
                  return (
                    <tr key={r.id} className="click" onClick={() => setOpenId(r.id)}>
                      <td>
                        <div className="strong">{r.guest_name}</div>
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
                      <td className="r">{naira(r.total)}</td>
                      <td className="r">
                        {r.status === 'cancelled' ? '—' : bal > 0 ? <span style={{ color: 'var(--red)', fontWeight: 700 }}>{naira(bal)}</span> : <span className="badge green">Paid</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {openId && <ReservationDetail id={openId} onClose={() => setOpenId(null)} onChange={reload} />}
      {creating && <NewReservation onClose={() => setCreating(false)} onCreated={(id) => (reload(), setCreating(false), setOpenId(id))} />}
    </>
  );
}

// ---------------------------------------------------------------------------

function RoomPicker({ checkIn, checkOut, typeId, exclude, value, onChange, readyOnly }: { checkIn: string; checkOut: string; typeId: number; exclude?: number; value: number | ''; onChange: (v: number | '') => void; readyOnly?: boolean }) {
  const ok = checkOut > checkIn && typeId;
  const { data } = useApi<{ id: number; number: string; status: string }[]>(ok ? `/availability?check_in=${checkIn}&check_out=${checkOut}&room_type_id=${typeId}&exclude=${exclude ?? 0}` : null);
  const rooms = (data ?? []).filter((r) => !readyOnly || r.status === 'available');
  return (
    <Field label="Room" hint={data && rooms.length === 0 ? 'No free rooms of this type for these dates' : readyOnly ? 'Only clean, ready rooms are listed' : 'Optional — you can assign at check-in'}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}>
        <option value="">{readyOnly ? 'Choose a room…' : 'Assign later'}</option>
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            Room {r.number}{r.status !== 'available' ? ` (${r.status})` : ''}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ReservationDetail({ id, onClose, onChange }: { id: number; onClose: () => void; onChange: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const { data: r, error, reload } = useApi<Reservation>(`/reservations/${id}`);
  const [roomId, setRoomId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const { busy, error: actErr, submit } = useSubmit();

  useEffect(() => {
    if (r) {
      setRoomId(r.room_id ?? '');
      setAmount(String(Math.max(0, r.total - r.paid) || ''));
    }
  }, [r]);

  const act = (path: string, body: unknown, msg: string) =>
    submit(async () => {
      await api(`/reservations/${id}/${path}`, { body });
      toast(msg);
      reload();
      onChange();
    });

  if (!r) return <Modal title="Reservation" onClose={onClose}>{error ? <ErrorBox error={error} /> : <Loading />}</Modal>;
  const balance = r.total - r.paid;
  const t = todayISO();

  return (
    <Modal title={r.guest_name} onClose={onClose} wide>
      <div className="stack">
        <div className="row">
          <StatusBadge status={r.status} />
          <span className="badge plain">{r.code}</span>
          <span className="badge plain">{SOURCE_LABELS[r.source]}</span>
          <span className="spacer" />
          <a className="btn sm" href={`tel:${r.guest_phone}`}><Icon name="phone" size={14} /> {r.guest_phone}</a>
        </div>

        <div className="grid-3">
          <div><div className="muted" style={{ fontSize: 12.5 }}>Arrive</div><b>{fmtDateLong(r.check_in)}</b></div>
          <div><div className="muted" style={{ fontSize: 12.5 }}>Leave</div><b>{fmtDateLong(r.check_out)}</b></div>
          <div><div className="muted" style={{ fontSize: 12.5 }}>Room</div><b>{r.room_number ? `Room ${r.room_number}` : 'Not assigned'}</b> · {r.room_type}</div>
        </div>
        {r.notes && <div className="card" style={{ padding: 12, background: 'var(--cream)', fontSize: 14 }}>“{r.notes}”</div>}

        <div className="card" style={{ padding: '4px 16px' }}>
          <div className="summary-line"><span>{r.nights} night{r.nights > 1 ? 's' : ''} × {naira(r.rate)}</span><span className="num">{naira(r.total)}</span></div>
          {r.payments?.map((p) => (
            <div className="summary-line" key={p.id} style={{ fontWeight: 400, fontSize: 14 }}>
              <span className="muted">Paid {fmtDate(p.date)} · {PAYMENT_LABELS[p.method]}{p.received_by ? ` · ${p.received_by}` : ''}</span>
              <span className="num">−{naira(p.amount)}</span>
            </div>
          ))}
          <div className="summary-line">
            <span>Balance</span>
            <span className="num" style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }}>{balance > 0 ? naira(balance) : 'Fully paid'}</span>
          </div>
        </div>

        <ErrorBox error={actErr} />

        {r.status !== 'cancelled' && r.status !== 'checked_out' && balance > 0 && (
          <form className="row" style={{ alignItems: 'end' }} onSubmit={(e) => (e.preventDefault(), act('payments', { amount: Number(amount), method }, `${naira(Number(amount))} recorded`))}>
            <Field label="Record payment (₦)">
              <input className="input num" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} style={{ width: 160 }} required />
            </Field>
            <Field label="Method">
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
              </select>
            </Field>
            <button className="btn" disabled={busy || !amount}>Record payment</button>
          </form>
        )}

        {(r.status === 'pending' || r.status === 'confirmed') && (
          <div className="grid-2" style={{ alignItems: 'end' }}>
            <RoomPicker checkIn={r.status === 'confirmed' && r.check_in <= t ? t : r.check_in} checkOut={r.check_out} typeId={r.room_type_id} exclude={r.id} value={roomId} onChange={setRoomId} readyOnly={r.check_in <= t} />
            <div className="row">
              {r.status === 'pending' && (
                <button className="btn primary" disabled={busy} onClick={() => act('confirm', { room_id: roomId || undefined }, 'Booking confirmed — call the guest to let them know')}>
                  <Icon name="check" size={16} /> Confirm booking
                </button>
              )}
              {r.check_in <= t && (
                <button className="btn gold" disabled={busy || !roomId} onClick={() => act('check-in', { room_id: roomId }, 'Guest checked in')}>
                  Check in now
                </button>
              )}
            </div>
          </div>
        )}

        <div className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          {(r.status === 'pending' || r.status === 'confirmed') && (
            <button className="btn danger" disabled={busy} onClick={() => confirm('Cancel this reservation?') && act('cancel', {}, 'Reservation cancelled')}>
              Cancel reservation
            </button>
          )}
          <span className="spacer" />
          {r.status === 'checked_in' && (
            <>
              {balance > 0 && can(user, 'manager') && (
                <button className="btn danger" disabled={busy} onClick={() => confirm(`Check out with ${naira(balance)} still owed? This is logged.`) && act('check-out', { force: true }, 'Checked out with balance owed')}>
                  Check out anyway
                </button>
              )}
              <button className="btn primary" disabled={busy || balance > 0} title={balance > 0 ? 'Record the balance first' : undefined} onClick={() => act('check-out', {}, 'Checked out — room sent to housekeeping')}>
                Check out
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function NewReservation({ onClose, onCreated, preset }: { onClose: () => void; onCreated: (id: number) => void; preset?: { roomId: number; typeId: number } }) {
  const { user } = useAuth();
  const toast = useToast();
  const t = todayISO();
  const types = useApi<{ id: number; name: string; rate: number; capacity: number }[]>('/room-types');
  const [f, setF] = useState({
    name: '', phone: '', email: '', check_in: t, check_out: addDays(t, 1), room_type_id: preset?.typeId ?? 0, adults: 1,
    source: (preset ? 'walk_in' : 'phone') as ReservationSource, notes: '', deposit: '', deposit_method: 'transfer' as PaymentMethod, rate: '',
  });
  const [roomId, setRoomId] = useState<number | ''>(preset?.roomId ?? '');
  const [checkInNow, setCheckInNow] = useState(!!preset);
  const { busy, error, submit } = useSubmit();
  const set = (k: keyof typeof f, v: string | number) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!f.room_type_id && types.data?.length) set('room_type_id', types.data[0].id);
  }, [types.data, f.room_type_id]);

  const type = types.data?.find((x) => x.id === f.room_type_id);
  const nights = Math.max(0, nightsBetween(f.check_in, f.check_out));
  const rate = f.rate ? Number(f.rate) : type?.rate ?? 0;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      const r = await api<{ id: number }>('/reservations', {
        body: {
          guest: { name: f.name, phone: f.phone, email: f.email },
          check_in: f.check_in, check_out: f.check_out, room_type_id: f.room_type_id, adults: f.adults, source: f.source, notes: f.notes,
          room_id: roomId || undefined, check_in_now: checkInNow && f.check_in === t,
          deposit: f.deposit ? Number(f.deposit) : undefined, deposit_method: f.deposit_method,
          rate: f.rate ? Number(f.rate) : undefined,
        },
      });
      toast(checkInNow ? 'Guest checked in' : 'Reservation saved');
      onCreated(r.id);
    });
  };

  return (
    <Modal title={preset ? 'Walk-in check-in' : 'New reservation'} onClose={onClose} wide>
      <form className="stack" onSubmit={onSubmit}>
        <div className="grid-3">
          <Field label="Guest name"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={120} /></Field>
          <Field label="Phone"><input className="input" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} required pattern="[+\d][\d\s\-]{6,19}" /></Field>
          <Field label="Email (optional)"><input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        </div>
        <div className="grid-3">
          <Field label="Check-in"><input className="input" type="date" min={t} value={f.check_in} onChange={(e) => (set('check_in', e.target.value), f.check_out <= e.target.value && set('check_out', addDays(e.target.value, 1)))} required /></Field>
          <Field label="Check-out"><input className="input" type="date" min={addDays(f.check_in, 1)} value={f.check_out} onChange={(e) => set('check_out', e.target.value)} required /></Field>
          <Field label="Guests">
            <select className="input" value={f.adults} onChange={(e) => set('adults', Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid-3">
          <Field label="Room type">
            <select className="input" value={f.room_type_id} onChange={(e) => (set('room_type_id', Number(e.target.value)), setRoomId(''))}>
              {types.data?.map((x) => <option key={x.id} value={x.id}>{x.name} — {naira(x.rate)}</option>)}
            </select>
          </Field>
          {f.room_type_id > 0 && <RoomPicker checkIn={f.check_in} checkOut={f.check_out} typeId={f.room_type_id} value={roomId} onChange={setRoomId} readyOnly={checkInNow} />}
          <Field label="Booked by">
            <select className="input" value={f.source} onChange={(e) => set('source', e.target.value)}>
              {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid-3">
          <Field label="Payment now (₦, optional)"><input className="input num" inputMode="numeric" value={f.deposit} onChange={(e) => set('deposit', e.target.value.replace(/\D/g, ''))} placeholder="0" /></Field>
          <Field label="Paid by">
            <select className="input" value={f.deposit_method} onChange={(e) => set('deposit_method', e.target.value)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
            </select>
          </Field>
          {can(user, 'manager') ? (
            <Field label="Nightly rate (₦)" hint="Manager only — leave blank for the standard rate"><input className="input num" inputMode="numeric" placeholder={String(type?.rate ?? '')} value={f.rate} onChange={(e) => set('rate', e.target.value.replace(/\D/g, ''))} /></Field>
          ) : <div />}
        </div>
        <Field label="Notes (optional)"><textarea className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={500} /></Field>

        {f.check_in === t && (
          <label className="row" style={{ fontWeight: 600 }}>
            <input type="checkbox" checked={checkInNow} onChange={(e) => setCheckInNow(e.target.checked)} /> Guest is here — check them in now
          </label>
        )}

        <div className="card" style={{ padding: '4px 16px', background: 'var(--cream)' }}>
          <div className="summary-line"><span>{nights} night{nights === 1 ? '' : 's'} × {naira(rate)}</span><span className="num">{naira(rate * nights)}</span></div>
          <div className="summary-line"><span>Balance after payment</span><span className="num">{naira(rate * nights - Number(f.deposit || 0))}</span></div>
        </div>
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || (checkInNow && !roomId)}>{busy ? 'Saving…' : checkInNow ? 'Check in guest' : 'Save reservation'}</button>
        </div>
      </form>
    </Modal>
  );
}
