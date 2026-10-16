import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FACILITIES, FACILITY_LABELS, type Facility, type HotelSettings } from '../../../../shared/constants';
import { RoomScene } from '../../components/illustrations';
import { Card, ErrorBox, Field, Icon, Loading, Modal, PageHead, Tabs, useSubmit, useToast } from '../../components/ui';
import { api, naira } from '../../lib/api';
import { useApi } from '../../lib/hooks';

type Tab = 'hotel' | 'rooms' | 'facilities';

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'hotel';
  return (
    <>
      <PageHead title="Settings" sub="How the hotel is set up: details guests see, rooms and prices, and the facility price list." />
      <div style={{ marginBottom: 16 }}>
        <Tabs
          value={tab}
          onChange={(t) => setParams({ tab: t })}
          options={[
            { value: 'hotel', label: 'Hotel details' },
            { value: 'rooms', label: 'Rooms & rates' },
            { value: 'facilities', label: 'Gym, pool & lounge prices' },
          ]}
        />
      </div>
      {tab === 'hotel' ? <HotelForm /> : tab === 'rooms' ? <RoomsSettings /> : <FacilityPrices />}
    </>
  );
}

// ---------------------------------------------------------------------------

function HotelForm() {
  const { data, reload } = useApi<HotelSettings>('/settings');
  const [f, setF] = useState<HotelSettings | null>(null);
  const { busy, error, submit } = useSubmit();
  const toast = useToast();
  useEffect(() => {
    if (data) setF(data);
  }, [data]);
  if (!f) return <Loading />;
  const set = <K extends keyof HotelSettings>(k: K, v: HotelSettings[K]) => setF({ ...f, [k]: v });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/settings', { method: 'PUT', body: { ...f, highlights: f.highlights.filter((h) => h.title.trim()) } });
      toast('Saved — the website and invoices now use these details');
      reload();
    });
  };
  return (
    <form className="cards cols-main" style={{ alignItems: 'start' }} onSubmit={onSubmit}>
      <div className="stack">
        <Card title="Who you are" sub="Shown on the website, invoices and receipts">
          <div className="stack">
            <div className="grid-2">
              <Field label="Hotel name"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={80} /></Field>
              <Field label="Tagline"><input className="input" value={f.tagline} onChange={(e) => set('tagline', e.target.value)} maxLength={120} /></Field>
            </div>
            <Field label="Address"><input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} required maxLength={200} /></Field>
            <div className="grid-3">
              <Field label="Front desk phone" hint="Guests call this to confirm"><input className="input" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="080…" /></Field>
              <Field label="WhatsApp (optional)"><input className="input" type="tel" value={f.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></Field>
              <Field label="Email (optional)"><input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
            </div>
            <div className="grid-2">
              <Field label="Check-in from"><input className="input" type="time" value={f.check_in_time} onChange={(e) => set('check_in_time', e.target.value)} required /></Field>
              <Field label="Check-out by"><input className="input" type="time" value={f.check_out_time} onChange={(e) => set('check_out_time', e.target.value)} required /></Field>
            </div>
          </div>
        </Card>
        <Card title="Invoices" sub="Printed on every guest bill">
          <div className="stack">
            <Field label="Bank details for transfers" hint="Only printed on invoices — never shown on the website">
              <textarea className="input" value={f.bank_details} onChange={(e) => set('bank_details', e.target.value)} maxLength={300} placeholder="Bank name · Account name · Account number" />
            </Field>
            <Field label="Closing note"><input className="input" value={f.invoice_note} onChange={(e) => set('invoice_note', e.target.value)} maxLength={300} /></Field>
          </div>
        </Card>
      </div>
      <div className="stack">
        <Card title="Website highlights" sub="Up to 4 promises under the booking bar. Only write what is true every day.">
          <div className="stack">
            {[0, 1, 2, 3].map((i) => {
              const h = f.highlights[i] ?? { title: '', text: '' };
              const upd = (patch: Partial<typeof h>) => {
                const next = [...f.highlights];
                next[i] = { ...h, ...patch };
                set('highlights', next);
              };
              return (
                <div className="grid-2" key={i}>
                  <Field label={`Highlight ${i + 1}`}><input className="input" value={h.title} onChange={(e) => upd({ title: e.target.value })} maxLength={40} placeholder={['Gated & secure', 'Power that stays on', 'Free Wi-Fi', 'Pay on arrival'][i]} /></Field>
                  <Field label="Detail"><input className="input" value={h.text} onChange={(e) => upd({ text: e.target.value })} maxLength={90} /></Field>
                </div>
              );
            })}
          </div>
        </Card>
        <ErrorBox error={error} />
        <button className="btn primary lg" disabled={busy}>{busy ? 'Saving…' : 'Save hotel details'}</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

interface RoomType { id: number; name: string; slug: string; rate: number; capacity: number; description: string; amenities: string[]; active: number; rooms: number }
interface Room { id: number; number: string; floor: number; status: string; active: number; room_type_id: number; room_type: string; bookings: number }

function RoomsSettings() {
  const types = useApi<RoomType[]>('/settings/room-types');
  const rooms = useApi<Room[]>('/settings/rooms');
  const [editType, setEditType] = useState<RoomType | 'new' | null>(null);
  const [adding, setAdding] = useState(false);
  const [editRoom, setEditRoom] = useState<Room | null>(null);
  const reload = () => (types.reload(), rooms.reload());

  if (!types.data || !rooms.data) return <Loading />;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Card
        title="Room types & nightly rates"
        sub="Changing a rate affects new bookings only — existing bookings keep the rate they were sold at."
        action={<button className="btn primary sm" onClick={() => setEditType('new')}><Icon name="plus" size={14} /> Add room type</button>}
        pad={false}
      >
        {types.data.length === 0 ? (
          <div className="empty">
            <div style={{ width: 220, height: 130, margin: '0 auto 12px', borderRadius: 12, overflow: 'hidden' }}><RoomScene variant="deluxe" /></div>
            <b style={{ color: 'var(--ink)' }}>Start with your room types</b>
            <p>For example “Standard Room — ₦25,000” and “Executive Suite — ₦55,000”. Then add the room numbers for each.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Room type</th><th className="r">Rate / night</th><th className="r">Sleeps</th><th className="r">Rooms</th><th>On sale</th><th /></tr></thead>
              <tbody>
                {types.data.map((t) => (
                  <tr key={t.id} style={t.active ? undefined : { opacity: 0.55 }}>
                    <td><b>{t.name}</b><div className="muted" style={{ fontSize: 12.5 }}>{t.amenities.slice(0, 4).join(' · ')}</div></td>
                    <td className="r strong">{naira(t.rate)}</td>
                    <td className="r">{t.capacity}</td>
                    <td className="r">{t.rooms}</td>
                    <td>{t.active ? <span className="badge green">Yes</span> : <span className="badge">Hidden</span>}</td>
                    <td className="r"><button className="btn ghost sm" onClick={() => setEditType(t)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title={`Rooms (${rooms.data.filter((r) => r.active).length})`}
        sub="Each physical room. Switch a room off if it is closed long-term; it disappears from bookings and reports."
        action={types.data.length > 0 && <button className="btn primary sm" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add rooms</button>}
        pad={false}
      >
        {rooms.data.length === 0 ? (
          <div className="empty">{types.data.length ? 'No rooms yet. Add them by number — you can add a whole floor at once, like 101-108.' : 'Add a room type first.'}</div>
        ) : (
          <div className="room-board" style={{ padding: 16 }}>
            {rooms.data.map((r) => (
              <button key={r.id} className={`room-tile ${r.active ? r.status : 'maintenance'}`} style={r.active ? undefined : { opacity: 0.5 }} onClick={() => setEditRoom(r)}>
                <span className="no">{r.number}</span>
                <span className="type">{r.room_type} · floor {r.floor}</span>
                {!r.active && <span className="badge">Switched off</span>}
              </button>
            ))}
          </div>
        )}
      </Card>

      {editType && <RoomTypeForm type={editType === 'new' ? null : editType} onClose={() => setEditType(null)} onSaved={() => (setEditType(null), reload())} />}
      {adding && <AddRooms types={types.data.filter((t) => t.active)} onClose={() => setAdding(false)} onSaved={() => (setAdding(false), reload())} />}
      {editRoom && <RoomForm room={editRoom} types={types.data} onClose={() => setEditRoom(null)} onSaved={() => (setEditRoom(null), reload())} />}
    </div>
  );
}

function RoomTypeForm({ type, onClose, onSaved }: { type: RoomType | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: type?.name ?? '', rate: String(type?.rate ?? ''), capacity: String(type?.capacity ?? 2), description: type?.description ?? '',
    amenities: (type?.amenities ?? []).join(', '), active: type ? !!type.active : true,
  });
  const { busy, error, submit } = useSubmit();
  const toast = useToast();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      const body = { ...f, rate: Number(f.rate), capacity: Number(f.capacity), amenities: f.amenities.split(',').map((a) => a.trim()).filter(Boolean) };
      await api(type ? `/settings/room-types/${type.id}` : '/settings/room-types', { method: type ? 'PUT' : 'POST', body });
      toast(type ? 'Room type updated' : 'Room type added — now add its rooms');
      onSaved();
    });
  };
  return (
    <Modal title={type ? `Edit ${type.name}` : 'Add a room type'} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={60} placeholder="e.g. Deluxe Room" /></Field>
        <div className="grid-2">
          <Field label="Rate per night (₦)"><input className="input num" inputMode="numeric" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value.replace(/\D/g, '') })} required /></Field>
          <Field label="Sleeps"><input className="input num" inputMode="numeric" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value.replace(/\D/g, '') })} required /></Field>
        </div>
        <Field label="Short description" hint="One or two sentences for the website"><textarea className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={300} /></Field>
        <Field label="What's in the room" hint="Separate with commas: King bed, Smart TV, Mini-fridge"><input className="input" value={f.amenities} onChange={(e) => setF({ ...f, amenities: e.target.value })} /></Field>
        {type && (
          <label className="row" style={{ fontWeight: 600 }}>
            <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> On sale (shown on the website and at the desk)
          </label>
        )}
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function AddRooms({ types, onClose, onSaved }: { types: RoomType[]; onClose: () => void; onSaved: () => void }) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? 0);
  const [numbers, setNumbers] = useState('');
  const [floor, setFloor] = useState('');
  const { busy, error, submit } = useSubmit();
  const toast = useToast();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      const r = await api<{ created: number }>('/settings/rooms', { body: { room_type_id: typeId, numbers, floor: floor || undefined } });
      toast(`${r.created} room${r.created > 1 ? 's' : ''} added`);
      onSaved();
    });
  };
  return (
    <Modal title="Add rooms" onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <Field label="Room type">
          <select className="input" value={typeId} onChange={(e) => setTypeId(Number(e.target.value))}>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name} — {naira(t.rate)}</option>)}
          </select>
        </Field>
        <Field label="Room numbers" hint="Ranges and lists both work: 101-108, 110, 201">
          <input className="input" value={numbers} onChange={(e) => setNumbers(e.target.value)} required placeholder="101-108" />
        </Field>
        <Field label="Floor (optional)" hint="Leave empty to use the first digit — 101 is floor 1, 201 is floor 2">
          <input className="input num" inputMode="numeric" value={floor} onChange={(e) => setFloor(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Add rooms</button>
        </div>
      </form>
    </Modal>
  );
}

function RoomForm({ room, types, onClose, onSaved }: { room: Room; types: RoomType[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ room_type_id: room.room_type_id, floor: String(room.floor), active: !!room.active });
  const { busy, error, submit } = useSubmit();
  const toast = useToast();
  const save = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api(`/settings/rooms/${room.id}`, { method: 'PUT', body: { ...f, floor: Number(f.floor) } });
      toast(`Room ${room.number} saved`);
      onSaved();
    });
  };
  const remove = () =>
    submit(async () => {
      await api(`/settings/rooms/${room.id}`, { method: 'DELETE' });
      toast(`Room ${room.number} deleted`);
      onSaved();
    });
  return (
    <Modal title={`Room ${room.number}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="grid-2">
          <Field label="Room type">
            <select className="input" value={f.room_type_id} onChange={(e) => setF({ ...f, room_type_id: Number(e.target.value) })}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Floor"><input className="input num" inputMode="numeric" value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value.replace(/\D/g, '') })} required /></Field>
        </div>
        <label className="row" style={{ fontWeight: 600 }}>
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> In use (can be booked)
        </label>
        <ErrorBox error={error} />
        <div className="row">
          {room.bookings === 0 && <button type="button" className="btn danger" disabled={busy} onClick={() => confirm(`Delete room ${room.number}? It has never been booked.`) && remove()}>Delete room</button>}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

interface Item { id: number; facility: Facility; name: string; price: number; active: number }

function FacilityPrices() {
  const { data, reload } = useApi<Item[]>('/settings/facility-items?all=1');
  const [f, setF] = useState({ facility: 'gym' as Facility, name: '', price: '' });
  const { busy, error, submit } = useSubmit();
  const toast = useToast();
  const add = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/settings/facility-items', { body: { ...f, price: Number(f.price) } });
      toast('Price added');
      setF({ ...f, name: '', price: '' });
      reload();
    });
  };
  const toggle = (i: Item) => api(`/settings/facility-items/${i.id}`, { method: 'PUT', body: { ...i, active: !i.active } }).then(reload, (e) => toast(e.message));
  if (!data) return <Loading />;
  return (
    <div className="cards cols-main" style={{ alignItems: 'start' }}>
      <Card title="Price list" sub="These appear as one-tap buttons at the front desk, and their lowest prices on the website" pad={false}>
        {data.length === 0 ? (
          <div className="empty">No prices yet. Add your gym passes, pool passes and lounge charges.</div>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <tbody>
                {FACILITIES.flatMap((fac) =>
                  data.filter((i) => i.facility === fac).map((i, n) => (
                    <tr key={i.id} style={i.active ? undefined : { opacity: 0.5 }}>
                      <td className="muted" style={{ width: 140 }}>{n === 0 ? FACILITY_LABELS[fac] : ''}</td>
                      <td>{i.name}</td>
                      <td className="r strong">{naira(i.price)}</td>
                      <td className="r"><button className="btn ghost sm" onClick={() => toggle(i)}>{i.active ? 'Hide' : 'Show'}</button></td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Add a price">
        <form className="stack" onSubmit={add}>
          <Field label="Facility">
            <select className="input" value={f.facility} onChange={(e) => setF({ ...f, facility: e.target.value as Facility })}>
              {FACILITIES.map((x) => <option key={x} value={x}>{FACILITY_LABELS[x]}</option>)}
            </select>
          </Field>
          <Field label="What is sold"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={80} placeholder="e.g. Pool day pass — adult" /></Field>
          <Field label="Price (₦)"><input className="input num" inputMode="numeric" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/\D/g, '') })} required /></Field>
          <ErrorBox error={error} />
          <button className="btn primary" disabled={busy}>Add price</button>
        </form>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface Checklist { profile: boolean; room_types: boolean; rooms: boolean; products: boolean; facility_items: boolean; team: boolean; mfa: boolean }

/** Shown on the owner's dashboard until the hotel is fully set up. */
export function SetupChecklist() {
  const { data } = useApi<Checklist>('/setup/checklist');
  if (!data) return null;
  const steps: [keyof Checklist, string, string, string][] = [
    ['profile', 'Add your hotel details', 'Phone, address and check-in times for the website and invoices', '/staff/settings?tab=hotel'],
    ['room_types', 'Create your room types and rates', 'e.g. Standard, Deluxe, Executive Suite', '/staff/settings?tab=rooms'],
    ['rooms', 'Add your room numbers', 'A whole floor at once: 101-108', '/staff/settings?tab=rooms'],
    ['products', 'Add bar & shop items, then record a purchase for opening stock', 'Drinks and confectionery with selling prices', '/staff/inventory'],
    ['facility_items', 'Set gym, pool and lounge prices', 'Day passes, memberships, VIP tables', '/staff/settings?tab=facilities'],
    ['team', 'Add your staff with their real names', 'Front desk, bar and housekeeping each get their own sign-in', '/staff/team'],
    ['mfa', 'Turn on two-step sign-in for managers', 'Protects every naira from a stolen password', '/staff/account'],
  ];
  const done = steps.filter(([k]) => data[k]).length;
  if (done === steps.length) return null;
  return (
    <Card title={`Get Danest ready — ${done} of ${steps.length} done`} sub="Everything starts empty so that every number is your hotel's real business." pad={false}>
      <div style={{ height: 4, background: 'var(--line)' }}><div style={{ height: 4, width: `${(done / steps.length) * 100}%`, background: 'var(--gold)', transition: 'width .4s' }} /></div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {steps.map(([k, title, text, to]) => (
          <li key={k} style={{ borderBottom: '1px solid var(--line)' }}>
            <Link to={to} className="row" style={{ padding: '12px 20px', textDecoration: 'none', flexWrap: 'nowrap', opacity: data[k] ? 0.55 : 1 }}>
              <span className={`badge plain ${data[k] ? 'green' : ''}`} style={{ width: 28, height: 28, padding: 0, justifyContent: 'center', borderRadius: '50%' }}>
                {data[k] ? <Icon name="check" size={14} /> : null}
              </span>
              <span>
                <b style={{ fontSize: 14, textDecoration: data[k] ? 'line-through' : undefined }}>{title}</b>
                <div className="muted" style={{ fontSize: 12.5 }}>{text}</div>
              </span>
              <span className="spacer" />
              {!data[k] && <Icon name="arrow" size={16} className="muted" />}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
