import { CalendarCheck, Plus, Search, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SOURCE_LABELS } from '../../../../shared/constants';
import { EmptyState, ErrorNote, LoadingRows, Money, PageHeader } from '@/components/app/page';
import { ReservationStatusPill, StatusPill } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fmtDate, naira } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { balanceOf, chargedOf, type Reservation } from './desk/ReservationSheet';
import { useDesk } from './desk/Desk';

type View = 'upcoming' | 'pending' | 'arrivals' | 'inhouse' | 'departures' | 'balances' | 'all';
const VIEWS: { value: View; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'pending', label: 'Requests' },
  { value: 'arrivals', label: 'Arriving' },
  { value: 'inhouse', label: 'In house' },
  { value: 'departures', label: 'Leaving' },
  { value: 'balances', label: 'Balances' },
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
  const setView = (v: string) => setParams(v === 'pending' ? { status: 'pending' } : v === 'upcoming' ? {} : { view: v });

  return (
    <>
      <PageHeader
        title="Reservations"
        description="Website requests, phone bookings and walk-ins in one list."
        actions={
          <Button onClick={() => desk.newReservation()}>
            <Plus /> New reservation <kbd className="ml-1 rounded border border-primary-foreground/20 px-1 font-mono text-[10px]">N</kbd>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={view} onValueChange={setView}>
          <TabsList className="h-9 flex-wrap">
            {VIEWS.map((v) => (
              <TabsTrigger key={v.value} value={v.value} className="px-3">
                {v.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Guest, phone, room or reference" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <Card className="gap-0 overflow-hidden py-0 shadow-xs">
        <ErrorNote error={error} />
        {!data ? (
          <LoadingRows rows={8} />
        ) : data.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="Nothing here">
            {view === 'pending' ? 'New website requests will appear here.' : 'Try another view or search.'}
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5">Guest</TableHead>
                <TableHead>Stay</TableHead>
                <TableHead>Room</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Source</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="pr-5 text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((r) => {
                const bal = balanceOf(r);
                return (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => desk.openReservation(r.id)}>
                    <TableCell className="pl-5">
                      <div className="flex items-center gap-1.5 font-medium">
                        {r.guest_name}
                        {!!r.guest_vip && <Star className="size-3.5 fill-brand text-brand" />}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-mono">{r.code}</span> · {r.company_name ?? r.guest_phone}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {fmtDate(r.check_in)} → {fmtDate(r.check_out)}
                      <div className="text-xs text-muted-foreground">{r.nights} night{r.nights > 1 ? 's' : ''}</div>
                    </TableCell>
                    <TableCell>
                      {r.room_number ? <span className="font-mono">{r.room_number}</span> : <span className="text-muted-foreground">—</span>}
                      <div className="text-xs text-muted-foreground">{r.room_type}</div>
                    </TableCell>
                    <TableCell>
                      <ReservationStatusPill status={r.status} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">{SOURCE_LABELS[r.source]}</TableCell>
                    <TableCell className="text-right">
                      <Money value={chargedOf(r)} />
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      {r.status === 'cancelled' ? (
                        <span className="text-muted-foreground">—</span>
                      ) : bal > 0 ? (
                        <Money value={bal} className="font-medium text-destructive" />
                      ) : bal < 0 ? (
                        <StatusPill tone="warning">Owed {naira(-bal)}</StatusPill>
                      ) : (
                        <StatusPill tone="success">Paid</StatusPill>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
