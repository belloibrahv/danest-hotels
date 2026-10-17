import { CheckCircle2, Download, History, MessageSquareWarning, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ROLE_LABELS, type Role } from '../../../../shared/constants';
import { ActivityFeed } from '@/components/app/activity-feed';
import { DateRangePicker, useRange } from '@/components/app/date-range';
import { Field, SelectField } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, Money, PageHeader, Section, StatCard } from '@/components/app/page';
import { StatusPill, type Tone } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ACTION, RED, describe } from '@/lib/activity';
import { api, fmtDateTime, naira } from '@/lib/api';
import { can, useAuth } from '@/lib/auth';
import { useApi, useSubmit } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { cn } from '@/lib/utils';

type Severity = 'high' | 'medium' | 'low';
interface Query { id: number; kind: string; ref_id: number | null; ref_label: string | null; amount: number | null; question: string; status: 'open' | 'answered' | 'closed'; raised_by_name: string; raised_at: string; answer: string | null; answered_by_name: string | null; answered_at: string | null; closed_by_name: string | null; closed_at: string | null }
interface Ex { kind: string; severity: Severity; date: string; at: string; user: string | null; summary: string; amount: number | null; ref_id: number | null; ref_label: string | null; query: { id: number; status: string } | null }
interface ExData { summary: { total: number; high: number; score: number; by_kind: { kind: string; label: string; severity: Severity; count: number; amount: number }[] }; items: Ex[] }

const SEV_TONE: Record<Severity, Tone> = { high: 'danger', medium: 'warning', low: 'neutral' };
const Q_TONE: Record<Query['status'], Tone> = { open: 'danger', answered: 'warning', closed: 'success' };
const Q_LABEL: Record<Query['status'], string> = { open: 'Waiting for answer', answered: 'Answered', closed: 'Closed' };

export default function Audit() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const trail = can(user, 'manager', 'auditor');
  const tabs = ['exceptions', 'queries', ...(trail ? ['trail'] : [])];
  const tab = tabs.includes(params.get('tab') ?? '') ? params.get('tab')! : 'exceptions';
  const range = useRange('month');
  return (
    <>
      <PageHeader
        title="Audit & controls"
        description={user!.role === 'auditor' ? 'Everything that needs a second look, with your questions to management on record. You can read everything and change nothing.' : 'What the auditor sees: exceptions to review and questions waiting for your answer.'}
        actions={tab !== 'queries' && <DateRangePicker state={range} />}
      />
      <Tabs value={tab} onValueChange={(t) => setParams(t === 'exceptions' ? {} : { tab: t }, { replace: true })}>
        <TabsList className="mb-4 h-9">
          <TabsTrigger value="exceptions"><ShieldAlert /> Exceptions</TabsTrigger>
          <TabsTrigger value="queries"><MessageSquareWarning /> Queries</TabsTrigger>
          {trail && <TabsTrigger value="trail"><History /> Full trail</TabsTrigger>}
        </TabsList>
        <TabsContent value="exceptions"><Exceptions qs={range.qs} kind={params.get('kind') ?? ''} setKind={(k) => setParams(k ? { kind: k } : {}, { replace: true })} /></TabsContent>
        <TabsContent value="queries"><Queries /></TabsContent>
        {trail && <TabsContent value="trail"><Trail qs={range.qs} /></TabsContent>}
      </Tabs>
    </>
  );
}

// ---------- exceptions ----------

function Exceptions({ qs, kind, setKind }: { qs: string; kind: string; setKind: (k: string) => void }) {
  const { user } = useAuth();
  const auditor = user!.role === 'auditor';
  const [tick, setTick] = useState(0);
  const v = useLive('activity', 'queries');
  const { data, error } = useApi<ExData>(`/review/exceptions?${qs}&kind=${kind}&v=${v + tick}`);
  const [asking, setAsking] = useState<Ex | null>(null);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <LoadingRows rows={10} />;
  const s = data.summary;
  const kinds = s.by_kind.filter((k) => k.count > 0);
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard icon={ShieldAlert} label="Exceptions" value={s.total} hint={`${s.high} serious`} />
        <StatCard label="Risk score" value={<span className={s.score > 40 ? 'text-destructive' : s.score > 15 ? 'text-warning' : ''}>{s.score}</span>} hint="Serious 5 · medium 2 · minor 1" />
        <StatCard label="Money given back or voided" value={naira(s.by_kind.filter((k) => k.kind === 'refund' || k.kind === 'void').reduce((a, k) => a + k.amount, 0))} />
        <StatCard label="Stock written off" value={naira(s.by_kind.find((k) => k.kind === 'shrinkage')?.amount ?? 0)} hint="At cost" />
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[260px_1fr]">
        <Section title="By type" flush>
          {kinds.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Clean period" className="py-6" />
          ) : (
            <ul className="p-1.5">
              <li>
                <button onClick={() => setKind('')} className={cn('flex w-full items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted', !kind && 'bg-muted font-medium')}>
                  All <span className="tabular-nums">{s.total}</span>
                </button>
              </li>
              {kinds.map((k) => (
                <li key={k.kind}>
                  <button onClick={() => setKind(kind === k.kind ? '' : k.kind)} className={cn('flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted', kind === k.kind && 'bg-muted font-medium')}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={cn('size-2 shrink-0 rounded-full', k.severity === 'high' ? 'bg-destructive' : k.severity === 'medium' ? 'bg-warning' : 'bg-muted-foreground')} aria-hidden />
                      <span className="truncate">{k.label}</span>
                    </span>
                    <span className="tabular-nums">{k.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Card className="gap-0 overflow-hidden py-0 shadow-xs">
          {data.items.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Nothing to review">No voids, refunds, overrides, cash differences or write-offs in this period.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-5">When</TableHead>
                  <TableHead>What happened</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="pr-5 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((e, i) => (
                  <TableRow key={`${e.kind}-${e.at}-${i}`}>
                    <TableCell className="pl-5 align-top whitespace-nowrap text-muted-foreground tabular-nums">{fmtDateTime(e.at)}</TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill tone={SEV_TONE[e.severity]}>{s.by_kind.find((k) => k.kind === e.kind)?.label ?? e.kind}</StatusPill>
                        {e.ref_label && <span className="font-mono text-xs text-muted-foreground">{e.ref_label}</span>}
                      </div>
                      <div className="mt-1 text-sm whitespace-normal">{e.summary}</div>
                      <div className="text-xs text-muted-foreground">{e.user ?? 'System'}</div>
                    </TableCell>
                    <TableCell className="text-right align-top">{e.amount !== null ? <Money value={e.amount} signed className="font-medium" /> : '—'}</TableCell>
                    <TableCell className="pr-5 text-right align-top">
                      {e.query ? (
                        <StatusPill tone={Q_TONE[e.query.status as Query['status']]}>{Q_LABEL[e.query.status as Query['status']]}</StatusPill>
                      ) : auditor ? (
                        <Button size="sm" variant="outline" onClick={() => setAsking(e)}>Ask</Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
      <RaiseQuery item={asking} onClose={() => setAsking(null)} onSaved={() => (setAsking(null), setTick((x) => x + 1))} />
    </>
  );
}

function RaiseQuery({ item, onClose, onSaved }: { item: Ex | null; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState('');
  const [key, setKey] = useState<Ex | null>(null);
  if (key !== item) (setKey(item), setQ(''));
  const { busy, error, submit } = useSubmit();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/review/queries', { body: { kind: item!.kind, ref_id: item!.ref_id, ref_label: item!.ref_label, amount: item!.amount, question: `${item!.summary}\n\n${q}` } });
      toast.success('Query sent to management');
      onSaved();
    });
  };
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ask management about this</DialogTitle>
          <DialogDescription>{item?.summary}</DialogDescription>
        </DialogHeader>
        <form id="raise" className="grid gap-3" onSubmit={onSubmit}>
          <Field label="Your question"><Textarea value={q} onChange={(e) => setQ(e.target.value)} required minLength={5} maxLength={800} rows={4} placeholder="Who approved this, and is there a receipt?" autoFocus /></Field>
          <ErrorNote error={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="raise" disabled={busy}>Send query</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- queries ----------

function Queries() {
  const { user } = useAuth();
  const auditor = user!.role === 'auditor';
  const [status, setStatus] = useState('');
  const [tick, setTick] = useState(0);
  const v = useLive('queries');
  const { data, error } = useApi<{ counts: Record<string, number>; rows: Query[] }>(`/review/queries?status=${status}&v=${v + tick}`);
  const reload = () => setTick((x) => x + 1);
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_380px]">
      <div>
        <div className="mb-4 flex flex-wrap gap-2">
          {(['', 'open', 'answered', 'closed'] as const).map((s) => (
            <Button key={s || 'all'} size="sm" variant={status === s ? 'secondary' : 'ghost'} onClick={() => setStatus(s)}>
              {s ? Q_LABEL[s] : 'All'}
              {s && data && <span className="ml-1 text-muted-foreground tabular-nums">{data.counts[s]}</span>}
            </Button>
          ))}
        </div>
        <ErrorNote error={error} />
        {!data ? (
          <LoadingRows rows={6} />
        ) : data.rows.length === 0 ? (
          <Card className="py-0 shadow-xs"><EmptyState icon={MessageSquareWarning} title="No queries">{auditor ? 'Use “Ask” on any exception to question management.' : 'The auditor has not raised anything.'}</EmptyState></Card>
        ) : (
          <div className="space-y-4">
            {data.rows.map((q) => <QueryCard key={q.id} q={q} auditor={auditor} onChange={reload} />)}
          </div>
        )}
      </div>
      <ActivityFeed limit={20} className="hidden xl:block" />
    </div>
  );
}

function QueryCard({ q, auditor, onChange }: { q: Query; auditor: boolean; onChange: () => void }) {
  const { user } = useAuth();
  const canAnswer = can(user, 'manager', 'accountant');
  const [text, setText] = useState('');
  const { busy, error, submit } = useSubmit();
  const act = (path: string, body: object, done: string) =>
    submit(async () => {
      await api(`/review/queries/${q.id}/${path}`, { body });
      toast.success(done);
      setText('');
      onChange();
    });
  return (
    <Card className="gap-0 py-0 shadow-xs">
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <StatusPill tone={Q_TONE[q.status]}>{Q_LABEL[q.status]}</StatusPill>
        <span className="text-xs text-muted-foreground">#{q.id} · raised by {q.raised_by_name} · {fmtDateTime(q.raised_at)}</span>
        {q.amount !== null && <Money value={q.amount} signed className="ml-auto text-sm font-medium" />}
      </div>
      <div className="space-y-3 px-5 py-4 text-sm">
        <p className="whitespace-pre-line">{q.question}</p>
        {q.answer && (
          <div className="rounded-md border-l-2 border-brand bg-muted/40 px-3 py-2">
            <div className="mb-1 text-xs text-muted-foreground">Answer from {q.answered_by_name} · {q.answered_at && fmtDateTime(q.answered_at)}</div>
            <p className="whitespace-pre-line">{q.answer}</p>
          </div>
        )}
        {q.status === 'closed' && <p className="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="size-3.5" /> Closed by {q.closed_by_name} {q.closed_at && `· ${fmtDateTime(q.closed_at)}`}</p>}
        {q.status !== 'closed' && (canAnswer || auditor) && (
          <div className="grid gap-2 border-t pt-3">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={1000} placeholder={auditor ? 'Ask a follow-up question…' : 'Your answer…'} />
            <ErrorNote error={error} />
            <div className="flex flex-wrap justify-end gap-2">
              {auditor ? (
                <>
                  <Button size="sm" variant="outline" disabled={busy || text.trim().length < 3} onClick={() => act('follow-up', { question: text }, 'Follow-up sent')}>Follow up</Button>
                  <Button size="sm" disabled={busy} onClick={() => act('close', {}, 'Query closed')}><CheckCircle2 /> Satisfied — close</Button>
                </>
              ) : (
                <Button size="sm" disabled={busy || text.trim().length < 3} onClick={() => act('answer', { answer: text }, 'Answer sent to the auditor')}>Send answer</Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------- full trail ----------

interface TrailRow { id: number; action: string; entity: string; entity_id: number | null; detail: string | null; created_at: string; user: string | null; role: Role | null }

function Trail({ qs }: { qs: string }) {
  const [f, setF] = useState({ user: '', entity: '', action: '', q: '' });
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => (setF((x) => ({ ...x, q: q.trim() })), setPage(0)), 300);
    return () => clearTimeout(t);
  }, [q]);
  const filter = new URLSearchParams({ ...f }).toString();
  const v = useLive('activity');
  const { data, error } = useApi<{ total: number; rows: TrailRow[]; facets: { users: { id: number; name: string; role: Role }[]; entities: string[]; actions: string[] } }>(`/review/trail?${qs}&${filter}&page=${page}&v=${page === 0 ? v : 0}`);
  const set = (k: keyof typeof f, val: string) => (setF({ ...f, [k]: val === 'all' ? '' : val }), setPage(0));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search details…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <SelectField className="w-44" value={f.user || 'all'} onChange={(x) => set('user', x)} options={[{ value: 'all', label: 'Everyone' }, ...(data?.facets.users ?? []).map((u) => ({ value: String(u.id), label: `${u.name} (${ROLE_LABELS[u.role]})` }))]} />
        <SelectField className="w-40" value={f.entity || 'all'} onChange={(x) => set('entity', x)} options={[{ value: 'all', label: 'Any record' }, ...(data?.facets.entities ?? []).map((e) => ({ value: e, label: e.replace(/_/g, ' ') }))]} />
        <SelectField className="w-48" value={f.action || 'all'} onChange={(x) => set('action', x)} options={[{ value: 'all', label: 'Any action' }, ...(data?.facets.actions ?? []).map((a) => ({ value: a, label: ACTION[a] ?? a.replace(/_/g, ' ') }))]} />
        <Button variant="outline" size="sm" className="ml-auto" asChild>
          <a href={`/api/review/trail.csv?${qs}&${filter}`}><Download /> Export</a>
        </Button>
      </div>
      <Card className="gap-0 overflow-hidden py-0 shadow-xs">
        <ErrorNote error={error} />
        {!data ? (
          <LoadingRows rows={10} />
        ) : data.rows.length === 0 ? (
          <EmptyState icon={History} title="No matching activity" />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-5">When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead className="pr-5">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="pl-5 whitespace-nowrap text-muted-foreground tabular-nums">{fmtDateTime(a.created_at)}</TableCell>
                    <TableCell>
                      {a.user ?? <span className="text-muted-foreground">{a.action === 'booking_request' ? 'Guest website' : a.action.startsWith('online') ? 'Paystack' : 'System'}</span>}
                      {a.role && <div className="text-xs text-muted-foreground">{ROLE_LABELS[a.role]}</div>}
                    </TableCell>
                    <TableCell>
                      <span className={RED.test(a.action) ? 'font-medium text-destructive' : ''}>{ACTION[a.action] ?? a.action.replace(/_/g, ' ')}</span>{' '}
                      <span className="text-muted-foreground">{a.entity.replace(/_/g, ' ')}{a.entity_id ? ` #${a.entity_id}` : ''}</span>
                    </TableCell>
                    <TableCell className="max-w-md pr-5 whitespace-normal text-muted-foreground">{describe(a)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t px-5 py-3 text-sm text-muted-foreground">
              <span className="tabular-nums">{page * 100 + 1}–{page * 100 + data.rows.length} of {data.total}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</Button>
                <Button size="sm" variant="outline" disabled={(page + 1) * 100 >= data.total} onClick={() => setPage(page + 1)}>Older</Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

