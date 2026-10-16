import { useEffect, useState, type FormEvent } from 'react';
import { ID_LABELS, ID_TYPES, type IdType } from '../../../../shared/constants';
import { useDesk } from '../../components/Desk';
import { Drawer, ErrorBox, Field, Icon, Loading, StatusBadge, useSubmit, useToast } from '../../components/ui';
import { api, fmtDate, naira } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import type { Reservation } from './ReservationDrawer';

interface Guest {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  vip: number;
  notes: string | null;
  id_type: IdType | null;
  id_number: string | null;
  address: string | null;
  created_at: string;
  stays: number;
  nights: number;
  spend: number;
  last_stay: string | null;
  next_stay: string | null;
  favourite_room: { name: string; n: number } | null;
  stays_list: Reservation[];
}

export function GuestDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const desk = useDesk();
  const toast = useToast();
  const { data: g, error, reload } = useApi<Guest>(`/guests/${id}?v=${desk.version}`);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ name: '', phone: '', email: '', id_type: '', id_number: '', address: '', notes: '', vip: false });
  const { busy, error: saveErr, submit } = useSubmit();

  useEffect(() => {
    if (g) setF({ name: g.name, phone: g.phone, email: g.email ?? '', id_type: g.id_type ?? '', id_number: g.id_number ?? '', address: g.address ?? '', notes: g.notes ?? '', vip: !!g.vip });
  }, [g]);

  const save = (patch: Partial<typeof f> = {}, msg = 'Profile saved') =>
    submit(async () => {
      const next = { ...f, ...patch };
      await api(`/guests/${id}`, { method: 'PATCH', body: { ...next, id_type: next.id_type || undefined } });
      toast(msg);
      setEditing(false);
      reload();
      desk.changed();
    });

  if (!g) {
    return (
      <Drawer title="Guest" onClose={onClose}>
        <div className="drawer-body">{error ? <ErrorBox error={error} /> : <Loading />}</div>
      </Drawer>
    );
  }

  const initials = g.name.split(' ').map((p) => p[0]).slice(0, 2).join('');

  return (
    <Drawer
      title={
        <span className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
          <span className="avatar" style={{ width: 44, height: 44, fontSize: 15, background: g.vip ? 'linear-gradient(135deg, #e8c06a, #b8862b)' : undefined }}>{initials}</span>
          <span>
            {g.name} {!!g.vip && <span className="vip" style={{ verticalAlign: 'middle' }}>★ VIP</span>}
          </span>
        </span>
      }
      sub={`${g.phone}${g.email ? ` · ${g.email}` : ''}`}
      onClose={onClose}
      actions={
        <button className={`btn sm${g.vip ? '' : ' gold'}`} disabled={busy} onClick={() => save({ vip: !g.vip }, g.vip ? 'VIP flag removed' : `${g.name.split(' ')[0]} is now a VIP`)}>
          <Icon name="star" size={14} /> {g.vip ? 'Remove VIP' : 'Make VIP'}
        </button>
      }
    >
      <div className="drawer-body stack" style={{ gap: 18 }}>
        <div className="money-strip">
          <div><small>Stays</small><b>{g.stays}</b></div>
          <div><small>Nights</small><b>{g.nights}</b></div>
          <div><small>Lifetime spend</small><b>{naira(g.spend)}</b></div>
        </div>
        <div className="row muted" style={{ fontSize: 14, gap: 18 }}>
          {g.last_stay && <span>Last stay {fmtDate(g.last_stay)}</span>}
          {g.next_stay && <span className="badge gold plain">Coming back {fmtDate(g.next_stay)}</span>}
          {g.favourite_room && <span>Usually books the {g.favourite_room.name}</span>}
        </div>

        {g.notes && !editing && (
          <div className="card" style={{ padding: 14, background: 'var(--gold-soft)', borderColor: '#ecd9ad', fontSize: 14 }}>
            <b style={{ display: 'block', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--gold-ink)', marginBottom: 4 }}>Guest preferences</b>
            {g.notes}
          </div>
        )}

        {editing ? (
          <form className="stack card" style={{ padding: 16 }} onSubmit={(e: FormEvent) => (e.preventDefault(), save())}>
            <div className="grid-2">
              <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
              <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required /></Field>
            </div>
            <div className="grid-2">
              <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
              <Field label="Address / city"><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
            </div>
            <div className="grid-2">
              <Field label="ID type">
                <select className="input" value={f.id_type} onChange={(e) => setF({ ...f, id_type: e.target.value })}>
                  <option value="">Not provided</option>
                  {ID_TYPES.map((k) => <option key={k} value={k}>{ID_LABELS[k]}</option>)}
                </select>
              </Field>
              <Field label="ID number"><input className="input" value={f.id_number} onChange={(e) => setF({ ...f, id_number: e.target.value })} /></Field>
            </div>
            <Field label="Preferences & notes" hint="Shown to the front desk whenever this guest books">
              <textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={1000} placeholder="Allergies, favourite room, company billing…" />
            </Field>
            <ErrorBox error={saveErr} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn primary" disabled={busy}>Save profile</button>
            </div>
          </form>
        ) : (
          <div className="grid-2" style={{ fontSize: 14 }}>
            <div><div className="muted" style={{ fontSize: 12.5 }}>ID</div>{g.id_type ? <>{ID_LABELS[g.id_type]} · <span className="num">{g.id_number}</span></> : <span className="muted">Not recorded</span>}</div>
            <div><div className="muted" style={{ fontSize: 12.5 }}>Address</div>{g.address ?? <span className="muted">Not recorded</span>}</div>
            <div className="row" style={{ gridColumn: '1 / -1' }}>
              <button className="btn sm" onClick={() => setEditing(true)}><Icon name="user" size={14} /> Edit profile</button>
              <button className="btn sm primary" onClick={() => desk.newReservation({ guest: { name: g.name, phone: g.phone, email: g.email ?? '' } })}><Icon name="plus" size={14} /> New booking</button>
            </div>
          </div>
        )}

        <div>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>Stay history</h3>
          {g.stays_list.length === 0 ? (
            <p className="muted">No stays yet.</p>
          ) : (
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="t">
                <tbody>
                  {g.stays_list.map((s) => (
                    <tr key={s.id} className="click" onClick={() => desk.openReservation(s.id)}>
                      <td className="num">{fmtDate(s.check_in)} → {fmtDate(s.check_out)}</td>
                      <td>{s.room_number ? `Room ${s.room_number}` : s.room_type}</td>
                      <td><StatusBadge status={s.status} /></td>
                      <td className="r strong">{naira(s.total + s.charges)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
