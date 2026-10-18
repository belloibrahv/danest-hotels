import { Check, CircleCheck, KeySquare, SprayCan, TriangleAlert, Wrench } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod, type RoomStatus, type TicketPriority, type TicketStatus } from '../../../../shared/constants';
import { Field, MoneyInput, SelectField } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, PageHeader, Section, StatCard } from '@/components/app/page';
import { RoomStatusPill, StatusPill, type Tone } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, fmtDate, fmtDateTime, naira, todayISO } from '@/lib/api';
import { can, useAuth } from '@/lib/auth';
import { useApi, useSubmit } from '@/lib/hooks';
import { cn } from '@/lib/utils';

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
interface Board {
  rooms: HkRoom[];
  staff: { id: number; name: string }[];
  cleaned_today: number;
}
interface Ticket {
  id: number;
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
}

const PRIORITY: Record<TicketPriority, Tone> = { urgent: 'danger', normal: 'warning', low: 'neutral' };

export default function Housekeeping() {
  const { user } = useAuth();
  const [v, setV] = useState(0);
  const board = useApi<Board>(`/housekeeping?v=${v}`);
  const [ticketView, setTicketView] = useState('open');
  const tickets = useApi<Ticket[]>(`/maintenance?status=${ticketView}&v=${v}`);
  const [filter, setFilter] = useState(user!.role === 'housekeeping' ? 'mine' : 'todo');
  const [reporting, setReporting] = useState<number | 'area' | null>(null);
  const [resolving, setResolving] = useState<Ticket | null>(null);
  const refresh = () => setV((x) => x + 1);
  const supervisor = can(user, 'manager', 'frontdesk');

  const clean = (r: HkRoom) => api(`/rooms/${r.id}/clean`, { body: {} }).then(() => (toast.success(`Room ${r.number} is ready`), refresh()), (e) => toast.error(e.message));
  const assign = (r: HkRoom, userId: string) => api(`/rooms/${r.id}/assign`, { body: { user_id: userId === 'none' ? null : Number(userId) } }).then(refresh, (e) => toast.error(e.message));
  const start = (t: Ticket) => api(`/maintenance/${t.id}`, { method: 'PATCH', body: { status: 'in_progress' } }).then(refresh, (e) => toast.error(e.message));

  if (board.error) return <ErrorNote error={board.error} />;
  if (!board.data) return <LoadingRows rows={8} />;
  const rooms = board.data.rooms.filter((r) => (filter === 'all' ? true : filter === 'mine' ? r.assigned_to === user!.id && r.status === 'cleaning' : r.status === 'cleaning' || r.status === 'maintenance'));
  const toClean = board.data.rooms.filter((r) => r.status === 'cleaning');

  return (
    <>
      <PageHeader
        title="Housekeeping"
        description={supervisor ? 'Rooms to turn over, who is on them, and what needs fixing.' : 'Your rooms for today. Tap “Mark clean” when a room is ready.'}
        actions={
          <Button variant="outline" onClick={() => setReporting('area')}>
            <TriangleAlert /> Report a problem
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard icon={SprayCan} label="To clean" value={toClean.length} hint={`${toClean.filter((r) => r.arrival_today).length} for arrivals today`} />
        <StatCard icon={CircleCheck} label="Cleaned today" value={board.data.cleaned_today} />
        <StatCard icon={Wrench} label="Out of order" value={board.data.rooms.filter((r) => r.status === 'maintenance').length} />
        <StatCard icon={TriangleAlert} label="Open repairs" value={ticketView === 'open' ? tickets.data?.length ?? '–' : '–'} />
      </div>

      <Tabs value={filter} onValueChange={setFilter} className="mb-4">
        <TabsList className="h-9">
          {user!.role === 'housekeeping' && <TabsTrigger value="mine">My rooms</TabsTrigger>}
          <TabsTrigger value="todo">Needs attention</TabsTrigger>
          <TabsTrigger value="all">All rooms</TabsTrigger>
        </TabsList>
      </Tabs>

      {rooms.length === 0 ? (
        <Section>
          <EmptyState icon={KeySquare} title={filter === 'mine' ? 'No rooms assigned to you' : 'Every room is clean'}>
            {filter === 'mine' ? 'Check “Needs attention” or ask your supervisor.' : 'Nice work.'}
          </EmptyState>
        </Section>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {rooms.map((r) => (
            <div
              key={r.id}
              className={cn(
                'flex min-h-48 flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs',
                r.status === 'maintenance' && 'bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,var(--danger-soft)_6px,var(--danger-soft)_12px)]',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-2xl font-semibold">{r.number}</div>
                  <div className="text-xs text-muted-foreground">{r.room_type}</div>
                </div>
                <RoomStatusPill status={r.status} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r.arrival_today > 0 && r.status !== 'occupied' && <StatusPill tone="brand">Guest arriving today</StatusPill>}
                {r.status === 'occupied' && r.guest_leaves && <StatusPill>Leaves {r.guest_leaves === todayISO() ? 'today' : fmtDate(r.guest_leaves)}</StatusPill>}
                {r.open_tickets > 0 && <StatusPill tone="danger">{r.open_tickets} repair{r.open_tickets > 1 ? 's' : ''}</StatusPill>}
              </div>
              {supervisor && r.status === 'cleaning' ? (
                <SelectField
                  value={r.assigned_to ? String(r.assigned_to) : ''}
                  onChange={(v) => assign(r, v)}
                  placeholder={board.data!.staff.length ? 'Assign to…' : 'No housekeeping staff yet'}
                  options={[{ value: 'none', label: 'Unassigned' }, ...board.data!.staff.map((s) => ({ value: String(s.id), label: s.name }))]}
                />
              ) : (
                r.assigned_name && <p className="text-xs text-muted-foreground">Assigned to {r.assigned_to === user!.id ? 'you' : r.assigned_name}</p>
              )}
              {r.last_cleaned && <p className="text-xs text-muted-foreground">Last cleaned {fmtDateTime(r.last_cleaned)}</p>}
              <div className="mt-auto flex gap-2">
                {r.status === 'cleaning' && (
                  <Button className="h-11 flex-1" onClick={() => clean(r)}>
                    <Check /> Mark clean
                  </Button>
                )}
                <Button variant="ghost" size={r.status === 'cleaning' ? 'icon' : 'sm'} className={r.status === 'cleaning' ? 'size-11' : ''} onClick={() => setReporting(r.id)} aria-label="Report a problem">
                  <TriangleAlert /> {r.status !== 'cleaning' && 'Report problem'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Section
        className="mt-6"
        title="Repairs & maintenance"
        description="Anything broken, in a room or around the hotel"
        action={
          <Tabs value={ticketView} onValueChange={setTicketView}>
            <TabsList className="h-8">
              <TabsTrigger value="open" className="text-xs">Open</TabsTrigger>
              <TabsTrigger value="resolved" className="text-xs">Fixed</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        flush
      >
        {!tickets.data ? (
          <LoadingRows rows={3} />
        ) : tickets.data.length === 0 ? (
          <EmptyState icon={Wrench} title={ticketView === 'open' ? 'Nothing waiting to be fixed' : 'No repairs recorded yet'} />
        ) : (
          <ul className="divide-y">
            {tickets.data.map((t) => (
              <li key={t.id} className="grid gap-2 px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={PRIORITY[t.priority]} className="capitalize">{t.priority}</StatusPill>
                  <span className="font-medium">{t.title}</span>
                  {t.status === 'in_progress' && <StatusPill tone="info">In progress</StatusPill>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.room_number ? `Room ${t.room_number}` : t.area} · reported by {t.reported_by_name ?? '—'} · {fmtDateTime(t.created_at)}
                  {t.blocks_room ? ' · room out of order' : ''}
                </p>
                {t.details && <p className="text-sm">{t.details}</p>}
                {t.resolution && (
                  <p className="text-sm text-success">
                    Fixed: {t.resolution}
                    {t.cost ? ` · ${naira(t.cost)}` : ''} · {t.resolved_by_name}
                  </p>
                )}
                {t.status !== 'resolved' && (
                  <div className="flex gap-2">
                    {t.status === 'open' && (
                      <Button size="sm" variant="outline" onClick={() => start(t)}>
                        Start work
                      </Button>
                    )}
                    <Button size="sm" onClick={() => setResolving(t)}>
                      Mark fixed
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <ReportProblem rooms={board.data.rooms} target={reporting} onClose={() => setReporting(null)} onSaved={() => (setReporting(null), refresh())} />
      <Resolve ticket={resolving} canCost={can(user, 'manager')} onClose={() => setResolving(null)} onSaved={() => (setResolving(null), refresh())} />
    </>
  );
}

function ReportProblem({ rooms, target, onClose, onSaved }: { rooms: HkRoom[]; target: number | 'area' | null; onClose: () => void; onSaved: () => void }) {
  const blank = () => ({ room_id: typeof target === 'number' ? String(target) : 'none', area: '', title: '', details: '', priority: 'normal' as TicketPriority, blocks_room: false });
  const [f, setF] = useState(blank);
  const [key, setKey] = useState<typeof target>(null);
  if (key !== target) (setKey(target), setF(blank()));
  const { busy, error, submit } = useSubmit();
  const room = rooms.find((r) => String(r.id) === f.room_id);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/maintenance', { body: { ...f, room_id: room ? room.id : undefined, area: room ? undefined : f.area } });
      toast.success(f.blocks_room ? `Reported — room ${room?.number} is out of order` : 'Problem reported');
      onSaved();
    });
  };
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
        </DialogHeader>
        <form id="report" className="grid gap-4" onSubmit={onSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Where">
              <SelectField value={f.room_id} onChange={(v) => setF({ ...f, room_id: v, blocks_room: false })} options={[{ value: 'none', label: 'Elsewhere in the hotel' }, ...rooms.map((r) => ({ value: String(r.id), label: `Room ${r.number}` }))]} />
            </Field>
            <Field label="How urgent">
              <SelectField value={f.priority} onChange={(v) => setF({ ...f, priority: v as TicketPriority })} options={[{ value: 'urgent', label: 'Urgent' }, { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Can wait' }]} />
            </Field>
          </div>
          {!room && (
            <Field label="Area">
              <Input value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} required placeholder="Pool, generator, kitchen…" maxLength={60} />
            </Field>
          )}
          <Field label="What's wrong">
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={120} placeholder="AC not cooling, shower leaking…" />
          </Field>
          <Field label="Details">
            <Textarea value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} maxLength={1000} rows={3} />
          </Field>
          {room && room.status !== 'occupied' && (
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={f.blocks_room} onCheckedChange={(v) => setF({ ...f, blocks_room: v })} /> Take room {room.number} out of order until fixed
            </label>
          )}
          <ErrorNote error={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="report" disabled={busy}>Report</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Resolve({ ticket, canCost, onClose, onSaved }: { ticket: Ticket | null; canCost: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ resolution: '', cost: '', method: 'cash' as PaymentMethod, paid_to: '' });
  const { busy, error, submit } = useSubmit();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api(`/maintenance/${ticket!.id}/resolve`, { body: { ...f, cost: f.cost ? Number(f.cost) : undefined } });
      toast.success(f.cost ? `Fixed — ${naira(Number(f.cost))} added to repairs` : 'Marked as fixed');
      setF({ resolution: '', cost: '', method: 'cash', paid_to: '' });
      onSaved();
    });
  };
  return (
    <Dialog open={!!ticket} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Fixed: {ticket?.title}</DialogTitle>
        </DialogHeader>
        <form id="resolve" className="grid gap-4" onSubmit={onSubmit}>
          <Field label="What was done">
            <Input value={f.resolution} onChange={(e) => setF({ ...f, resolution: e.target.value })} required maxLength={500} placeholder="Gas refilled by CoolAir" />
          </Field>
          {canCost ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Cost" hint="Booked as a repairs expense">
                <MoneyInput value={f.cost} onChange={(v) => setF({ ...f, cost: v })} />
              </Field>
              <Field label="Paid by">
                <SelectField value={f.method} onChange={(v) => setF({ ...f, method: v as PaymentMethod })} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_LABELS[m] }))} />
              </Field>
              <Field label="Paid to">
                <Input value={f.paid_to} onChange={(e) => setF({ ...f, paid_to: e.target.value })} maxLength={120} />
              </Field>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">If the repair cost money, ask the manager to record it.</p>
          )}
          {!!ticket?.blocks_room && <p className="text-xs text-muted-foreground">Room {ticket.room_number} goes to housekeeping for a clean before the next guest.</p>}
          <ErrorNote error={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="resolve" disabled={busy}>Mark fixed</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
