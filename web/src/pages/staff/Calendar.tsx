import { ChevronLeft, ChevronRight, Plus, Star } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReservationStatus, RoomStatus } from '../../../../shared/constants';
import { ErrorNote, LoadingRows, PageHeader, Section } from '@/components/app/page';
import { ReservationStatusPill, ROOM_LABEL } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { addDays, fmtDate, naira, nightsBetween, todayISO } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { useDesk } from './desk/Desk';

interface Data {
  from: string;
  days: number;
  today: string;
  rooms: { id: number; number: string; floor: number; status: RoomStatus; room_type: string; room_type_id: number }[];
  stays: { id: number; code: string; room_id: number | null; room_type_id: number; check_in: string; check_out: string; status: ReservationStatus; guest_name: string; guest_vip: number; balance: number }[];
}

const ROW = 44;
const RAIL = 156;
const HEAD = 52;
const MIN_DAY = 52;
const BAR: Record<ReservationStatus, string> = {
  checked_in: 'bg-primary text-primary-foreground',
  confirmed: 'bg-brand text-brand-foreground',
  pending: 'bg-brand-soft text-brand-ink border border-dashed border-brand',
  checked_out: 'bg-muted text-muted-foreground',
  cancelled: 'hidden',
};
const DOT: Record<RoomStatus, string> = { available: 'bg-success', occupied: 'bg-info', cleaning: 'bg-warning', maintenance: 'bg-destructive' };
const wd = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });
const mon = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

/** Rooms down the side, days across the top: every stay as a bar, every empty night bookable. */
export default function Calendar() {
  const desk = useDesk();
  const t = todayISO();
  const [from, setFrom] = useState(addDays(t, -2));
  const [days, setDays] = useState('14');
  const { data, error } = useApi<Data>(`/calendar?from=${from}&days=${days}&v=${desk.version}`);

  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [!!data]);
  const DAY = Math.max(MIN_DAY, Math.floor((width - RAIL - 2) / Number(days)));
  const dates = useMemo(() => Array.from({ length: Number(days) }, (_, i) => addDays(from, i)), [from, days]);
  const rowOf = useMemo(() => new Map((data?.rooms ?? []).map((r, i) => [r.id, i])), [data]);

  if (error) return <ErrorNote error={error} />;
  const end = addDays(from, Number(days));
  const tonight = data?.stays.filter((s) => s.room_id && s.check_in <= t && (s.status === 'checked_in' || (s.status === 'confirmed' && s.check_out > t))).length ?? 0;
  const unassigned = data?.stays.filter((s) => !s.room_id && s.status !== 'checked_out') ?? [];

  return (
    <>
      <PageHeader
        title="Tape chart"
        description={`${mon.format(new Date(`${from}T00:00:00Z`))} · ${tonight} of ${data?.rooms.length ?? '–'} rooms taken tonight`}
        actions={
          <>
            <div className="flex items-center rounded-md border">
              <Button variant="ghost" size="icon" className="rounded-r-none" onClick={() => setFrom(addDays(from, -7))} aria-label="Previous week">
                <ChevronLeft />
              </Button>
              <Button variant="ghost" size="sm" className="rounded-none border-x" onClick={() => setFrom(addDays(t, -2))}>
                Today
              </Button>
              <Button variant="ghost" size="icon" className="rounded-l-none" onClick={() => setFrom(addDays(from, 7))} aria-label="Next week">
                <ChevronRight />
              </Button>
            </div>
            <ToggleGroup type="single" variant="outline" value={days} onValueChange={(v) => v && setDays(v)}>
              <ToggleGroupItem value="14" className="px-3">2 wk</ToggleGroupItem>
              <ToggleGroupItem value="21" className="px-3">3 wk</ToggleGroupItem>
              <ToggleGroupItem value="28" className="px-3">4 wk</ToggleGroupItem>
            </ToggleGroup>
            <Button onClick={() => desk.newReservation()}>
              <Plus /> New
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
        {[
          ['bg-primary', 'In house'],
          ['bg-brand', 'Confirmed'],
          ['bg-brand-soft border border-dashed border-brand', 'Website request'],
          ['bg-muted border', 'Departed'],
        ].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1.5">
            <i className={cn('inline-block h-2.5 w-5 rounded-sm', c)} /> {l}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <i className="size-2 rounded-full bg-destructive" /> Owes money
        </span>
        <span className="ml-auto hidden sm:inline">Click an empty night to book it</span>
      </div>

      {!data ? (
        <div ref={wrap}>
          <LoadingRows rows={10} />
        </div>
      ) : (
        <div ref={wrap} className="relative max-h-[calc(100svh-230px)] overflow-auto rounded-xl border bg-card shadow-xs">
          <div className="relative grid min-w-max" style={{ gridTemplateColumns: `${RAIL}px repeat(${days}, ${DAY}px)` }}>
            <div className="sticky top-0 left-0 z-30 flex h-[52px] items-center border-r border-b bg-muted/60 px-4 text-xs font-medium text-muted-foreground backdrop-blur">Room</div>
            {dates.map((d) => (
              <div key={d} className={cn('sticky top-0 z-20 flex h-[52px] flex-col items-center justify-center border-b bg-muted/60 text-[11px] text-muted-foreground backdrop-blur', isWeekend(d) && 'bg-muted', d === t && 'text-foreground')}>
                <span>{wd.format(new Date(`${d}T00:00:00Z`))}</span>
                <span className={cn('mt-0.5 flex size-6 items-center justify-center rounded-full text-sm font-semibold text-foreground tabular-nums', d === t && 'bg-brand text-brand-foreground')}>{Number(d.slice(8))}</span>
              </div>
            ))}

            {data.rooms.map((r) => (
              <Row key={r.id} room={r} dates={dates} today={t} onBook={(d) => desk.newReservation({ roomId: r.id, typeId: r.room_type_id, checkIn: d, checkOut: addDays(d, 1), walkIn: d === t && r.status === 'available' })} />
            ))}

            {t >= from && t < end && <div className="pointer-events-none absolute bottom-0 z-[5] w-px bg-destructive/70" style={{ top: HEAD, left: RAIL + nightsBetween(from, t) * DAY + DAY / 2 }} />}

            {data.stays.map((s) => {
              const row = s.room_id ? rowOf.get(s.room_id) : undefined;
              if (row === undefined || s.status === 'cancelled') return null;
              const left = RAIL + Math.max(nightsBetween(from, s.check_in) * DAY + DAY / 2, 0);
              const right = RAIL + Math.min(nightsBetween(from, s.check_out) * DAY + DAY / 2, Number(days) * DAY);
              if (right <= left) return null;
              const owes = s.balance > 0 && (s.status === 'checked_in' || s.status === 'checked_out');
              return (
                <Tooltip key={s.id}>
                  <TooltipTrigger asChild>
                    <button
                      className={cn('absolute z-10 flex items-center gap-1.5 overflow-hidden rounded-md px-2 text-left text-xs font-medium whitespace-nowrap shadow-xs transition-[transform,box-shadow] hover:z-20 hover:-translate-y-px hover:shadow-md', BAR[s.status])}
                      style={{ left: left + 2, width: right - left - 4, top: HEAD + row * ROW + 7, height: ROW - 14 }}
                      onClick={() => desk.openReservation(s.id)}
                    >
                      {owes && <span className="size-1.5 shrink-0 rounded-full bg-destructive ring-2 ring-white/70" />}
                      {!!s.guest_vip && <Star className="size-3 shrink-0 fill-current" />}
                      <span className="truncate">{s.guest_name}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {s.guest_name} · {fmtDate(s.check_in)} → {fmtDate(s.check_out)}
                    {owes ? ` · owes ${naira(s.balance)}` : ''}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
      )}

      {unassigned.length > 0 && (
        <Section title="Not yet in a room" description="Confirmed bookings and website requests in this period. Open one to assign a room." className="mt-6" flush>
          <Table>
            <TableBody>
              {unassigned.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => desk.openReservation(s.id)}>
                  <TableCell className="pl-5 font-medium">{s.guest_name}</TableCell>
                  <TableCell className="tabular-nums">{fmtDate(s.check_in)} → {fmtDate(s.check_out)}</TableCell>
                  <TableCell className="text-muted-foreground">{data?.rooms.find((r) => r.room_type_id === s.room_type_id)?.room_type}</TableCell>
                  <TableCell className="pr-5 text-right"><ReservationStatusPill status={s.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
    </>
  );
}

function Row({ room, dates, today, onBook }: { room: Data['rooms'][number]; dates: string[]; today: string; onBook: (d: string) => void }) {
  return (
    <>
      <div className="sticky left-0 z-[15] flex h-11 items-center gap-2.5 border-r border-b bg-card px-4" title={ROOM_LABEL[room.status]}>
        <span className="font-mono text-sm font-semibold">{room.number}</span>
        <span className="truncate text-xs text-muted-foreground">{room.room_type}</span>
        <span className={cn('ml-auto size-2 shrink-0 rounded-full', DOT[room.status])} />
      </div>
      {dates.map((d) => {
        const blocked = room.status === 'maintenance' && d <= addDays(today, 2);
        const past = d < today;
        return (
          <div
            key={d}
            className={cn(
              'h-11 border-r border-b border-border/60',
              isWeekend(d) && 'bg-muted/40',
              d === today && 'bg-brand-soft/40',
              past ? 'bg-muted/30' : blocked ? 'cursor-not-allowed bg-[repeating-linear-gradient(135deg,transparent,transparent_5px,var(--danger-soft)_5px,var(--danger-soft)_10px)]' : 'cursor-cell hover:bg-accent',
            )}
            onClick={() => !blocked && !past && onBook(d)}
          />
        );
      })}
    </>
  );
}
