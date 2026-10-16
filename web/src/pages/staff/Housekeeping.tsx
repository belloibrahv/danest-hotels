import { useState, type FormEvent } from 'react';
import { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod, type RoomStatus, type TicketPriority, type TicketStatus } from '../../../../shared/constants';
import { EmptyIllo } from '../../components/illustrations';
import { Card, EmptyState, ErrorBox, Field, Icon, Loading, Modal, PageHead, Stat, Tabs, useSubmit, useToast } from '../../components/ui';
import { api, fmtDate, fmtDateTime, naira, todayISO } from '../../lib/api';
import { can, useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';

interface HkRoom {
  id: number;
  number: string;
  floor: number;
  status: RoomStatus;
  room_type: string;
  assigned_to: number | null;
  assigned_name: string | null;
  last_cleaned: string | null;
  guest_leaves: string | null;
  arrival_today: number;
  open_tickets: number;
}
interface Board { rooms: HkRoom[]; staff: { id: number; name: string }[]; cleaned_today: number }
interface Ticket {
  id: number;
  room_id: number | null;
  room_number: string | null;
  area: string | null;
  title: string;
  details: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  blocks_room: number;
  reported_by_name: string | null;
  resolved_by_name: string | null;
  resolution: string | null;
  cost: number | null;
  created_at: string;
  resolved_at: string | null;
}

const PRIORITY_TONE: Record<TicketPriority, string> = { urgent: 'red', normal: 'amber', low: '' };
const LABEL: Record<RoomStatus, string> = { available: 'Ready', occupied: 'Guest in room', cleaning: 'To clean', maintenance: 'Out of order' };
const TONE: Record<RoomStatus, string> = { available: 'green', occupied: 'blue', cleaning: 'amber', maintenance: 'red' };

export default function Housekeeping() {
  const { user } = useAuth();
  const toast = useToast();
  const [v, setV] = useState(0);
  const board = useApi<Board>(`/housekeeping?v=${v}`);
  const [ticketView, setTicketView] = useState<'open' | 'resolved'>('open');
  const tickets = useApi<Ticket[]>(`/maintenance?status=${ticketView}&v=${v}`);
  const [filter, setFilter] = useState<'todo' | 'all' | 'mine'>(user!.role === 'housekeeping' ? 'mine' : 'todo');
  const [reporting, setReporting] = useState<number | 'area' | null>(null);
  const [resolving, setResolving] = useState<Ticket | null>(null);
  const refresh = () => setV((x) => x + 1);
  const supervisor = can(user, 'manager', 'frontdesk');

  const clean = (r: HkRoom) =>
    api(`/rooms/${r.id}/clean`, { body: {} }).then(() => (toast(`Room ${r.number} is clean and ready`), refresh()), (e) => toast(e.message));
  const assign = (r: HkRoom, userId: string) =>
    api(`/rooms/${r.id}/assign`, { body: { user_id: userId ? Number(userId) : null } }).then(refresh, (e) => toast(e.message));
  const setStatus = (t: Ticket, status: TicketStatus) =>
    api(`/maintenance/${t.id}`, { method: 'PATCH', body: { status } }).then(refresh, (e) => toast(e.message));

  if (!board.data) return <Loading />;
  const rooms = board.data.rooms.filter((r) =>
    filter === 'all' ? true : filter === 'mine' ? r.assigned_to === user!.id && r.status === 'cleaning' : r.status === 'cleaning' || r.status === 'maintenance',
  );
  const toClean = board.data.rooms.filter((r) => r.status === 'cleaning');

  return (
    <>
      <PageHead title="Housekeeping" sub={supervisor ? 'Rooms to turn over, who is on them, and anything that needs fixing.' : 'Your rooms for today. Tap “Mark clean” when a room is ready for the next guest.'}>
        <button className="btn" onClick={() => setReporting('area')}><Icon name="bolt" size={16} /> Report a problem</button>
      </PageHead>

      <div className="cards cols-4" style={{ marginBottom: 16 }}>
        <Stat icon="sparkle" label="To clean" value={toClean.length} foot={`${toClean.filter((r) => r.arrival_today).length} needed for arrivals today`} />
        <Stat icon="check" label="Cleaned today" value={board.data.cleaned_today} />
        <Stat icon="bolt" label="Out of order" value={board.data.rooms.filter((r) => r.status === 'maintenance').length} />
        <Stat icon="receipt" label="Open repairs" value={tickets.data && ticketView === 'open' ? tickets.data.length : '–'} />
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <Tabs
          value={filter}
          onChange={setFilter}
          options={[
            ...(user!.role === 'housekeeping' ? [{ value: 'mine' as const, label: 'My rooms' }] : []),
            { value: 'todo', label: 'Needs attention' },
            { value: 'all', label: 'All rooms' },
          ]}
        />
      </div>

      {rooms.length === 0 ? (
        <Card>
          <EmptyState illo={<EmptyIllo kind="key" />} title={filter === 'mine' ? 'No rooms assigned to you right now' : 'Every room is clean'}>
            {filter === 'mine' ? 'Ask your supervisor, or check “Needs attention”.' : 'Nice work.'}
          </EmptyState>
        </Card>
      ) : (
        <div className="hk-grid">
          {rooms.map((r) => (
            <div key={r.id} className={`hk-card ${r.status}`}>
              <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <div>
                  <div className="hk-no">{r.number}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{r.room_type}</div>
                </div>
                <span className="spacer" />
                <span className={`badge ${TONE[r.status]}`}>{LABEL[r.status]}</span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {r.arrival_today > 0 && r.status !== 'occupied' && <span className="badge gold plain">Guest arriving today</span>}
                {r.status === 'occupied' && r.guest_leaves && <span className="badge plain">Leaves {r.guest_leaves === todayISO() ? 'today' : fmtDate(r.guest_leaves)}</span>}
                {r.open_tickets > 0 && <span className="badge red plain">{r.open_tickets} repair{r.open_tickets > 1 ? 's' : ''}</span>}
              </div>
              {supervisor && r.status === 'cleaning' ? (
                <select className="input" value={r.assigned_to ?? ''} onChange={(e) => assign(r, e.target.value)} aria-label={`Assign room ${r.number}`}>
                  <option value="">{board.data!.staff.length ? 'Assign to…' : 'No housekeeping staff yet'}</option>
                  {board.data!.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              ) : (
                r.assigned_name && <div className="muted" style={{ fontSize: 13 }}>Assigned to {r.assigned_to === user!.id ? 'you' : r.assigned_name}</div>
              )}
              {r.last_cleaned && <div className="muted" style={{ fontSize: 12 }}>Last cleaned {fmtDateTime(r.last_cleaned)}</div>}
              <div className="row" style={{ marginTop: 'auto' }}>
                {r.status === 'cleaning' && (
                  <button className="btn gold" style={{ flex: 1 }} onClick={() => clean(r)}>
                    <Icon name="check" size={16} /> Mark clean
                  </button>
                )}
                <button className="btn sm ghost" onClick={() => setReporting(r.id)} title="Report a problem with this room"><Icon name="bolt" size={14} /> Problem</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <Card
          title="Repairs & maintenance"
          sub="Anything broken, in a room or around the hotel"
          action={<Tabs value={ticketView} onChange={setTicketView} options={[{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Fixed' }]} />}
          pad={false}
        >
          {!tickets.data ? (
            <Loading />
          ) : tickets.data.length === 0 ? (
            <div className="empty">{ticketView === 'open' ? 'Nothing waiting to be fixed.' : 'No repairs recorded yet.'}</div>
          ) : (
            <div>
              {tickets.data.map((t) => (
                <div className="ticket" key={t.id}>
                  <div className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                    <span className={`badge ${PRIORITY_TONE[t.priority]}`} style={{ textTransform: 'capitalize', flexShrink: 0 }}>{t.priority}</span>
                    <b style={{ flex: 1 }}>{t.title}</b>
                    {t.status === 'in_progress' && <span className="badge blue">In progress</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    {t.room_number ? `Room ${t.room_number}` : t.area} · reported by {t.reported_by_name ?? '—'} · {fmtDateTime(t.created_at)}
                    {t.blocks_room ? ' · room out of order' : ''}
                  </div>
                  {t.details && <div style={{ fontSize: 13.5 }}>{t.details}</div>}
                  {t.resolution && <div style={{ fontSize: 13.5, color: 'var(--green)' }}>Fixed: {t.resolution}{t.cost ? ` · ${naira(t.cost)}` : ''} · {t.resolved_by_name}</div>}
                  {t.status !== 'resolved' && (
                    <div className="row" style={{ gap: 8 }}>
                      {t.status === 'open' && <button className="btn sm" onClick={() => setStatus(t, 'in_progress')}>Start work</button>}
                      <button className="btn sm primary" onClick={() => setResolving(t)}>Mark fixed</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {reporting !== null && (
        <ReportProblem rooms={board.data.rooms} roomId={reporting === 'area' ? null : reporting} onClose={() => setReporting(null)} onSaved={() => (setReporting(null), refresh())} />
      )}
      {resolving && <Resolve ticket={resolving} canCost={can(user, 'manager')} onClose={() => setResolving(null)} onSaved={() => (setResolving(null), refresh())} />}
    </>
  );
}

function ReportProblem({ rooms, roomId, onClose, onSaved }: { rooms: HkRoom[]; roomId: number | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ room_id: roomId ? String(roomId) : '', area: '', title: '', details: '', priority: 'normal' as TicketPriority, blocks_room: false });
  const { busy, error, submit } = useSubmit();
  const toast = useToast();
  const room = rooms.find((r) => String(r.id) === f.room_id);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/maintenance', { body: { ...f, room_id: f.room_id ? Number(f.room_id) : undefined, area: f.room_id ? undefined : f.area } });
      toast(f.blocks_room ? `Reported — room ${room?.number} is out of order until fixed` : 'Problem reported');
      onSaved();
    });
  };
  return (
    <Modal title="Report a problem" onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <div className="grid-2">
          <Field label="Where">
            <select className="input" value={f.room_id} onChange={(e) => setF({ ...f, room_id: e.target.value, blocks_room: false })}>
              <option value="">Somewhere else in the hotel</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>Room {r.number}</option>)}
            </select>
          </Field>
          {!f.room_id ? (
            <Field label="Area"><input className="input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} required placeholder="Pool, generator, kitchen…" maxLength={60} /></Field>
          ) : (
            <Field label="How urgent">
              <select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as TicketPriority })}>
                <option value="urgent">Urgent</option>
                <option value="normal">Normal</option>
                <option value="low">Can wait</option>
              </select>
            </Field>
          )}
        </div>
        {!f.room_id && (
          <Field label="How urgent">
            <select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as TicketPriority })}>
              <option value="urgent">Urgent</option>
              <option value="normal">Normal</option>
              <option value="low">Can wait</option>
            </select>
          </Field>
        )}
        <Field label="What's wrong"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={120} placeholder="e.g. AC not cooling, shower leaking" /></Field>
        <Field label="Details (optional)"><textarea className="input" value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} maxLength={1000} /></Field>
        {f.room_id && room && room.status !== 'occupied' && (
          <label className="row" style={{ fontWeight: 600 }}>
            <input type="checkbox" checked={f.blocks_room} onChange={(e) => setF({ ...f, blocks_room: e.target.checked })} /> Take room {room.number} out of order until this is fixed
          </label>
        )}
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Report</button>
        </div>
      </form>
    </Modal>
  );
}

function Resolve({ ticket, canCost, onClose, onSaved }: { ticket: Ticket; canCost: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ resolution: '', cost: '', method: 'cash' as PaymentMethod, paid_to: '' });
  const { busy, error, submit } = useSubmit();
  const toast = useToast();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api(`/maintenance/${ticket.id}/resolve`, { body: { ...f, cost: f.cost ? Number(f.cost) : undefined } });
      toast(f.cost ? `Fixed — ${naira(Number(f.cost))} added to repairs expenses` : 'Marked as fixed');
      onSaved();
    });
  };
  return (
    <Modal title={`Fixed: ${ticket.title}`} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <Field label="What was done"><input className="input" value={f.resolution} onChange={(e) => setF({ ...f, resolution: e.target.value })} required maxLength={500} placeholder="e.g. Gas refilled by CoolAir" /></Field>
        {canCost ? (
          <>
            <div className="grid-3">
              <Field label="Cost (₦, optional)"><input className="input num" inputMode="numeric" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value.replace(/\D/g, '') })} /></Field>
              <Field label="Paid by">
                <select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })}>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
                </select>
              </Field>
              <Field label="Paid to"><input className="input" value={f.paid_to} onChange={(e) => setF({ ...f, paid_to: e.target.value })} maxLength={120} /></Field>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>A cost is recorded as a “Repairs & maintenance” expense, so it shows in profit & loss.</p>
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>If the repair cost money, ask the manager to record it.</p>
        )}
        {ticket.blocks_room ? <p className="muted" style={{ fontSize: 13 }}>Room {ticket.room_number} will go to housekeeping for a clean before guests use it.</p> : null}
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Mark fixed</button>
        </div>
      </form>
    </Modal>
  );
}
