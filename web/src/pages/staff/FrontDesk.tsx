import { Check, RefreshCw, Sparkles, UserPlus, Wrench } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { RoomStatus } from '../../../../shared/constants';
import { ErrorNote, LoadingRows, PageHeader, Section } from '@/components/app/page';
import { ROOM_LABEL, ROOM_TONE, RoomStatusPill, StatusPill, VipBadge } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, fmtDate } from '@/lib/api';
import { useApi, useSubmit } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { useDesk } from './desk/Desk';

interface Room {
  id: number;
  number: string;
  floor: number;
  status: RoomStatus;
  room_type: string;
  room_type_id: number;
  reservation_id: number | null;
  check_out: string | null;
  guest_name: string | null;
  guest_vip: number | null;
  arriving_today: number;
}

const EDGE: Record<RoomStatus, string> = { available: 'before:bg-success', occupied: 'before:bg-info', cleaning: 'before:bg-warning', maintenance: 'before:bg-destructive' };
const floorName = (f: number) => (f === 0 ? 'Ground floor' : f === 1 ? 'First floor' : f === 2 ? 'Second floor' : `Floor ${f}`);

export default function FrontDesk() {
  const desk = useDesk();
  const { data, error, reload } = useApi<Room[]>(`/rooms?v=${desk.version}`);
  const [sel, setSel] = useState<Room | null>(null);
  const { busy, error: actErr, submit } = useSubmit();

  if (error) return <ErrorNote error={error} />;
  if (!data) return <LoadingRows rows={8} />;
  const floors = [...new Set(data.map((r) => r.floor))].sort();
  const count = (s: RoomStatus) => data.filter((r) => r.status === s).length;

  const setStatus = (room: Room, status: RoomStatus, msg: string) =>
    submit(async () => {
      await api(`/rooms/${room.id}/status`, { method: 'PATCH', body: { status } });
      toast.success(msg);
      setSel(null);
      reload();
      desk.changed();
    });

  return (
    <>
      <PageHeader
        title="Room board"
        description="Every room at a glance. Select a room to act on it."
        actions={
          <Button variant="outline" onClick={reload}>
            <RefreshCw /> Refresh
          </Button>
        }
      />
      <div className="mb-6 flex flex-wrap gap-2">
        {(Object.keys(ROOM_LABEL) as RoomStatus[]).map((s) => (
          <StatusPill key={s} tone={ROOM_TONE[s]}>
            {ROOM_LABEL[s]} <span className="font-mono">{count(s)}</span>
          </StatusPill>
        ))}
      </div>

      <div className="space-y-6">
        {floors.map((f) => (
          <Section key={f} title={floorName(f)} description={`${data.filter((r) => r.floor === f).length} rooms`}>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(136px,1fr))] gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(168px,1fr))] sm:gap-3">
              {data
                .filter((r) => r.floor === f)
                .map((r) => (
                  <button
                    key={r.id}
                    onClick={() => (r.reservation_id ? desk.openReservation(r.reservation_id) : setSel(r))}
                    className={cn(
                      'relative flex min-h-28 flex-col items-start gap-1 overflow-hidden rounded-lg border bg-card p-3 pl-4 text-left transition-shadow before:absolute before:inset-y-0 before:left-0 before:w-1 hover:shadow-md',
                      EDGE[r.status],
                      r.status === 'maintenance' && 'bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,var(--danger-soft)_6px,var(--danger-soft)_12px)]',
                    )}
                  >
                    <div className="flex w-full items-baseline justify-between">
                      <span className="font-mono text-xl font-semibold">{r.number}</span>
                      {r.arriving_today > 0 && r.status !== 'occupied' && <StatusPill tone="brand" dot={false}>Arrival</StatusPill>}
                    </div>
                    <span className="max-w-full truncate text-xs text-muted-foreground">{r.room_type}</span>
                    <div className="mt-auto w-full min-w-0">
                      {r.status === 'occupied' ? (
                        <>
                          <div className="flex items-center gap-1.5 text-sm font-medium">
                            <span className="truncate">{r.guest_name}</span>
                            {!!r.guest_vip && <VipBadge />}
                          </div>
                          <div className="text-xs text-muted-foreground">Leaves {fmtDate(r.check_out!)}</div>
                        </>
                      ) : (
                        <RoomStatusPill status={r.status} />
                      )}
                    </div>
                  </button>
                ))}
            </div>
          </Section>
        ))}
      </div>

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="sm:max-w-sm">
          {sel && (
            <>
              <DialogHeader>
                <DialogTitle>Room {sel.number}</DialogTitle>
                <DialogDescription className="flex items-center gap-2">
                  {sel.room_type} <RoomStatusPill status={sel.status} />
                </DialogDescription>
              </DialogHeader>
              <ErrorNote error={actErr} />
              <div className="grid gap-2">
                {sel.status === 'available' && (
                  <>
                    <Button size="lg" onClick={() => (desk.newReservation({ roomId: sel.id, typeId: sel.room_type_id, walkIn: true }), setSel(null))}>
                      <UserPlus /> Walk-in guest
                    </Button>
                    <Button variant="outline" disabled={busy} onClick={() => setStatus(sel, 'cleaning', `Room ${sel.number} sent to housekeeping`)}>
                      <Sparkles /> Needs cleaning
                    </Button>
                    <Button variant="outline" className="text-destructive" disabled={busy} onClick={() => setStatus(sel, 'maintenance', `Room ${sel.number} out of order`)}>
                      <Wrench /> Take out of order
                    </Button>
                  </>
                )}
                {sel.status === 'cleaning' && (
                  <Button size="lg" disabled={busy} onClick={() => setStatus(sel, 'available', `Room ${sel.number} is ready`)}>
                    <Check /> Cleaned — mark ready
                  </Button>
                )}
                {sel.status === 'maintenance' && (
                  <Button size="lg" disabled={busy} onClick={() => setStatus(sel, 'available', `Room ${sel.number} back in service`)}>
                    <Check /> Back in service
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
