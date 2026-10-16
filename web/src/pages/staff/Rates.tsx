import { ChevronLeft, ChevronRight, Plus, Tags } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { WEEKDAY_NAMES, type RateRuleKind } from '../../../../shared/constants';
import { DateInput, Field, MoneyInput, SelectField } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, PageHeader, Section } from '@/components/app/page';
import { StatusPill } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { addDays, api, fmtDate, naira, todayISO } from '@/lib/api';
import { useApi, useSubmit } from '@/lib/hooks';
import { cn } from '@/lib/utils';

interface Rule {
  id: number;
  name: string;
  room_type_id: number | null;
  room_type: string | null;
  start_date: string | null;
  end_date: string | null;
  weekdays: string | null;
  kind: RateRuleKind;
  value: number;
  priority: number;
  active: number;
}
interface Grid {
  from: string;
  dates: string[];
  types: { id: number; name: string; rate: number; nights: { date: string; rate: number; rule: string | null }[] }[];
}

const adjustment = (r: Pick<Rule, 'kind' | 'value'>) =>
  r.kind === 'fixed' ? `${naira(r.value)} per night` : r.kind === 'percent' ? `${r.value > 0 ? '+' : ''}${r.value}%` : `${r.value > 0 ? '+' : '−'}${naira(Math.abs(r.value))}`;
const when = (r: Rule) => {
  const parts: string[] = [];
  if (r.start_date || r.end_date) parts.push(`${r.start_date ? fmtDate(r.start_date) : '…'} – ${r.end_date ? fmtDate(r.end_date) : '…'}`);
  if (r.weekdays) parts.push(r.weekdays.split(',').map((d) => WEEKDAY_NAMES[Number(d)]).join(', ') + ' nights');
  return parts.join(' · ') || 'Every night';
};

export default function Rates() {
  const t = todayISO();
  const [from, setFrom] = useState(t);
  const [v, setV] = useState(0);
  const grid = useApi<Grid>(`/rate-calendar?from=${from}&days=14&v=${v}`);
  const rules = useApi<Rule[]>(`/rate-rules?v=${v}`);
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const refresh = () => setV((x) => x + 1);

  const toggle = (r: Rule) =>
    api(`/rate-rules/${r.id}`, { method: 'PUT', body: { ...r, weekdays: r.weekdays?.split(',').map(Number) ?? [], active: !r.active } }).then(
      () => (toast.success(r.active ? `${r.name} paused` : `${r.name} active`), refresh()),
      (e) => toast.error(e.message),
    );

  return (
    <>
      <PageHeader
        title="Rates & seasons"
        description="Base rates live on each room type. Rules raise or lower them for weekends, seasons and promotions."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/staff/settings?tab=rooms">Base rates</Link>
            </Button>
            <Button onClick={() => setEditing('new')}>
              <Plus /> New rule
            </Button>
          </>
        }
      />

      <Section
        title="What each room sells for"
        description="Next 14 nights. Highlighted prices come from a rule — hover to see which."
        action={
          <div className="flex items-center rounded-md border">
            <Button variant="ghost" size="icon" className="size-8 rounded-r-none" disabled={from <= t} onClick={() => setFrom(addDays(from, -14))} aria-label="Earlier">
              <ChevronLeft />
            </Button>
            <Button variant="ghost" size="icon" className="size-8 rounded-l-none border-l" onClick={() => setFrom(addDays(from, 14))} aria-label="Later">
              <ChevronRight />
            </Button>
          </div>
        }
        flush
      >
        {!grid.data ? (
          <LoadingRows rows={4} />
        ) : grid.data.types.length === 0 ? (
          <EmptyState icon={Tags} title="No room types yet" action={<Button asChild size="sm"><Link to="/staff/settings?tab=rooms">Add room types</Link></Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="sticky left-0 bg-muted/40 px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Room type</th>
                  {grid.data.dates.map((d) => {
                    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
                    return (
                      <th key={d} className={cn('px-2 py-2.5 text-center text-xs font-medium text-muted-foreground', (wd === 5 || wd === 6) && 'bg-muted')}>
                        <div>{WEEKDAY_NAMES[wd]}</div>
                        <div className="font-mono text-foreground">{Number(d.slice(8))}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {grid.data.types.map((ty) => (
                  <tr key={ty.id} className="border-b last:border-0">
                    <td className="sticky left-0 bg-card px-5 py-3">
                      <div className="font-medium">{ty.name}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">base {naira(ty.rate)}</div>
                    </td>
                    {ty.nights.map((n) => (
                      <td key={n.date} className="px-1 py-2 text-center">
                        {n.rule ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={cn('inline-block rounded-md px-1.5 py-1 text-xs tabular-nums', n.rate > ty.rate ? 'bg-brand-soft font-medium text-brand-ink' : 'bg-success-soft font-medium text-success')}>
                                {(n.rate / 1000).toFixed(n.rate % 1000 ? 1 : 0)}k
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {n.rule}: {naira(n.rate)}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-xs text-muted-foreground tabular-nums">{(n.rate / 1000).toFixed(n.rate % 1000 ? 1 : 0)}k</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Rules" description="When rules overlap, the higher priority wins, then the one with dates." className="mt-6" flush>
        <ErrorNote error={rules.error} />
        {!rules.data ? (
          <LoadingRows rows={3} />
        ) : rules.data.length === 0 ? (
          <EmptyState icon={Tags} title="No rules yet" action={<Button size="sm" onClick={() => setEditing('new')}><Plus /> Add a weekend rate</Button>}>
            Every night sells at the base rate. Add a rule for weekends, Christmas, or a promotion.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5">Rule</TableHead>
                <TableHead>Applies to</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Change</TableHead>
                <TableHead className="text-right">Priority</TableHead>
                <TableHead>On</TableHead>
                <TableHead className="pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.data.map((r) => (
                <TableRow key={r.id} className={r.active ? '' : 'opacity-55'}>
                  <TableCell className="pl-5 font-medium">{r.name}</TableCell>
                  <TableCell className="text-muted-foreground">{r.room_type ?? 'All rooms'}</TableCell>
                  <TableCell className="text-muted-foreground">{when(r)}</TableCell>
                  <TableCell>
                    <StatusPill tone={r.kind === 'fixed' ? 'info' : r.value >= 0 ? 'brand' : 'success'} dot={false} className="font-mono">
                      {adjustment(r)}
                    </StatusPill>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.priority}</TableCell>
                  <TableCell>
                    <Switch checked={!!r.active} onCheckedChange={() => toggle(r)} aria-label={`Turn ${r.name} ${r.active ? 'off' : 'on'}`} />
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <RuleDialog rule={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), refresh())} />
    </>
  );
}

function RuleDialog({ rule, onClose, onSaved }: { rule: Rule | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const types = useApi<{ id: number; name: string; rate: number }[]>(rule ? '/room-types' : null);
  const existing = rule && rule !== 'new' ? rule : null;
  const init = () => ({
    name: existing?.name ?? '',
    room_type_id: existing?.room_type_id ? String(existing.room_type_id) : 'all',
    kind: (existing?.kind ?? 'percent') as RateRuleKind,
    value: existing ? String(Math.abs(existing.value)) : '',
    direction: existing && existing.value < 0 ? 'down' : 'up',
    start_date: existing?.start_date ?? '',
    end_date: existing?.end_date ?? '',
    weekdays: existing?.weekdays?.split(',') ?? [],
    priority: String(existing?.priority ?? 0),
  });
  const [f, setF] = useState(init);
  const [key, setKey] = useState<Rule | 'new' | null>(null);
  if (key !== rule) (setKey(rule), setF(init()));
  const { busy, error, submit } = useSubmit();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      const value = f.kind === 'fixed' ? Number(f.value) : Number(f.value) * (f.direction === 'down' ? -1 : 1);
      const body = {
        name: f.name, kind: f.kind, value, priority: Number(f.priority || 0),
        room_type_id: f.room_type_id === 'all' ? undefined : Number(f.room_type_id),
        start_date: f.start_date || undefined, end_date: f.end_date || undefined, weekdays: f.weekdays.map(Number),
        active: existing ? !!existing.active : true,
      };
      await api(existing ? `/rate-rules/${existing.id}` : '/rate-rules', { method: existing ? 'PUT' : 'POST', body });
      toast.success(existing ? 'Rule updated' : 'Rule added — new bookings use it straight away');
      onSaved();
    });
  };

  return (
    <Dialog open={!!rule} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? `Edit ${existing.name}` : 'New rate rule'}</DialogTitle>
          <DialogDescription>Existing bookings keep the price they were sold at.</DialogDescription>
        </DialogHeader>
        <form id="rule" className="grid gap-4" onSubmit={onSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={60} placeholder="Weekend, Christmas, Early bird…" />
            </Field>
            <Field label="Applies to">
              <SelectField value={f.room_type_id} onChange={(v) => setF({ ...f, room_type_id: v })} options={[{ value: 'all', label: 'All room types' }, ...(types.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))]} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr]">
            <Field label="Type of change">
              <SelectField value={f.kind} onChange={(v) => setF({ ...f, kind: v as RateRuleKind })} options={[{ value: 'percent', label: 'Percentage' }, { value: 'amount', label: 'Naira amount' }, { value: 'fixed', label: 'Set a price' }]} />
            </Field>
            {f.kind !== 'fixed' && (
              <Field label="Direction">
                <SelectField value={f.direction} onChange={(v) => setF({ ...f, direction: v })} options={[{ value: 'up', label: 'Increase' }, { value: 'down', label: 'Discount' }]} />
              </Field>
            )}
            <Field label={f.kind === 'percent' ? 'Percent' : f.kind === 'fixed' ? 'Price per night' : 'Amount'}>
              {f.kind === 'percent' ? (
                <div className="relative">
                  <Input inputMode="numeric" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value.replace(/\D/g, '') })} required className="pr-7 tabular-nums" />
                  <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
              ) : (
                <MoneyInput value={f.value} onChange={(v) => setF({ ...f, value: v })} required />
              )}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From (optional)">
              <DateInput value={f.start_date} onChange={(v) => setF({ ...f, start_date: v })} placeholder="Any date" />
            </Field>
            <Field label="To (optional)">
              <DateInput value={f.end_date} min={f.start_date || undefined} onChange={(v) => setF({ ...f, end_date: v })} placeholder="Any date" />
            </Field>
          </div>
          <Field label="Only on these nights (optional)" hint="Friday and Saturday nights are a typical weekend rate">
            <ToggleGroup type="multiple" variant="outline" value={f.weekdays} onValueChange={(v) => setF({ ...f, weekdays: v })} className="grid w-full grid-cols-7">
              {WEEKDAY_NAMES.map((d, i) => (
                <ToggleGroupItem key={d} value={String(i)} className="text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  {d}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Field label="Priority" hint="0–100. Higher wins when two rules apply to the same night.">
            <Input inputMode="numeric" className="w-28 tabular-nums" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <ErrorNote error={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="rule" disabled={busy}>{existing ? 'Save rule' : 'Add rule'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
