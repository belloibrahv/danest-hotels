import { useEffect, useState, type FormEvent } from 'react';
import { ID_LABELS, ID_TYPES, PAYMENT_LABELS, PAYMENT_METHODS, SOURCE_LABELS, type PaymentMethod, type ReservationSource } from '../../../../shared/constants';
import { ErrorBox, Field, Modal, useSubmit, useToast } from '../../components/ui';
import { addDays, api, naira, nightsBetween, todayISO } from '../../lib/api';
import { can, useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';

export interface NewReservationPreset {
  roomId?: number;
  typeId?: number;
  checkIn?: string;
  checkOut?: string;
  walkIn?: boolean;
  guest?: { name: string; phone: string; email?: string };
}

export function RoomPicker({ checkIn, checkOut, typeId, exclude, value, onChange, readyOnly, label = 'Room', anyType }: {
  checkIn: string; checkOut: string; typeId: number; exclude?: number; value: number | ''; onChange: (v: number | '') => void; readyOnly?: boolean; label?: string; anyType?: boolean;
}) {
  const ok = checkOut > checkIn && (typeId || anyType);
  const { data } = useApi<{ id: number; number: string; status: string; room_type_id: number }[]>(
    ok ? `/availability?check_in=${checkIn}&check_out=${checkOut}${anyType ? '' : `&room_type_id=${typeId}`}&exclude=${exclude ?? 0}` : null,
  );
  const rooms = (data ?? []).filter((r) => !readyOnly || r.status === 'available');
  return (
    <Field label={label} hint={data && rooms.length === 0 ? 'No free rooms for these dates' : readyOnly ? 'Only clean, ready rooms are listed' : 'Optional — you can assign at check-in'}>
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

interface Match { id: number; name: string; phone: string; vip: number }

export function NewReservation({ onClose, onCreated, preset }: { onClose: () => void; onCreated: (id: number) => void; preset?: NewReservationPreset }) {
  const { user } = useAuth();
  const toast = useToast();
  const t = todayISO();
  const types = useApi<{ id: number; name: string; rate: number; capacity: number }[]>('/room-types');
  const startIn = preset?.checkIn && preset.checkIn >= t ? preset.checkIn : t;
  const [f, setF] = useState({
    name: preset?.guest?.name ?? '', phone: preset?.guest?.phone ?? '', email: preset?.guest?.email ?? '', id_type: '', id_number: '', address: '',
    check_in: startIn, check_out: preset?.checkOut && preset.checkOut > startIn ? preset.checkOut : addDays(startIn, 1),
    room_type_id: preset?.typeId ?? 0, adults: 1,
    source: (preset?.walkIn ? 'walk_in' : 'phone') as ReservationSource, notes: '', deposit: '', deposit_method: 'transfer' as PaymentMethod, rate: '',
  });
  const [roomId, setRoomId] = useState<number | ''>(preset?.roomId ?? '');
  const [checkInNow, setCheckInNow] = useState(!!preset?.walkIn);
  const [match, setMatch] = useState<Match | null>(null);
  const { busy, error, submit } = useSubmit();
  const set = (k: keyof typeof f, v: string | number) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!f.room_type_id && types.data?.length) set('room_type_id', types.data[0].id);
  }, [types.data, f.room_type_id]);

  // Recognise returning guests as soon as their phone number is typed.
  useEffect(() => {
    const digits = f.phone.replace(/\D/g, '');
    if (digits.length < 10) return setMatch(null);
    const ctl = setTimeout(() => {
      api<{ guests: Match[] }>(`/search?q=${encodeURIComponent(f.phone.trim())}`)
        .then((r) => setMatch(r.guests.find((g) => g.phone.replace(/\D/g, '') === digits) ?? null))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(ctl);
  }, [f.phone]);

  const type = types.data?.find((x) => x.id === f.room_type_id);
  const nights = Math.max(0, nightsBetween(f.check_in, f.check_out));
  const rate = f.rate ? Number(f.rate) : type?.rate ?? 0;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      const r = await api<{ id: number }>('/reservations', {
        body: {
          guest: { name: f.name, phone: f.phone, email: f.email, id_type: f.id_type || undefined, id_number: f.id_number, address: f.address },
          check_in: f.check_in, check_out: f.check_out, room_type_id: f.room_type_id, adults: f.adults, source: f.source, notes: f.notes,
          room_id: roomId || undefined, check_in_now: checkInNow && f.check_in === t,
          deposit: f.deposit ? Number(f.deposit) : undefined, deposit_method: f.deposit_method,
          rate: f.rate ? Number(f.rate) : undefined,
        },
      });
      toast(checkInNow ? 'Guest checked in — welcome them to Danest' : 'Reservation saved');
      onCreated(r.id);
    });
  };

  return (
    <Modal title={checkInNow ? 'Walk-in check-in' : 'New reservation'} onClose={onClose} wide>
      <form className="stack" onSubmit={onSubmit}>
        <div className="grid-3">
          <Field label="Phone"><input className="input" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} required pattern="[+\d][\d\s\-]{6,19}" autoFocus /></Field>
          <Field label="Guest name"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={120} /></Field>
          <Field label="Email (optional)"><input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        </div>
        {match && (
          <div className="row" style={{ background: 'var(--gold-soft)', borderRadius: 'var(--r-sm)', padding: '10px 12px', fontSize: 14 }}>
            <span>Welcome back — this number belongs to <b>{match.name}</b>{match.vip ? <> <span className="vip">★ VIP</span></> : null}.</span>
            {f.name !== match.name && <button type="button" className="btn sm" onClick={() => set('name', match.name)}>Use this guest</button>}
          </div>
        )}
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

        <details open={checkInNow} style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>Guest registration (ID & address)</summary>
          <div className="grid-3" style={{ marginTop: 12 }}>
            <Field label="ID type">
              <select className="input" value={f.id_type} onChange={(e) => set('id_type', e.target.value)}>
                <option value="">Not provided</option>
                {ID_TYPES.map((k) => <option key={k} value={k}>{ID_LABELS[k]}</option>)}
              </select>
            </Field>
            <Field label="ID number"><input className="input" value={f.id_number} onChange={(e) => set('id_number', e.target.value)} maxLength={40} /></Field>
            <Field label="Home address / city"><input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} maxLength={200} /></Field>
          </div>
        </details>

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
        <Field label="Notes (optional)"><textarea className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={500} placeholder="Late arrival, airport pickup, celebrating something…" /></Field>

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
