import { ArrowDownLeft, ArrowUpRight, Banknote, Percent, Building2, Coins, Download, FileText, Landmark, Receipt, Scale, Truck, Wallet } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { ALL_PAYMENT_LABELS, PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from '../../../../shared/constants';
import { DateRangePicker, useRange } from '@/components/app/date-range';
import { DateInput, Field, MoneyInput, SelectField } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, Money, PageHeader, Section, StatCard } from '@/components/app/page';
import { StatusPill, type Tone } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, fmtDate, fmtTime, naira, nairaShort, pct, todayISO } from '@/lib/api';
import { can, useAuth } from '@/lib/auth';
import { useApi, useSubmit } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { fmtMonth, recentMonths } from '@/lib/months';
import { cn } from '@/lib/utils';

type Aging = { key: string; label: string }[];
interface CashSummary {
  in: number;
  out: number;
  net: number;
  methods: { method: string; in: number; out: number; net: number }[];
  accounts: { account: 'cash' | 'bank'; in: number; out: number; net: number }[];
}
interface CashRow { dir: 'in' | 'out'; date: string; at: string; source: string; ref: string | null; party: string | null; method: string; amount: number; by: string | null; entity: string; entity_id: number }
interface Overview {
  from: string;
  to: string;
  cash: CashSummary;
  daily: { date: string; in: number; out: number; net: number }[];
  pnl: { totalRevenue: number; netProfit: number; grossProfit: number; totalOperating: number; totalCostOfSales: number; stockValue: number; stockPurchases: number };
  receivables: { total: number; guest_total: number; company_total: number; buckets: Record<string, number>; aging: Aging; top: { kind: 'company' | 'guest'; name: string; amount: number; days: number; id: number }[] };
  payables: { total: number; buckets: Record<string, number>; aging: Aging; due_soon: Bill[] };
  closures: { date: string; expected_cash: number; counted_cash: number; variance: number; notes: string | null; closed_by: string }[];
  variance_total: number;
  last_closed: string | null;
  unclosed_days: number | null;
  budget: Budget;
  open_queries: number;
}
interface Bill { id: number; ref: string; supplier: string; supplier_id: number; date: string; due_date: string; invoice_no: string | null; total: number; paid: number; owed: number; days_late: number; bucket: string }
interface Budget { month: string; elapsed: number; lines: { key: string; label: string; kind: string; budget: number | null; actual: number }[]; total_budget: number; total_actual: number }

const TABS = ['overview', 'cashbook', 'receivables', 'payables', 'budget', 'taxes'] as const;

export default function Accounts() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? params.get('tab')! : 'overview';
  const range = useRange('month');
  return (
    <>
      <PageHeader
        title="Accounts"
        description="Every naira in and out, who owes the hotel, who the hotel owes, and the month's budget."
        actions={(tab === 'overview' || tab === 'cashbook' || tab === 'taxes') && <DateRangePicker state={range} />}
      />
      <Tabs value={tab} onValueChange={(t) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })}>
        <TabsList className="mb-4 h-9 max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview"><Landmark /> Overview</TabsTrigger>
          <TabsTrigger value="cashbook"><Banknote /> Cash book</TabsTrigger>
          <TabsTrigger value="receivables"><ArrowDownLeft /> Owed to us</TabsTrigger>
          <TabsTrigger value="payables"><ArrowUpRight /> We owe</TabsTrigger>
          <TabsTrigger value="budget"><Scale /> Budget</TabsTrigger>
          <TabsTrigger value="taxes"><Percent /> Taxes</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab qs={range.qs} /></TabsContent>
        <TabsContent value="cashbook"><CashBook qs={range.qs} /></TabsContent>
        <TabsContent value="receivables"><Receivables /></TabsContent>
        <TabsContent value="payables"><Payables /></TabsContent>
        <TabsContent value="budget"><BudgetTab /></TabsContent>
        <TabsContent value="taxes"><TaxesTab qs={range.qs} /></TabsContent>
      </Tabs>
    </>
  );
}

const flowChart = {
  in: { label: 'Money in', color: 'var(--chart-2)' },
  out: { label: 'Money out', color: 'var(--chart-4)' },
} satisfies ChartConfig;

function OverviewTab({ qs }: { qs: string }) {
  const v = useLive('money', 'sales', 'stock');
  const { data: d, error } = useApi<Overview>(`/accounts/overview?${qs}&v=${v}`);
  if (error) return <ErrorNote error={error} />;
  if (!d) return <LoadingRows rows={10} />;
  const cash = d.cash.accounts.find((a) => a.account === 'cash')!;
  const bank = d.cash.accounts.find((a) => a.account === 'bank')!;
  const rows = d.daily.map((x) => ({ ...x, label: fmtDate(x.date) }));
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard icon={ArrowDownLeft} label="Money in" value={nairaShort(d.cash.in)} hint={`Out ${nairaShort(d.cash.out)} · net ${nairaShort(d.cash.net)}`} />
        <StatCard icon={Wallet} label="Cash drawer, net" value={<span className={cash.net < 0 ? 'text-destructive' : ''}>{nairaShort(cash.net)}</span>} hint={`In ${nairaShort(cash.in)} · paid out ${nairaShort(cash.out)}`} />
        <StatCard icon={Landmark} label="Bank, net" value={<span className={bank.net < 0 ? 'text-destructive' : ''}>{nairaShort(bank.net)}</span>} hint="Transfers, POS and online" />
        <StatCard icon={Scale} label="Net profit" value={<span className={d.pnl.netProfit < 0 ? 'text-destructive' : ''}>{nairaShort(d.pnl.netProfit)}</span>} hint={`On ${nairaShort(d.pnl.totalRevenue)} earned`} />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Section
          title="Money in and out, each day"
          description="Everything received less refunds, against expenses, supplier bills and stock paid for"
          action={<Button variant="ghost" size="sm" asChild><a href={`/api/accounts/cashbook.csv?${qs}`}><Download /> Cash book</a></Button>}
          flush
        >
          {rows.length > 0 ? (
            <ChartContainer config={flowChart} className="aspect-auto h-72 w-full px-2 pt-4 pb-2">
              <BarChart data={rows} margin={{ top: 4, right: 12, left: 4, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} fontSize={11} />
                <YAxis tickFormatter={(x) => nairaShort(x)} tickLine={false} axisLine={false} width={56} fontSize={11} />
                <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<ChartTooltipContent indicator="dot" formatter={(val, name) => (
                  <div className="flex w-full items-center justify-between gap-4">
                    <span className="text-muted-foreground">{flowChart[name as keyof typeof flowChart]?.label}</span>
                    <span className="tabular-nums">{naira(Number(val))}</span>
                  </div>
                )} />} />
                <Bar dataKey="in" fill="var(--color-in)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="out" fill="var(--color-out)" radius={[4, 4, 0, 0]} />
                <ChartLegend content={<ChartLegendContent />} />
              </BarChart>
            </ChartContainer>
          ) : (
            <EmptyState title="Range too long for a daily chart" />
          )}
        </Section>
        <Section title="By payment method" description="Net of refunds and payments out" flush>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5">Method</TableHead>
                <TableHead className="text-right">In</TableHead>
                <TableHead className="text-right">Out</TableHead>
                <TableHead className="pr-5 text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.cash.methods.map((m) => (
                <TableRow key={m.method}>
                  <TableCell className="pl-5">{ALL_PAYMENT_LABELS[m.method] ?? m.method}</TableCell>
                  <TableCell className="text-right"><Money value={m.in} /></TableCell>
                  <TableCell className="text-right text-muted-foreground"><Money value={m.out} /></TableCell>
                  <TableCell className="pr-5 text-right font-medium"><Money value={m.net} signed /></TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell className="pl-5">Total</TableCell>
                <TableCell className="text-right"><Money value={d.cash.in} /></TableCell>
                <TableCell className="text-right"><Money value={d.cash.out} /></TableCell>
                <TableCell className="pr-5 text-right"><Money value={d.cash.net} signed /></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Section>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Section title="Owed to the hotel" description={`${naira(d.receivables.total)} — guests ${nairaShort(d.receivables.guest_total)}, companies ${nairaShort(d.receivables.company_total)}`} action={<Button variant="ghost" size="sm" asChild><Link to="?tab=receivables">Details</Link></Button>}>
          <AgingBar buckets={d.receivables.buckets} aging={d.receivables.aging} total={d.receivables.total} />
          <ul className="mt-4 divide-y text-sm">
            {d.receivables.top.map((t) => (
              <li key={`${t.kind}-${t.id}`} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  {t.kind === 'company' ? <Building2 className="size-3.5 shrink-0 text-muted-foreground" /> : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
                  <span className="truncate">{t.name}</span>
                </span>
                <span className="flex items-center gap-2">
                  {t.days > 30 && <StatusPill tone="danger">{t.days} days</StatusPill>}
                  <Money value={t.amount} className="font-medium" />
                </span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="The hotel owes" description={`${naira(d.payables.total)} in supplier bills`} action={<Button variant="ghost" size="sm" asChild><Link to="?tab=payables">Pay bills</Link></Button>}>
          <AgingBar buckets={d.payables.buckets} aging={d.payables.aging} total={d.payables.total} />
          {d.payables.due_soon.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nothing due in the next week.</p>
          ) : (
            <ul className="mt-4 divide-y text-sm">
              {d.payables.due_soon.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">{b.supplier} <span className="font-mono text-xs text-muted-foreground">{b.ref}</span></span>
                  <span className="flex items-center gap-2">
                    <DuePill days={b.days_late} due={b.due_date} />
                    <Money value={b.owed} className="font-medium" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Night audit: cash counts"
          description={d.closures.length ? `${d.closures.length} day${d.closures.length > 1 ? 's' : ''} closed · net difference ${naira(d.variance_total)}` : d.last_closed ? `Books closed to ${fmtDate(d.last_closed)}` : 'No days closed yet'}
          flush
        >
          {!!d.unclosed_days && (
            <div className="border-b bg-warning-soft px-5 py-2 text-xs text-warning">{d.unclosed_days} day{d.unclosed_days > 1 ? 's' : ''} not yet closed — their cash hasn't been counted.</div>
          )}
          {d.closures.length === 0 ? (
            <EmptyState icon={Wallet} title="No closed days in this period" className="py-6" />
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <Table>
                <TableBody>
                  {d.closures.map((c) => (
                    <TableRow key={c.date}>
                      <TableCell className="pl-5 tabular-nums">{fmtDate(c.date)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <div className="text-xs">Expected {naira(c.expected_cash)} · counted {naira(c.counted_cash)}</div>
                        {c.notes && <div className="truncate text-xs italic">“{c.notes}”</div>}
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        {c.variance === 0 ? <StatusPill tone="success">Balanced</StatusPill> : <StatusPill tone={c.variance < 0 ? 'danger' : 'warning'}>{c.variance < 0 ? 'Short' : 'Over'} {naira(Math.abs(c.variance))}</StatusPill>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>
        <Section title={`Budget, ${fmtMonth(d.budget.month)}`} description={`${pct(d.budget.elapsed)} of the month gone`} action={<Button variant="ghost" size="sm" asChild><Link to="?tab=budget">Edit</Link></Button>}>
          <BudgetBars b={d.budget} compact />
        </Section>
      </div>
    </>
  );
}

const AGING_TONE = ['bg-chart-3', 'bg-chart-1', 'bg-warning', 'bg-destructive/80', 'bg-destructive'];

/** One stacked bar of how late the money is, with the amounts underneath (so nothing relies on colour). */
function AgingBar({ buckets, aging, total }: { buckets: Record<string, number>; aging: Aging; total: number }) {
  if (!total) return <p className="text-sm text-muted-foreground">Nothing outstanding.</p>;
  return (
    <div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted">
        {aging.map((a, i) => (buckets[a.key] ? <div key={a.key} className={AGING_TONE[i]} style={{ width: `${(buckets[a.key] / total) * 100}%` }} title={`${a.label}: ${naira(buckets[a.key])}`} /> : null))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
        {aging.map((a, i) => (
          <div key={a.key}>
            <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={cn('size-2 rounded-sm', AGING_TONE[i])} />{a.label}</dt>
            <dd className={cn('text-sm font-medium tabular-nums', !buckets[a.key] && 'text-muted-foreground')}>{nairaShort(buckets[a.key] ?? 0)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DuePill({ days, due }: { days: number; due: string }) {
  if (days > 0) return <StatusPill tone="danger">{days}d overdue</StatusPill>;
  if (days === 0) return <StatusPill tone="warning">Due today</StatusPill>;
  return <StatusPill tone={days > -8 ? 'warning' : 'neutral'}>Due {fmtDate(due)}</StatusPill>;
}

// ---------- cash book ----------

function CashBook({ qs }: { qs: string }) {
  const [method, setMethod] = useState('');
  const v = useLive('money', 'sales', 'stock');
  const { data, error } = useApi<{ summary: CashSummary; rows: CashRow[]; untracked_purchases: number }>(`/accounts/cashbook?${qs}&method=${method}&v=${v}`);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SelectField className="w-48" value={method || 'all'} onChange={(m) => setMethod(m === 'all' ? '' : m)} options={[{ value: 'all', label: 'All channels' }, { value: 'cash', label: 'Cash drawer' }, { value: 'bank', label: 'Bank (all)' }, ...['transfer', 'pos', 'online'].map((m) => ({ value: m, label: ALL_PAYMENT_LABELS[m] }))]} />
        {data && (
          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            <span>In <Money value={data.summary.in} className="font-medium text-foreground" /></span>
            <span>Out <Money value={data.summary.out} className="font-medium text-foreground" /></span>
            <span>Net <Money value={data.summary.net} signed className="font-medium text-foreground" /></span>
          </div>
        )}
        <Button variant="outline" size="sm" className="ml-auto" asChild>
          <a href={`/api/accounts/cashbook.csv?${qs}`}><Download /> Download for Excel</a>
        </Button>
      </div>
      {!!data?.untracked_purchases && (
        <p className="mb-3 text-xs text-muted-foreground">{naira(data.untracked_purchases)} of stock purchases in this period were recorded before payment tracking, so they don't appear here.</p>
      )}
      <Card className="gap-0 overflow-hidden py-0 shadow-xs">
        <ErrorNote error={error} />
        {!data ? (
          <LoadingRows rows={10} />
        ) : data.rows.length === 0 ? (
          <EmptyState icon={Banknote} title="No money moved in this period" />
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-5">When</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead className="hidden md:table-cell">Method</TableHead>
                  <TableHead className="hidden lg:table-cell">By</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="pr-5 text-right">Out</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r, i) => (
                  <TableRow key={`${r.entity}-${r.entity_id}-${r.at}-${i}`}>
                    <TableCell className="pl-5 whitespace-nowrap text-muted-foreground tabular-nums">{fmtDate(r.date)} <span className="text-xs">{fmtTime(r.at)}</span></TableCell>
                    <TableCell>
                      <div className="font-medium">{r.source}</div>
                      <div className="max-w-xs truncate text-xs text-muted-foreground">{[r.party, r.ref].filter(Boolean).join(' · ')}</div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{ALL_PAYMENT_LABELS[r.method] ?? r.method}</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">{r.by ?? '—'}</TableCell>
                    <TableCell className="text-right">{r.dir === 'in' ? <Money value={r.amount} className="font-medium" /> : ''}</TableCell>
                    <TableCell className="pr-5 text-right">{r.dir === 'out' ? <Money value={r.amount} className="font-medium text-muted-foreground" /> : ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}

// ---------- receivables ----------

interface Rec {
  total: number;
  guest_total: number;
  company_total: number;
  buckets: Record<string, number>;
  aging: Aging;
  guests: { id: number; code: string; status: string; guest_name: string; phone: string; room_number: string | null; check_out: string; balance: number; days_late: number }[];
  companies: { id: number; name: string; contact_name: string | null; phone: string | null; credit_limit: number; balance: number; oldest_days: number }[];
}

function Receivables() {
  const v = useLive('money', 'reservations');
  const { data: d, error } = useApi<Rec>(`/accounts/receivables?v=${v}`);
  if (error) return <ErrorNote error={error} />;
  if (!d) return <LoadingRows rows={8} />;
  return (
    <>
      <Section title={`${naira(d.total)} owed to the hotel`} description="Company bills fall due 30 days after a stay is billed to them; guests owe from their check-out" className="mb-6">
        <AgingBar buckets={d.buckets} aging={d.aging} total={d.total} />
      </Section>
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Company accounts" description={naira(d.company_total)} flush>
          {d.companies.length === 0 ? (
            <EmptyState icon={Building2} title="No company owes anything" className="py-8" />
          ) : (
            <Table>
              <TableBody>
                {d.companies.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="pl-5">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{[c.contact_name, c.phone].filter(Boolean).join(' · ') || 'No contact saved'}{c.credit_limit ? ` · limit ${nairaShort(c.credit_limit)}` : ''}</div>
                    </TableCell>
                    <TableCell>{c.oldest_days > 30 ? <StatusPill tone={c.oldest_days > 60 ? 'danger' : 'warning'}>Oldest {c.oldest_days} days</StatusPill> : <StatusPill>Within terms</StatusPill>}</TableCell>
                    <TableCell className="text-right"><Money value={c.balance} className="font-medium" /></TableCell>
                    <TableCell className="pr-5 text-right">
                      <Button variant="ghost" size="sm" asChild><Link to={`/staff/statement/${c.id}`} target="_blank">Statement</Link></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
        <Section title="Guests" description={naira(d.guest_total)} flush>
          {d.guests.length === 0 ? (
            <EmptyState icon={Coins} title="Every guest bill is settled" className="py-8" />
          ) : (
            <Table>
              <TableBody>
                {d.guests.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="pl-5">
                      <div className="font-medium">{g.guest_name}</div>
                      <div className="text-xs text-muted-foreground">{g.code}{g.room_number ? ` · room ${g.room_number}` : ''} · {g.phone}</div>
                    </TableCell>
                    <TableCell>{g.status === 'checked_in' ? <StatusPill tone="info">In house</StatusPill> : <StatusPill tone="danger">Left {g.days_late}d ago</StatusPill>}</TableCell>
                    <TableCell className="text-right"><Money value={g.balance} className="font-medium" /></TableCell>
                    <TableCell className="pr-5 text-right">
                      <Button variant="ghost" size="sm" asChild><Link to={`/staff/invoice/${g.id}`} target="_blank">Bill</Link></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>
    </>
  );
}

// ---------- payables ----------

function Payables() {
  const { user } = useAuth();
  const writer = can(user, 'manager', 'accountant');
  const v = useLive('money', 'stock');
  const [tick, setTick] = useState(0);
  const { data: d, error } = useApi<{ total: number; buckets: Record<string, number>; aging: Aging; bills: Bill[] }>(`/payables?v=${v + tick}`);
  const [paying, setPaying] = useState<Bill | null>(null);
  if (error) return <ErrorNote error={error} />;
  if (!d) return <LoadingRows rows={8} />;
  return (
    <>
      <Section title={`${naira(d.total)} owed to suppliers`} description="Deliveries taken on credit, by how late they are" className="mb-6" action={<Button variant="ghost" size="sm" asChild><Link to="/staff/suppliers">Suppliers</Link></Button>}>
        <AgingBar buckets={d.buckets} aging={d.aging} total={d.total} />
      </Section>
      <Card className="gap-0 overflow-hidden py-0 shadow-xs">
        {d.bills.length === 0 ? (
          <EmptyState icon={Truck} title="No unpaid supplier bills">Deliveries recorded “on credit” appear here until they are paid.</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5">Supplier</TableHead>
                <TableHead className="hidden md:table-cell">Delivered</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Bill</TableHead>
                <TableHead className="text-right">Owed</TableHead>
                {writer && <TableHead className="pr-5" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.bills.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="pl-5">
                    <div className="font-medium">{b.supplier}</div>
                    <div className="font-mono text-xs text-muted-foreground">{b.ref}{b.invoice_no ? ` · ${b.invoice_no}` : ''}</div>
                  </TableCell>
                  <TableCell className="hidden tabular-nums md:table-cell">{fmtDate(b.date)}</TableCell>
                  <TableCell><DuePill days={b.days_late} due={b.due_date} /></TableCell>
                  <TableCell className="hidden text-right text-muted-foreground sm:table-cell"><Money value={b.total} />{b.paid > 0 && <div className="text-xs">paid {naira(b.paid)}</div>}</TableCell>
                  <TableCell className="text-right"><Money value={b.owed} className="font-semibold" /></TableCell>
                  {writer && (
                    <TableCell className="pr-5 text-right">
                      <Button size="sm" variant="outline" onClick={() => setPaying(b)}>Pay</Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <PayBill bill={paying} onClose={() => setPaying(null)} onPaid={() => (setPaying(null), setTick((x) => x + 1))} />
    </>
  );
}

export function PayBill({ bill, onClose, onPaid }: { bill: { id: number; ref: string; supplier: string; owed: number } | null; onClose: () => void; onPaid: () => void }) {
  const [f, setF] = useState({ amount: '', method: 'transfer' as PaymentMethod, reference: '', date: todayISO() });
  const [key, setKey] = useState<number | null>(null);
  if (bill && key !== bill.id) (setKey(bill.id), setF({ amount: String(bill.owed), method: 'transfer', reference: '', date: todayISO() }));
  const { busy, error, submit } = useSubmit();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api(`/purchases/${bill!.id}/payments`, { body: { ...f, amount: Number(f.amount) } });
      toast.success(`Paid ${naira(Number(f.amount))} to ${bill!.supplier}`);
      onPaid();
    });
  };
  return (
    <Dialog open={!!bill} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pay {bill?.supplier}</DialogTitle>
          <DialogDescription>Bill {bill?.ref} · {naira(bill?.owed ?? 0)} owed. Part payments are fine.</DialogDescription>
        </DialogHeader>
        <form id="paybill" className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
          <Field label="Amount"><MoneyInput value={f.amount} onChange={(x) => setF({ ...f, amount: x })} required /></Field>
          <Field label="Paid by"><SelectField value={f.method} onChange={(x) => setF({ ...f, method: x as PaymentMethod })} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_LABELS[m] }))} /></Field>
          <Field label="Date"><DateInput value={f.date} max={todayISO()} onChange={(x) => setF({ ...f, date: x })} /></Field>
          <Field label="Reference"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} maxLength={80} placeholder="Transfer ref (optional)" /></Field>
          <div className="sm:col-span-2"><ErrorNote error={error} /></div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="paybill" disabled={busy || !Number(f.amount)}>Record payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- budget ----------

function BudgetBars({ b, compact }: { b: Budget; compact?: boolean }) {
  const lines = b.lines.filter((l) => l.budget || l.actual);
  if (!lines.length) return <p className="text-sm text-muted-foreground">No budget set and nothing spent yet.</p>;
  return (
    <div className="space-y-3">
      {(compact ? [...lines].sort((x, y) => (y.budget ? y.actual / y.budget : 0) - (x.budget ? x.actual / x.budget : 0)).slice(0, 6) : lines).map((l) => {
        const used = l.budget ? l.actual / l.budget : null;
        const tone: Tone = used === null ? 'neutral' : used > 1 ? 'danger' : used > b.elapsed + 0.1 ? 'warning' : 'success';
        return (
          <div key={l.key} className="text-sm">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate">{l.label}</span>
              <span className="shrink-0 tabular-nums"><Money value={l.actual} />{l.budget ? <span className="text-muted-foreground"> / {nairaShort(l.budget)}</span> : <span className="text-muted-foreground"> · no budget</span>}</span>
            </div>
            <div className="relative h-1.5 rounded-full bg-muted">
              {used !== null && <div className={cn('h-full rounded-full', tone === 'danger' ? 'bg-destructive' : tone === 'warning' ? 'bg-warning' : 'bg-chart-3')} style={{ width: `${Math.min(100, used * 100)}%` }} />}
              {used !== null && <div className="absolute -top-0.5 h-2.5 w-px bg-foreground/50" style={{ left: `${b.elapsed * 100}%` }} title="How far through the month we are" />}
            </div>
          </div>
        );
      })}
      {!compact && (
        <div className="flex justify-between border-t pt-3 text-sm font-semibold">
          <span>Total</span>
          <span className="tabular-nums"><Money value={b.total_actual} /> <span className="font-normal text-muted-foreground">of {naira(b.total_budget)}</span></span>
        </div>
      )}
    </div>
  );
}

function BudgetTab() {
  const { user } = useAuth();
  const writer = can(user, 'manager', 'accountant');
  const [month, setMonth] = useState(recentMonths()[0]);
  const [tick, setTick] = useState(0);
  const v = useLive('money');
  const { data: b, error } = useApi<Budget>(`/accounts/budget?month=${month}&v=${v + tick}`);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loadedFor, setLoadedFor] = useState('');
  if (b && loadedFor !== `${b.month}-${tick}`) (setLoadedFor(`${b.month}-${tick}`), setDraft(Object.fromEntries(b.lines.map((l) => [l.key, l.budget === null ? '' : String(l.budget)]))));
  const { busy, error: saveErr, submit } = useSubmit();
  const save = () =>
    submit(async () => {
      await api('/targets', { method: 'PUT', body: { month, lines: b!.lines.map((l) => ({ key: `expense:${l.key}`, amount: draft[l.key] === '' ? null : Number(draft[l.key]) })) } });
      toast.success(`Budget for ${fmtMonth(month)} saved`);
      setTick((x) => x + 1);
    });
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_420px]">
      <Section
        title={`Running costs, ${fmtMonth(month)}`}
        description={b ? `${pct(b.elapsed)} of the month gone · the thin line marks where spending “should” be by now` : ''}
        action={<SelectField className="w-40" value={month} onChange={setMonth} options={recentMonths().map((m) => ({ value: m, label: fmtMonth(m) }))} />}
      >
        <ErrorNote error={error} />
        {b ? <BudgetBars b={b} /> : <LoadingRows rows={6} />}
      </Section>
      {writer && b && (
        <Section title="Set the budget" description="Monthly amount for each cost. Leave empty for no budget.">
          <div className="grid gap-3">
            {b.lines.map((l) => (
              <div key={l.key} className="grid grid-cols-[1fr_150px] items-center gap-3 text-sm">
                <label htmlFor={`b-${l.key}`} className="truncate">{l.label}</label>
                <MoneyInput id={`b-${l.key}`} value={draft[l.key] ?? ''} onChange={(x) => setDraft({ ...draft, [l.key]: x })} />
              </div>
            ))}
            <ErrorNote error={saveErr} />
            <Button onClick={save} disabled={busy}><Receipt /> Save budget</Button>
          </div>
        </Section>
      )}
    </div>
  );
}

// ---------- taxes ----------

type TaxLine = { name: string; rate: number; base: number; amount: number };
interface TaxData {
  configured: { name: string; rate: number; applies: string[] }[];
  tax_id: string;
  taxes: TaxLine[];
  groups: { key: string; label: string; gross: number; taxes: TaxLine[] }[];
  months: { month: string; from: string; to: string; taxes: TaxLine[] }[];
}

function TaxesTab({ qs }: { qs: string }) {
  const { user } = useAuth();
  const v = useLive('money', 'sales', 'reservations');
  const { data: d, error } = useApi<TaxData>(`/accounts/taxes?${qs}&v=${v}`);
  if (error) return <ErrorNote error={error} />;
  if (!d) return <LoadingRows rows={6} />;
  if (!d.configured.length)
    return (
      <Card className="py-0 shadow-xs">
        <EmptyState icon={Percent} title="No taxes set up" action={can(user, 'manager') && <Button size="sm" asChild><Link to="/staff/settings">Set up taxes</Link></Button>}>
          Add VAT and any state consumption tax under Settings → Hotel details. Prices stay as they are; this page then shows the tax inside your takings.
        </EmptyState>
      </Card>
    );
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {d.configured.map((c) => {
          const t = d.taxes.find((x) => x.name === c.name);
          return <StatCard key={c.name} icon={Percent} label={`${c.name} (${c.rate}%)`} value={naira(t?.amount ?? 0)} hint={`On ${nairaShort(t?.base ?? 0)} of sales before tax`} />;
        })}
        <StatCard label="Owed to government" value={naira(d.taxes.reduce((a, t) => a + t.amount, 0))} hint={d.tax_id ? `TIN ${d.tax_id}` : 'Add your TIN in Settings'} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="By month" description="For filing returns. Revenue counts when it is earned, as on the profit & loss." action={<Button variant="ghost" size="sm" asChild><a href={`/api/accounts/taxes.csv?${qs}`}><Download /> Export</a></Button>} flush>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5">Month</TableHead>
                {d.configured.map((c) => <TableHead key={c.name} className="text-right last:pr-5">{c.name}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.months.map((m) => (
                <TableRow key={m.month}>
                  <TableCell className="pl-5">{fmtMonth(m.month)}</TableCell>
                  {d.configured.map((c) => <TableCell key={c.name} className="text-right last:pr-5"><Money value={m.taxes.find((x) => x.name === c.name)?.amount ?? 0} /></TableCell>)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
        <Section title="By what was sold" description="Sales including tax, and the tax inside them" flush>
          <Table>
            <TableBody>
              {d.groups.filter((g) => g.gross > 0).map((g) => (
                <TableRow key={g.key}>
                  <TableCell className="pl-5">
                    <div className="font-medium">{g.label}</div>
                    <div className="text-xs text-muted-foreground">{g.taxes.length ? g.taxes.map((t) => `${t.name} ${naira(t.amount)}`).join(' · ') : 'No tax applies'}</div>
                  </TableCell>
                  <TableCell className="pr-5 text-right"><Money value={g.gross} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      </div>
    </>
  );
}
