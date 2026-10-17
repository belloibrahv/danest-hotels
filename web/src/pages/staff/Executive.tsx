import { AlertTriangle, ArrowRight, BedDouble, Coins, Crown, KeyRound, LineChart, Moon, Package, Receipt, ShieldAlert, Target, Truck, Wallet, Wrench } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Line, LineChart as LChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { TARGET_KEYS, TARGET_LABELS, type TargetKey } from '../../../../shared/constants';
import { ActivityFeed } from '@/components/app/activity-feed';
import { Field, MoneyInput, SelectField } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, Money, PageHeader, Section, StatCard } from '@/components/app/page';
import { StatusPill, type Tone } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, fmtDate, naira, nairaShort, pct } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi, useSubmit } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { fmtMonth, recentMonths } from '@/lib/months';
import { cn } from '@/lib/utils';
import type { Kpis } from './Dashboard';

interface Brief {
  from: string;
  to: string;
  revenue: number;
  costs: number;
  gross_profit: number;
  net_profit: number;
  margin: number;
  kpis: Kpis;
  collected: number;
  streams: Record<string, number>;
}

interface Exec {
  month: string;
  from: string;
  to: string;
  current: boolean;
  elapsed: number;
  month_days: number;
  rooms: number;
  now: Brief;
  previous: Brief;
  last_year: Brief;
  projection: { remaining_days: number; on_the_books: { nights: number; revenue: number }; basis: 'booked' | 'pace'; revenue: number; costs: number; net_profit: number; occupancy: number } | null;
  targets: Record<string, number>;
  goals: { key: TargetKey; target: number; actual: number; projected: number | null; progress: number | null }[];
  trend: { month: string; revenue: number; rooms: number; bar: number; other: number; costs: number; net_profit: number; occupancy: number; adr: number }[];
  channels: { source: string; label: string; bookings: number; nights: number; revenue: number }[];
  staff: { id: number; name: string; role: string; till: number; receipts: number; collected: number; check_ins: number }[];
  top_products: { name: string; units: number; revenue: number; profit: number }[];
  risks: {
    exceptions: { total: number; high: number; score: number; by_kind: { kind: string; label: string; count: number; amount: number }[] };
    open_queries: number;
    cash_variance: { n: number; v: number; abs: number };
    receivables: { total: number; overdue: number };
    payables: { total: number; overdue: number };
    unclosed_days: number | null;
    low_stock: number;
    out_of_order: number;
    no_two_step: { name: string; role: string }[];
  };
}

const change = (a: number, b: number) => (b ? (a - b) / Math.abs(b) : null);

function Delta({ now, before, invert, points }: { now: number; before: number; invert?: boolean; points?: boolean }) {
  if (points) {
    const d = Math.round((now - before) * 100);
    if (!d) return <span className="text-muted-foreground">—</span>;
    return <span className={cn('font-medium tabular-nums', d > 0 ? 'text-success' : 'text-destructive')}>{d > 0 ? '↑' : '↓'} {Math.abs(d)} pts</span>;
  }
  const c = change(now, before);
  if (c === null || !Number.isFinite(c) || Math.round(c * 100) === 0) return <span className="text-muted-foreground">—</span>;
  const good = invert ? c < 0 : c > 0;
  return <span className={cn('font-medium tabular-nums', good ? 'text-success' : 'text-destructive')}>{c > 0 ? '↑' : '↓'} {Math.abs(Math.round(c * 100))}%</span>;
}

const trendChart = {
  rooms: { label: 'Rooms', color: 'var(--chart-1)' },
  bar: { label: 'Bar & shop', color: 'var(--chart-2)' },
  other: { label: 'Gym, pool & lounge', color: 'var(--chart-3)' },
} satisfies ChartConfig;
const profitChart = { net_profit: { label: 'Net profit', color: 'var(--chart-1)' } } satisfies ChartConfig;

export default function Executive() {
  const { user } = useAuth();
  const [month, setMonth] = useState(recentMonths()[0]);
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(0);
  const live = useLive('money', 'sales', 'reservations', 'queries');
  const { data: d, error } = useApi<Exec>(`/executive?month=${month}&v=${v + live}`);
  const firstName = user!.name.replace(/^(Mrs?|Ms|Dr|Chief|Alhaji)\.?\s+/, '').split(' ')[0];

  const header = (
    <PageHeader
      eyebrow={<span className="inline-flex items-center gap-1.5"><Crown className="size-3.5" /> Owner's view</span>}
      title={`How Danest is doing, ${firstName}`}
      description={d ? `${fmtMonth(d.month)} · ${d.current ? `day ${d.elapsed} of ${d.month_days}` : 'full month'} · compared like-for-like with the same days last month and last year` : 'Loading…'}
      actions={
        <>
          <SelectField className="w-44" value={month} onChange={setMonth} options={recentMonths().map((m) => ({ value: m, label: fmtMonth(m) }))} />
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Target /> Targets
          </Button>
          <Button variant="outline" asChild>
            <Link to="/staff/reports"><LineChart /> Profit & loss</Link>
          </Button>
        </>
      }
    />
  );
  if (error) return (<>{header}<ErrorNote error={error} /></>);
  if (!d) return (<>{header}<LoadingRows rows={10} /></>);

  const { now, previous: prev, last_year: ly, projection: proj } = d;
  const lyHasData = ly.revenue > 0;
  const trendRows = d.trend.map((t) => ({ ...t, label: fmtMonth(t.month, true) }));

  return (
    <>
      {header}

      {/* Headline numbers */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-6">
        <StatCard icon={Coins} label="Revenue" value={nairaShort(now.revenue)} trend={{ value: change(now.revenue, prev.revenue) ?? 0, label: 'vs last month' }} />
        <StatCard icon={LineChart} label="Net profit" value={<span className={now.net_profit < 0 ? 'text-destructive' : ''}>{nairaShort(now.net_profit)}</span>} hint={`${pct(now.margin)} margin`} trend={{ value: change(now.net_profit, prev.net_profit) ?? 0 }} />
        <StatCard icon={Wallet} label="Cash collected" value={nairaShort(now.collected)} trend={{ value: change(now.collected, prev.collected) ?? 0 }} />
        <StatCard icon={BedDouble} label="Occupancy" value={pct(now.kpis.occupancy)} hint={`${now.kpis.roomNightsSold} room-nights`} />
        <StatCard label="ADR" value={naira(now.kpis.adr)} hint="Average rate per sold room" trend={{ value: change(now.kpis.adr, prev.kpis.adr) ?? 0 }} />
        <StatCard label="RevPAR" value={naira(now.kpis.revpar)} hint="Revenue per available room" trend={{ value: change(now.kpis.revpar, prev.kpis.revpar) ?? 0 }} />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        <Section
          title="Targets"
          description={d.goals.length ? `${fmtMonth(d.month)} · the line marks where this month is heading` : 'None set for this month'}
          action={<Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>}
        >
          {d.goals.length === 0 ? (
            <EmptyState icon={Target} title="Set this month's targets" action={<Button size="sm" onClick={() => setEditing(true)}><Target /> Set targets</Button>} className="py-6">
              Revenue, profit, occupancy and room rate to aim for. Progress and a month-end projection show here.
            </EmptyState>
          ) : (
            <div className="space-y-5">
              {d.goals.map((g) => <Goal key={g.key} g={g} expected={d.current ? d.elapsed / d.month_days : 1} />)}
            </div>
          )}
        </Section>

        <Section title={d.current ? 'Where the month is heading' : 'How the month ended'} description={proj ? `Rooms for the last ${proj.remaining_days} days ${proj.basis === 'booked' ? 'from bookings already made' : 'at this month\'s pace (more than is booked so far)'}; everything else at this month's pace` : `${fmtDate(d.from)} – ${fmtDate(d.to)}`}>
          {proj ? (
            <dl className="grid grid-cols-2 gap-4">
              <Projected label="Revenue" value={nairaShort(proj.revenue)} target={d.targets.revenue} raw={proj.revenue} />
              <Projected label="Net profit" value={nairaShort(proj.net_profit)} target={d.targets.net_profit} raw={proj.net_profit} />
              <Projected label="Occupancy" value={pct(proj.occupancy)} target={d.targets.occupancy} raw={Math.round(proj.occupancy * 100)} />
              <div>
                <dt className="text-xs text-muted-foreground">Already booked, rest of month</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{nairaShort(proj.on_the_books.revenue)}</dd>
                <dd className="text-xs text-muted-foreground">{proj.on_the_books.nights} room-nights</dd>
              </div>
            </dl>
          ) : (
            <dl className="grid grid-cols-2 gap-4">
              <Projected label="Revenue" value={nairaShort(now.revenue)} target={d.targets.revenue} raw={now.revenue} />
              <Projected label="Net profit" value={nairaShort(now.net_profit)} target={d.targets.net_profit} raw={now.net_profit} />
            </dl>
          )}
          <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
            Costs are projected at this month's daily pace. Salaries paid once a month make early-month profit look lower than it will end.
          </p>
        </Section>
      </div>

      {/* Comparison */}
      <Section title="This month against the past" description={`First ${d.elapsed} day${d.elapsed > 1 ? 's' : ''} of each month`} className="mb-6" flush>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5" />
                <TableHead className="text-right">{fmtMonth(d.month, true)}</TableHead>
                <TableHead className="text-right">Last month</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">Last year</TableHead>
                <TableHead className="pr-5 text-right">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { label: 'Rooms', a: now.streams.rooms + now.streams.cancellations, b: prev.streams.rooms + prev.streams.cancellations, c: ly.streams.rooms + ly.streams.cancellations },
                { label: 'Bar & shop', a: now.streams.drinks + now.streams.confectionery, b: prev.streams.drinks + prev.streams.confectionery, c: ly.streams.drinks + ly.streams.confectionery },
                { label: 'Gym, pool & lounge', a: now.streams.gym + now.streams.pool + now.streams.lounge, b: prev.streams.gym + prev.streams.pool + prev.streams.lounge, c: ly.streams.gym + ly.streams.pool + ly.streams.lounge },
                { label: 'Total revenue', a: now.revenue, b: prev.revenue, c: ly.revenue, strong: true },
                { label: 'Costs', a: now.costs, b: prev.costs, c: ly.costs, invert: true },
                { label: 'Net profit', a: now.net_profit, b: prev.net_profit, c: ly.net_profit, strong: true },
                { label: 'Occupancy', a: now.kpis.occupancy, b: prev.kpis.occupancy, c: ly.kpis.occupancy, kind: 'pct' as const },
                { label: 'ADR', a: now.kpis.adr, b: prev.kpis.adr, c: ly.kpis.adr },
                { label: 'RevPAR', a: now.kpis.revpar, b: prev.kpis.revpar, c: ly.kpis.revpar },
              ].map((r) => (
                <TableRow key={r.label} className={r.strong ? 'font-semibold' : ''}>
                  <TableCell className="pl-5">{r.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.kind === 'pct' ? pct(r.a) : naira(r.a)}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">{r.kind === 'pct' ? pct(r.b) : naira(r.b)}</TableCell>
                  <TableCell className="text-right text-xs"><Delta now={r.a} before={r.b} invert={r.invert} points={r.kind === 'pct'} /></TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">{lyHasData ? (r.kind === 'pct' ? pct(r.c) : naira(r.c)) : '—'}</TableCell>
                  <TableCell className="pr-5 text-right text-xs">{lyHasData ? <Delta now={r.a} before={r.c} invert={r.invert} points={r.kind === 'pct'} /> : <span className="text-muted-foreground">no data</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      {/* Twelve months */}
      <div className="mb-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Section title="Revenue, last 12 months" description="By where it came from" flush>
          <ChartContainer config={trendChart} className="aspect-auto h-80 w-full px-2 pt-4 pb-2">
            <BarChart data={trendRows} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
              <YAxis tickFormatter={(x) => nairaShort(x)} tickLine={false} axisLine={false} width={56} fontSize={11} />
              <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<ChartTooltipContent indicator="dot" formatter={(val, name) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="text-muted-foreground">{trendChart[name as keyof typeof trendChart]?.label}</span>
                  <span className="tabular-nums">{naira(Number(val))}</span>
                </div>
              )} />} />
              <Bar dataKey="rooms" stackId="a" fill="var(--color-rooms)" stroke="var(--card)" strokeWidth={2} />
              <Bar dataKey="bar" stackId="a" fill="var(--color-bar)" stroke="var(--card)" strokeWidth={2} />
              <Bar dataKey="other" stackId="a" fill="var(--color-other)" stroke="var(--card)" strokeWidth={2} radius={[4, 4, 0, 0]} />
              <ChartLegend content={<ChartLegendContent />} />
            </BarChart>
          </ChartContainer>
        </Section>
        <Section title="Net profit, last 12 months" description="After every cost, including payroll" flush>
          <ChartContainer config={profitChart} className="aspect-auto h-80 w-full px-2 pt-4 pb-2">
            <LChart data={trendRows} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
              <YAxis tickFormatter={(x) => nairaShort(x)} tickLine={false} axisLine={false} width={56} fontSize={11} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <ChartTooltip cursor={{ stroke: 'var(--border)' }} content={<ChartTooltipContent indicator="line" formatter={(val) => <span className="tabular-nums">{naira(Number(val))}</span>} />} />
              <Line dataKey="net_profit" type="monotone" stroke="var(--color-net_profit)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: 'var(--card)' }} activeDot={{ r: 5 }} />
            </LChart>
          </ChartContainer>
        </Section>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Risks r={d.risks} />
        <ActivityFeed className="xl:col-span-1" />
        <div className="space-y-6">
          <Section title="Where bookings came from" description="Booked this month" flush>
            {d.channels.length === 0 ? (
              <EmptyState title="No bookings made this month" className="py-6" />
            ) : (
              <ul className="divide-y">
                {d.channels.map((c) => {
                  const total = d.channels.reduce((a, x) => a + x.revenue, 0) || 1;
                  return (
                    <li key={c.source} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-5 py-3 text-sm">
                      <span className="font-medium">{c.label}</span>
                      <Money value={c.revenue} />
                      <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-chart-1" style={{ width: `${(c.revenue / total) * 100}%` }} />
                      </div>
                      <span className="col-span-2 text-xs text-muted-foreground">{c.bookings} booking{c.bookings > 1 ? 's' : ''} · {c.nights} nights · {pct(c.revenue / total)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
          <Section title="Best-selling at the bar" description="This month" flush>
            {d.top_products.length === 0 ? (
              <EmptyState icon={Package} title="No bar sales yet" className="py-6" />
            ) : (
              <Table>
                <TableBody>
                  {d.top_products.map((p) => (
                    <TableRow key={p.name}>
                      <TableCell className="pl-5">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.units} sold · {naira(p.profit)} profit</div>
                      </TableCell>
                      <TableCell className="pr-5 text-right"><Money value={p.revenue} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        </div>
      </div>

      <Section title="Team performance" description="Money taken and guests checked in this month" flush>
        {d.staff.length === 0 ? (
          <EmptyState title="Nothing recorded yet this month" className="py-6" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-5">Staff</TableHead>
                  <TableHead className="text-right">Bar till</TableHead>
                  <TableHead className="text-right">Receipts</TableHead>
                  <TableHead className="text-right">Room & facility payments</TableHead>
                  <TableHead className="pr-5 text-right">Check-ins</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.staff.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="pl-5 font-medium">{s.name}</TableCell>
                    <TableCell className="text-right"><Money value={s.till} /></TableCell>
                    <TableCell className="text-right tabular-nums">{s.receipts || '—'}</TableCell>
                    <TableCell className="text-right"><Money value={s.collected} /></TableCell>
                    <TableCell className="pr-5 text-right tabular-nums">{s.check_ins || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <TargetsDialog open={editing} month={d.month} targets={d.targets} onClose={() => setEditing(false)} onSaved={() => (setEditing(false), setV((x) => x + 1))} />
    </>
  );
}

function fmtGoal(key: TargetKey, n: number) {
  return key === 'occupancy' ? `${n}%` : nairaShort(n);
}

/** A progress bar against the target, with a tick where the month should be by now and a marker for where it's heading. */
function Goal({ g, expected }: { g: Exec['goals'][number]; expected: number }) {
  const ratio = g.target ? g.actual / g.target : 0;
  const projected = g.projected !== null && g.target ? g.projected / g.target : null;
  const onTrack = projected !== null ? projected >= 1 : ratio >= expected;
  const tone: Tone = projected === null ? (ratio >= 1 ? 'success' : 'neutral') : onTrack ? 'success' : projected >= 0.9 ? 'warning' : 'danger';
  const verdict = projected === null ? (ratio >= 1 ? 'Above target' : 'Below target') : onTrack ? 'On track' : projected >= 0.9 ? 'Close' : 'Behind';
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-medium">{TARGET_LABELS[g.key]}</span>
        <span className="tabular-nums">
          <span className="font-semibold">{fmtGoal(g.key, g.actual)}</span>
          <span className="text-muted-foreground"> of {fmtGoal(g.key, g.target)}</span>
        </span>
      </div>
      <div className="relative h-2.5 rounded-full bg-muted" role="img" aria-label={`${TARGET_LABELS[g.key]}: ${Math.round(ratio * 100)}% of target`}>
        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} />
        {projected !== null && projected > 0 && <div className="absolute -top-1 h-4.5 w-0.5 rounded bg-foreground/70" style={{ left: `${Math.min(100, projected * 100)}%` }} title="Projected month end" />}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
        <span>{Math.round(ratio * 100)}% reached{g.projected !== null ? ` · heading for ${fmtGoal(g.key, g.projected)}` : ''}</span>
        <StatusPill tone={tone}>{verdict}</StatusPill>
      </div>
    </div>
  );
}

function Projected({ label, value, target, raw }: { label: string; value: string; target?: number; raw: number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
      {target !== undefined && (
        <dd className={cn('text-xs', raw >= target ? 'text-success' : 'text-destructive')}>
          {raw >= target ? 'Beats' : 'Misses'} target by {label === 'Occupancy' ? `${Math.abs(raw - target)} pts` : nairaShort(Math.abs(raw - target))}
        </dd>
      )}
    </div>
  );
}

function Risks({ r }: { r: Exec['risks'] }) {
  const items = [
    r.exceptions.high > 0 && { to: '/staff/audit', icon: ShieldAlert, tone: 'danger' as const, text: `${r.exceptions.high} serious exception${r.exceptions.high > 1 ? 's' : ''} this month (${r.exceptions.total} in all)` },
    r.open_queries > 0 && { to: '/staff/audit?tab=queries', icon: ShieldAlert, tone: 'warning' as const, text: `${r.open_queries} auditor quer${r.open_queries > 1 ? 'ies' : 'y'} waiting for an answer` },
    r.cash_variance.n > 0 && { to: '/staff/audit?kind=cash_variance', icon: Wallet, tone: (r.cash_variance.v < 0 ? 'danger' : 'warning') as Tone, text: `Cash drawer off on ${r.cash_variance.n} day${r.cash_variance.n > 1 ? 's' : ''}: net ${naira(r.cash_variance.v)}` },
    r.receivables.overdue > 0 && { to: '/staff/accounts?tab=receivables', icon: Coins, tone: 'warning' as const, text: `${naira(r.receivables.overdue)} owed to the hotel is overdue` },
    r.payables.overdue > 0 && { to: '/staff/accounts?tab=payables', icon: Truck, tone: 'warning' as const, text: `${naira(r.payables.overdue)} of supplier bills overdue` },
    !!r.unclosed_days && { to: '/staff/close-day', icon: Moon, tone: 'neutral' as const, text: `${r.unclosed_days} day${r.unclosed_days > 1 ? 's' : ''} not yet closed and counted` },
    r.low_stock > 0 && { to: '/staff/inventory?tab=insights', icon: Package, tone: 'warning' as const, text: `${r.low_stock} bar item${r.low_stock > 1 ? 's' : ''} running low` },
    r.out_of_order > 0 && { to: '/staff/housekeeping', icon: Wrench, tone: 'danger' as const, text: `${r.out_of_order} room${r.out_of_order > 1 ? 's' : ''} out of order — not earning` },
    r.no_two_step.length > 0 && { to: '/staff/team', icon: KeyRound, tone: 'warning' as const, text: `${r.no_two_step.map((u) => u.name).join(', ')} can see the money without two-step sign-in` },
  ].filter(Boolean) as { to: string; icon: typeof Receipt; tone: Tone; text: string }[];
  return (
    <Section title="Needs the owner's eye" description={items.length ? `${items.length} signal${items.length > 1 ? 's' : ''}` : 'All clear'} flush>
      {items.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="Nothing to worry about" className="py-8">Controls are clean this month.</EmptyState>
      ) : (
        <ul className="divide-y">
          {items.map((a) => (
            <li key={a.text}>
              <Link to={a.to} className="group flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-muted/50">
                <StatusPill tone={a.tone} dot={false} className="size-7 justify-center px-0"><a.icon /></StatusPill>
                <span className="flex-1">{a.text}</span>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function TargetsDialog({ open, month, targets, onClose, onSaved }: { open: boolean; month: string; targets: Record<string, number>; onClose: () => void; onSaved: () => void }) {
  const init = () => Object.fromEntries(TARGET_KEYS.map((k) => [k, targets[k] !== undefined ? String(targets[k]) : ''])) as Record<TargetKey, string>;
  const [f, setF] = useState(init);
  const [key, setKey] = useState('');
  const sig = `${open}-${month}-${JSON.stringify(targets)}`;
  if (key !== sig) (setKey(sig), setF(init()));
  const { busy, error, submit } = useSubmit();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/targets', { method: 'PUT', body: { month, lines: TARGET_KEYS.map((k) => ({ key: k, amount: f[k] === '' ? null : Number(f[k]) })) } });
      toast.success(`Targets for ${fmtMonth(month)} saved`);
      onSaved();
    });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Targets for {fmtMonth(month)}</DialogTitle>
          <DialogDescription>Leave a box empty for no target. Running-cost budgets are set by the accountant under Accounts.</DialogDescription>
        </DialogHeader>
        <form id="targets" className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
          {TARGET_KEYS.map((k) => (
            <Field key={k} label={TARGET_LABELS[k]}>
              {k === 'occupancy' ? (
                <Input inputMode="numeric" className="tabular-nums" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value.replace(/\D/g, '').slice(0, 3) })} placeholder="e.g. 65" />
              ) : (
                <MoneyInput value={f[k]} onChange={(x) => setF({ ...f, [k]: x })} />
              )}
            </Field>
          ))}
          <div className="sm:col-span-2"><ErrorNote error={error} /></div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="targets" disabled={busy}>Save targets</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
