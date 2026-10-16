import { AlertTriangle, ArrowRight, BedDouble, CalendarClock, Coins, LineChart, LogOut, Moon, Package, Plus, Receipt, SprayCan, UserPlus, Wallet, Wrench } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { EmptyState, LoadingRows, Money, PageHeader, Section, StatCard, ErrorNote } from '@/components/app/page';
import { SetupChecklist } from '@/components/app/setup-checklist';
import { StatusPill, VipBadge } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { addDays, fmtDate, fmtDateLong, naira, nairaShort, pct } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import { useDesk } from './desk/Desk';

export interface Kpis {
  roomNightsSold: number;
  roomNightsAvailable: number;
  occupancy: number;
  adr: number;
  revpar: number;
}

export interface PnL {
  from: string;
  to: string;
  revenue: { key: string; label: string; group: 'core' | 'other'; amount: number }[];
  totalRevenue: number;
  costOfSales: { key: string; label: string; amount: number }[];
  totalCostOfSales: number;
  grossProfit: number;
  operating: { key: string; label: string; amount: number }[];
  totalOperating: number;
  netProfit: number;
  kpis: Kpis;
  collections: { byMethod: Record<string, number>; bySource: Record<string, number>; total: number };
  stockPurchases: number;
  stockValue: number;
}

interface Dash {
  ops: {
    date: string;
    last_closed: string | null;
    rooms: { total: number; occupied: number; available: number; cleaning: number; maintenance: number; sellable: number };
    occupancy: number;
    arrivals: number;
    departures: number;
    requests: number;
    balances: { n: number; v: number };
    forecast: { date: string; booked: number; requested: number }[];
    arrivalsList: { id: number; guest_name: string; vip: number; room_type: string; room_number: string | null; status: string; nights: number }[];
  };
  today?: PnL;
  month?: PnL;
  collectedToday?: PnL['collections'];
  last30?: { date: string; rooms: number; bar: number; facilities: number; expenses: number; occupied: number }[];
  lowStock?: { id: number; name: string; stock: number; reorder_level: number; unit: string }[];
}

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Africa/Lagos' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

const revenueChart = {
  rooms: { label: 'Rooms', color: 'var(--chart-1)' },
  bar: { label: 'Bar & shop', color: 'var(--chart-2)' },
  facilities: { label: 'Gym, pool & lounge', color: 'var(--chart-3)' },
} satisfies ChartConfig;

const forecastChart = {
  booked: { label: 'Confirmed & in house', color: 'var(--chart-1)' },
  requested: { label: 'Website requests', color: 'var(--chart-5)' },
} satisfies ChartConfig;

export function KpiTriplet({ k, previous }: { k: Kpis; previous?: Kpis }) {
  const delta = (a: number, b?: number) => (b ? (a - b) / b : null);
  const items = [
    { label: 'Occupancy', value: pct(k.occupancy), hint: `${k.roomNightsSold} of ${k.roomNightsAvailable} room-nights`, d: delta(k.occupancy, previous?.occupancy), tip: 'Room-nights sold ÷ room-nights available' },
    { label: 'ADR', value: naira(k.adr), hint: 'Average rate per occupied room', d: delta(k.adr, previous?.adr), tip: 'Average daily rate: room revenue ÷ room-nights sold' },
    { label: 'RevPAR', value: naira(k.revpar), hint: 'Revenue per available room', d: delta(k.revpar, previous?.revpar), tip: 'Room revenue ÷ all room-nights. Price and occupancy in one number' },
  ];
  return (
    <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {items.map((i) => (
        <div key={i.label} className="p-5" title={i.tip}>
          <div className="text-xs font-medium text-muted-foreground">{i.label}</div>
          <div className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{i.value}</div>
          <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            {i.d !== null && Number.isFinite(i.d) && i.d !== 0 && <span className={i.d > 0 ? 'font-medium text-success' : 'font-medium text-destructive'}>{i.d > 0 ? '↑' : '↓'} {Math.abs(Math.round(i.d * 100))}%</span>}
            <span>{i.hint}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Forecast({ data, rooms }: { data: Dash['ops']['forecast']; rooms: number }) {
  if (!rooms) return <EmptyState icon={CalendarClock} title="No rooms yet">Add your rooms in Settings and bookings will show here.</EmptyState>;
  const peak = data.reduce((a, d) => (d.booked > a.booked ? d : a), data[0]);
  const rows = data.map((d, i) => ({ ...d, label: i === 0 ? 'Today' : new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }) }));
  return (
    <>
      <p className="px-5 pt-4 text-xs text-muted-foreground">{peak.booked ? `Busiest: ${fmtDateLong(peak.date)} at ${pct(peak.booked / rooms)}` : 'Nothing booked yet for the next two weeks'}</p>
      <ChartContainer config={forecastChart} className="aspect-auto h-56 w-full px-2 pb-2">
        <BarChart data={rows} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={1} fontSize={11} />
          <YAxis allowDecimals={false} domain={[0, rooms]} tickLine={false} axisLine={false} width={28} fontSize={11} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <Bar dataKey="booked" stackId="a" fill="var(--color-booked)" radius={[0, 0, 0, 0]} />
          <Bar dataKey="requested" stackId="a" fill="var(--color-requested)" radius={[4, 4, 0, 0]} />
          <ChartLegend content={<ChartLegendContent />} />
        </BarChart>
      </ChartContainer>
    </>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const desk = useDesk();
  const { data, error } = useApi<Dash>(`/dashboard?v=${desk.version}`);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <LoadingRows rows={8} />;
  const { ops, month, today, last30, lowStock, collectedToday } = data;
  const firstName = user!.name.replace(/^(Mrs?|Ms|Dr)\.?\s+/, '').split(' ')[0];
  const manager = user!.role === 'manager';

  const attention = [
    ops.requests > 0 && { to: '/staff/reservations?status=pending', icon: CalendarClock, text: `${ops.requests} website request${ops.requests > 1 ? 's' : ''} to confirm`, tone: 'brand' as const },
    ops.departures > 0 && { to: '/staff/reservations?view=departures', icon: LogOut, text: `${ops.departures} guest${ops.departures > 1 ? 's' : ''} due to check out`, tone: 'info' as const },
    ops.balances.n > 0 && { to: '/staff/reservations?view=balances', icon: Wallet, text: `${ops.balances.n} in-house guest${ops.balances.n > 1 ? 's' : ''} owe ${naira(ops.balances.v)}`, tone: 'danger' as const },
    ops.rooms.cleaning > 0 && { to: '/staff/housekeeping', icon: SprayCan, text: `${ops.rooms.cleaning} room${ops.rooms.cleaning > 1 ? 's' : ''} to clean`, tone: 'warning' as const },
    ops.rooms.maintenance > 0 && { to: '/staff/housekeeping', icon: Wrench, text: `${ops.rooms.maintenance} room${ops.rooms.maintenance > 1 ? 's' : ''} out of order`, tone: 'danger' as const },
    !!lowStock?.length && { to: '/staff/inventory', icon: Package, text: `${lowStock.length} bar item${lowStock.length > 1 ? 's' : ''} running low`, tone: 'warning' as const },
    manager && (!ops.last_closed || ops.last_closed < addDays(ops.date, -1)) && {
      to: '/staff/close-day', icon: Moon, tone: 'neutral' as const,
      text: ops.last_closed ? `Books closed to ${fmtDate(ops.last_closed)} — close ${fmtDate(addDays(ops.last_closed, 1))}` : 'Close each day to count the cash and lock the books',
    },
  ].filter(Boolean) as { to: string; icon: typeof Moon; text: string; tone: 'brand' | 'info' | 'danger' | 'warning' | 'neutral' }[];

  const Attention = (
    <Section title="Needs attention" description={attention.length ? `${attention.length} item${attention.length > 1 ? 's' : ''}` : 'All clear'} flush>
      {attention.length === 0 ? (
        <EmptyState title="Nothing waiting">Enjoy the calm.</EmptyState>
      ) : (
        <ul className="divide-y">
          {attention.map((a) => (
            <li key={a.text}>
              <Link to={a.to} className="group flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-muted/50">
                <StatusPill tone={a.tone} dot={false} className="size-7 justify-center px-0">
                  <a.icon />
                </StatusPill>
                <span className="flex-1">{a.text}</span>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );

  const Arrivals = (
    <Section
      title="Arriving today"
      description={ops.arrivalsList.length ? `${ops.arrivalsList.length} expected` : 'None expected'}
      action={
        <Button variant="ghost" size="sm" asChild>
          <Link to="/staff/calendar">Tape chart</Link>
        </Button>
      }
      flush
    >
      {ops.arrivalsList.length === 0 ? (
        <EmptyState icon={BedDouble} title="No arrivals today" />
      ) : (
        <Table>
          <TableBody>
            {ops.arrivalsList.map((a) => (
              <TableRow key={a.id} className="cursor-pointer" onClick={() => desk.openReservation(a.id)}>
                <TableCell className="pl-5">
                  <div className="flex items-center gap-2 font-medium">
                    {a.guest_name} {!!a.vip && <VipBadge />}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {a.room_type} · {a.nights} night{a.nights > 1 ? 's' : ''}
                  </div>
                </TableCell>
                <TableCell className="pr-5 text-right">{a.room_number ? <span className="font-mono text-sm">{a.room_number}</span> : <StatusPill tone="warning">Assign room</StatusPill>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );

  const header = (
    <PageHeader
      title={`${greeting()}, ${firstName}`}
      description={fmtDateLong(ops.date)}
      actions={
        <>
          {manager && (
            <Button variant="outline" asChild>
              <Link to="/staff/reports">
                <LineChart /> Profit & loss
              </Link>
            </Button>
          )}
          <Button variant="outline" onClick={() => desk.newReservation({ walkIn: true })}>
            <UserPlus /> Walk-in
          </Button>
          <Button onClick={() => desk.newReservation()}>
            <Plus /> New booking
          </Button>
        </>
      }
    />
  );

  if (!month || !today || !last30 || !collectedToday) {
    return (
      <>
        {header}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={BedDouble} label="Occupancy tonight" value={pct(ops.occupancy)} hint={`${ops.rooms.occupied} of ${ops.rooms.sellable} rooms`} />
          <StatCard icon={CalendarClock} label="Arrivals today" value={ops.arrivals} />
          <StatCard icon={LogOut} label="Departures today" value={ops.departures} />
          <StatCard icon={Receipt} label="Website requests" value={ops.requests} />
        </div>
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          {Arrivals}
          {Attention}
        </div>
        <Section title="Next 14 days" description="Rooms already booked" flush>
          <Forecast data={ops.forecast} rooms={ops.rooms.total} />
        </Section>
      </>
    );
  }

  const margin = month.totalRevenue ? month.netProfit / month.totalRevenue : 0;
  const avg = last30.slice(0, -1).reduce((a, d) => a + d.rooms + d.bar + d.facilities, 0) / Math.max(1, last30.length - 1);
  const series = last30.map((d) => ({ ...d, label: new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) }));
  const streamMax = Math.max(1, ...month.revenue.map((r) => r.amount));
  const costs = [
    { label: 'Drinks & snacks sold (cost)', value: month.costOfSales.filter((c) => c.key.startsWith('cogs')).reduce((a, c) => a + c.amount, 0) },
    ...month.costOfSales.filter((c) => !c.key.startsWith('cogs')).map((c) => ({ label: c.label, value: c.amount })),
    ...month.operating.map((c) => ({ label: c.label, value: c.amount })),
  ]
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  const costMax = Math.max(1, ...costs.map((c) => c.value));

  return (
    <>
      {header}
      {manager && (
        <div className="mb-6">
          <SetupChecklist />
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Coins} label="Earned today" value={nairaShort(today.totalRevenue)} hint={`Rooms ${nairaShort(today.revenue[0].amount)} · Bar ${nairaShort(today.revenue[1].amount + today.revenue[2].amount)}`} />
        <StatCard icon={Wallet} label="Collected today" value={nairaShort(collectedToday.total)} hint={`Cash ${nairaShort(collectedToday.byMethod.cash ?? 0)} · Transfer ${nairaShort(collectedToday.byMethod.transfer ?? 0)} · POS ${nairaShort(collectedToday.byMethod.pos ?? 0)}`} />
        <StatCard icon={LineChart} label="Profit this month" value={<span className={month.netProfit < 0 ? 'text-destructive' : ''}>{nairaShort(month.netProfit)}</span>} hint={`${pct(margin)} margin on ${nairaShort(month.totalRevenue)}`} />
        <StatCard icon={BedDouble} label="Occupancy tonight" value={pct(ops.occupancy)} hint={`${ops.rooms.occupied} of ${ops.rooms.sellable} rooms · ${ops.rooms.available} ready`} />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Section title="This month" description={`${fmtDate(month.from)} – ${fmtDate(month.to)} · the numbers investors ask for`} flush>
          <KpiTriplet k={month.kpis} />
        </Section>
        <Section title="Next 14 days" description="Rooms already booked" flush>
          <Forecast data={ops.forecast} rooms={ops.rooms.total} />
        </Section>
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Section title="Revenue, last 30 days" description={`Daily average ${naira(avg)}`} flush>
          <ChartContainer config={revenueChart} className="aspect-auto h-72 w-full px-2 pt-4 pb-2">
            <BarChart data={series} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} fontSize={11} />
              <YAxis tickFormatter={(v) => nairaShort(v)} tickLine={false} axisLine={false} width={56} fontSize={11} />
              <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<ChartTooltipContent indicator="dot" formatter={(v, name) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="text-muted-foreground">{revenueChart[name as keyof typeof revenueChart]?.label}</span>
                  <span className="tabular-nums">{naira(Number(v))}</span>
                </div>
              )} />} />
              <Bar dataKey="rooms" stackId="a" fill="var(--color-rooms)" />
              <Bar dataKey="bar" stackId="a" fill="var(--color-bar)" />
              <Bar dataKey="facilities" stackId="a" fill="var(--color-facilities)" radius={[3, 3, 0, 0]} />
              <ChartLegend content={<ChartLegendContent />} />
            </BarChart>
          </ChartContainer>
        </Section>
        <Section title="Revenue by stream" description="This month">
          <div className="space-y-4">
            {(['core', 'other'] as const).map((g) => (
              <div key={g} className="space-y-3">
                <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{g === 'core' ? 'Main business' : 'Other income'}</div>
                {month.revenue
                  .filter((r) => r.group === g)
                  .map((r) => (
                    <div key={r.key} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                      <span>{r.label}</span>
                      <Money value={r.amount} className="text-right" />
                      <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${(r.amount / streamMax) * 100}%` }} />
                      </div>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {Arrivals}
        {Attention}
        <Section title="Costs this month" description={`${naira(month.totalCostOfSales + month.totalOperating)} in total`}>
          {costs.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="No costs recorded yet" className="py-6" />
          ) : (
            <div className="space-y-3">
              {costs.map((c) => (
                <div key={c.label} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                  <span className="truncate">{c.label}</span>
                  <Money value={c.value} />
                  <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-chart-4" style={{ width: `${(c.value / costMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
