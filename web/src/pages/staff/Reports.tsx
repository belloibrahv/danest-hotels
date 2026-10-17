import { Download, Printer } from 'lucide-react';
import type { ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { HotelSettings } from '../../../../shared/constants';
import { DateRangePicker, useRange } from '@/components/app/date-range';
import { Letterhead } from '@/components/app/letterhead';
import { ErrorNote, LoadingRows, Money, PageHeader, Section, StatCard } from '@/components/app/page';
import { Button } from '@/components/ui/button';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { fmtDate, fmtDateLong, naira, nairaShort, pct } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { KpiTriplet, type Kpis, type PnL } from './Dashboard';

interface Report extends PnL {
  previous: { from: string; to: string; totalRevenue: number; netProfit: number; kpis: Kpis };
  daily: { date: string; rooms: number; bar: number; facilities: number; expenses: number; occupied: number }[];
  rooms: number;
}

const chart = {
  rooms: { label: 'Rooms', color: 'var(--chart-1)' },
  bar: { label: 'Bar & shop', color: 'var(--chart-2)' },
  facilities: { label: 'Gym, pool & lounge', color: 'var(--chart-3)' },
} satisfies ChartConfig;

function Line({ label, value, indent, strong, total, muted, negative }: { label: ReactNode; value: number; indent?: boolean; strong?: boolean; total?: boolean; muted?: boolean; negative?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 px-5 py-2 text-sm', indent && 'pl-9', strong && 'border-t font-semibold', total && 'border-t-2 border-foreground py-3.5 text-base font-semibold', muted && 'text-muted-foreground')}>
      <span>{label}</span>
      <span className={cn('tabular-nums', total && (value < 0 ? 'text-destructive' : 'text-success'))}>{negative ? `(${naira(value)})` : naira(value)}</span>
    </div>
  );
}
const Heading = ({ children }: { children: ReactNode }) => <div className="px-5 pt-5 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{children}</div>;

export default function Reports() {
  const range = useRange('month');
  const { data: p, error } = useApi<Report>(`/reports/pnl?${range.qs}`);
  const { data: hotel } = useApi<HotelSettings>('/settings');
  const d = (now: number, before: number) => (before ? (now - before) / Math.abs(before) : null);

  return (
    <>
      {hotel && p && (
        <div className="mb-6 hidden print:block">
          <Letterhead hotel={hotel} title="Profit & loss" meta={<div>{fmtDateLong(p.from)} – {fmtDateLong(p.to)}</div>} />
        </div>
      )}
      <div className="print:hidden">
        <PageHeader
          title="Profit & loss"
          description="Everything the hotel earned, less everything it cost, for any period."
          actions={
            <>
              <DateRangePicker state={range} />
              <Button variant="outline" asChild>
                <a href={`/api/reports/pnl.csv?${range.qs}`} download>
                  <Download /> Excel
                </a>
              </Button>
              <Button variant="outline" size="icon" onClick={() => print()} aria-label="Print">
                <Printer />
              </Button>
            </>
          }
        />
      </div>
      <ErrorNote error={error} />
      {!p ? (
        <LoadingRows rows={10} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="Revenue" value={nairaShort(p.totalRevenue)} trend={d(p.totalRevenue, p.previous.totalRevenue) !== null ? { value: d(p.totalRevenue, p.previous.totalRevenue)!, label: 'vs previous period' } : null} />
            <StatCard label="Gross profit" value={nairaShort(p.grossProfit)} hint={`${pct(p.totalRevenue ? p.grossProfit / p.totalRevenue : 0)} after cost of sales`} />
            <StatCard label="Running costs" value={nairaShort(p.totalOperating)} hint={`${pct(p.totalRevenue ? p.totalOperating / p.totalRevenue : 0)} of revenue`} />
            <StatCard
              label="Net profit"
              value={<span className={p.netProfit < 0 ? 'text-destructive' : 'text-success'}>{nairaShort(p.netProfit)}</span>}
              trend={d(p.netProfit, p.previous.netProfit) !== null ? { value: d(p.netProfit, p.previous.netProfit)!, label: 'vs previous period' } : null}
            />
          </div>

          <Section title="Room performance" description={`Compared with ${fmtDate(p.previous.from)} – ${fmtDate(p.previous.to)}`} className="mb-6" flush>
            <KpiTriplet k={p.kpis} previous={p.previous.kpis} />
          </Section>

          <div className="grid items-start gap-6 xl:grid-cols-[1.2fr_1fr]">
            <Section title="Statement" description={`${fmtDateLong(p.from)} – ${fmtDateLong(p.to)}`} flush>
              <div className="pb-2">
                <Heading>Revenue — main business</Heading>
                {p.revenue.filter((r) => r.group === 'core').map((r) => <Line key={r.key} label={r.label} value={r.amount} indent />)}
                <Heading>Revenue — other income</Heading>
                {p.revenue.filter((r) => r.group === 'other').map((r) => <Line key={r.key} label={r.label} value={r.amount} indent />)}
                <Line label="Total revenue" value={p.totalRevenue} strong />
                <Heading>Cost of sales</Heading>
                {p.costOfSales.map((r) => <Line key={r.key} label={r.label} value={r.amount} indent negative />)}
                <Line label="Gross profit" value={p.grossProfit} strong />
                <Heading>Running costs</Heading>
                {p.operating.map((r) => <Line key={r.key} label={r.label} value={r.amount} indent negative />)}
                <Line label="Total running costs" value={p.totalOperating} strong negative />
                <Line label="Net profit" value={p.netProfit} total />
                <Line label="Memo: stock bought in this period" value={p.stockPurchases} muted />
                <Line label="Memo: stock on the shelf today (at cost)" value={p.stockValue} muted />
              </div>
            </Section>

            <div className="space-y-6">
              {p.daily.length > 0 && (
                <Section title="Revenue by day" flush>
                  <ChartContainer config={chart} className="aspect-auto h-64 w-full px-2 pt-4 pb-2">
                    <AreaChart data={p.daily.map((x) => ({ ...x, label: fmtDate(x.date) }))} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} fontSize={11} />
                      <YAxis tickFormatter={(v) => nairaShort(v)} tickLine={false} axisLine={false} width={56} fontSize={11} />
                      <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                      <Area dataKey="rooms" type="monotone" stackId="a" stroke="var(--color-rooms)" fill="var(--color-rooms)" fillOpacity={0.35} strokeWidth={2} />
                      <Area dataKey="bar" type="monotone" stackId="a" stroke="var(--color-bar)" fill="var(--color-bar)" fillOpacity={0.35} strokeWidth={2} />
                      <Area dataKey="facilities" type="monotone" stackId="a" stroke="var(--color-facilities)" fill="var(--color-facilities)" fillOpacity={0.35} strokeWidth={2} />
                      <ChartLegend content={<ChartLegendContent />} />
                    </AreaChart>
                  </ChartContainer>
                </Section>
              )}
              <Section title="Money collected" description="What actually arrived — room bills count once paid">
                <dl className="space-y-2 text-sm">
                  {(
                    [
                      ['cash', 'Cash'],
                      ['transfer', 'Bank transfer'],
                      ['pos', 'POS / card'],
                      ['online', 'Paid online'],
                    ] as const
                  ).map(([k, l]) => (
                    <div key={k} className="flex justify-between">
                      <dt>{l}</dt>
                      <Money value={p.collections.byMethod[k] ?? 0} />
                    </div>
                  ))}
                  <div className="flex justify-between border-t pt-2 font-semibold">
                    <dt>Total collected</dt>
                    <Money value={p.collections.total} />
                  </div>
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">{Object.entries(p.collections.bySource).map(([k, v]) => `${k} ${nairaShort(v)}`).join(' · ')}</p>
              </Section>
              <Section title="How to read this">
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p><b className="text-foreground">Rooms</b> are earned night by night, at the price each night was sold for — whenever the guest pays.</p>
                  <p><b className="text-foreground">Drinks & confectionery</b> are costed at what each item cost when it was sold.</p>
                  <p><b className="text-foreground">Collected</b> is the cash side. Bills on company accounts count when the company pays.</p>
                </div>
              </Section>
            </div>
          </div>
        </>
      )}
    </>
  );
}
