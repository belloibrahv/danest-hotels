import { Receipt, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { EXPENSE_CATEGORIES, PAYMENT_LABELS, PAYMENT_METHODS, type ExpenseCategory, type PaymentMethod } from '../../../../shared/constants';
import { DateRangePicker, useRange } from '@/components/app/date-range';
import { DateInput, Field, MoneyInput, SelectField, useConfirm } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, Money, PageHeader, Section } from '@/components/app/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, fmtDate, naira, todayISO } from '@/lib/api';
import { can, useAuth } from '@/lib/auth';
import { useApi, useSubmit } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { cn } from '@/lib/utils';

interface Data {
  rows: { id: number; date: string; category: ExpenseCategory; description: string; paid_to: string | null; amount: number; method: PaymentMethod; recorded_by: string }[];
  totals: { category: ExpenseCategory; total: number }[];
}
const LABEL = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.key, c.label])) as Record<ExpenseCategory, string>;
const QUICK: { category: ExpenseCategory; description: string }[] = [
  { category: 'diesel', description: 'Diesel for generator' },
  { category: 'electricity', description: 'Prepaid electricity units' },
  { category: 'salaries', description: 'Monthly payroll' },
  { category: 'repairs', description: 'Generator servicing' },
  { category: 'housekeeping', description: 'Toiletries, detergent & laundry' },
];

export default function Expenses() {
  const { user } = useAuth();
  // The auditor reads the expenses; the accountant and management record them.
  const writer = can(user, 'manager', 'accountant');
  const range = useRange('month');
  const { data, error, reload } = useApi<Data>(`/expenses?${range.qs}&v=${useLive('money')}`);
  const [cat, setCat] = useState<ExpenseCategory | 'all'>('all');
  const [f, setF] = useState({ category: 'diesel' as ExpenseCategory, description: '', paid_to: '', amount: '', method: 'transfer' as PaymentMethod, date: todayISO() });
  const { busy, error: saveErr, submit } = useSubmit();
  const confirm = useConfirm();
  const total = data?.totals.reduce((a, t) => a + t.total, 0) ?? 0;
  const max = Math.max(1, ...(data?.totals.map((t) => t.total) ?? []));
  const rows = data?.rows.filter((r) => cat === 'all' || r.category === cat) ?? [];

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/expenses', { body: { ...f, amount: Number(f.amount) } });
      toast.success(`${LABEL[f.category]}: ${naira(Number(f.amount))}`);
      setF({ ...f, description: '', paid_to: '', amount: '' });
      reload();
    });
  };
  const remove = async (id: number, d: string) => {
    if (!(await confirm({ title: 'Delete this expense?', description: `“${d}” — the deletion is kept in the activity log.`, confirmLabel: 'Delete', destructive: true }))) return;
    api(`/expenses/${id}`, { method: 'DELETE' }).then(() => (toast.success('Expense deleted'), reload()), (e) => toast.error(e.message));
  };

  return (
    <>
      <PageHeader title="Expenses" description="Salaries, diesel, NEPA, repairs and every other running cost." actions={<DateRangePicker state={range} />} />
      <div className={cn('grid items-start gap-6', writer && 'xl:grid-cols-[1fr_380px]')}>
        <div className="space-y-6">
          <Section title={<>Spent: <Money value={total} /></>} description="By category — select one to filter the list">
            {!data ? (
              <LoadingRows rows={4} />
            ) : data.totals.length === 0 ? (
              <EmptyState icon={Receipt} title="No expenses in this period" className="py-6" />
            ) : (
              <div className="space-y-2.5">
                {data.totals.map((t) => (
                  <button key={t.category} onClick={() => setCat(cat === t.category ? 'all' : t.category)} className={cn('grid w-full grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-md p-1.5 text-left text-sm transition-colors hover:bg-muted/60', cat === t.category && 'bg-muted')}>
                    <span className={cat === t.category ? 'font-medium' : ''}>{LABEL[t.category] ?? t.category}</span>
                    <Money value={t.total} />
                    <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-chart-4" style={{ width: `${(t.total / max) * 100}%` }} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Section>
          <Section
            title={cat === 'all' ? 'All expenses' : LABEL[cat]}
            action={cat !== 'all' && <Button variant="ghost" size="sm" onClick={() => setCat('all')}>Show all</Button>}
            flush
          >
            <ErrorNote error={error} />
            {rows.length === 0 ? (
              <EmptyState title="Nothing to show" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-5">Date</TableHead>
                    <TableHead>What</TableHead>
                    <TableHead className="hidden md:table-cell">Paid to</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="pr-5" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="pl-5 tabular-nums">{fmtDate(r.date)}</TableCell>
                      <TableCell>
                        {r.description}
                        <div className="text-xs text-muted-foreground">
                          {LABEL[r.category]} · {PAYMENT_LABELS[r.method]} · {r.recorded_by}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{r.paid_to ?? '—'}</TableCell>
                      <TableCell className="text-right font-medium">
                        <Money value={r.amount} />
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        {writer && <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => remove(r.id, r.description)} aria-label={`Delete ${r.description}`}>
                          <Trash2 />
                        </Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        </div>

        {writer && <Section title="Record an expense" className="xl:sticky xl:top-20">
          <form className="grid gap-4" onSubmit={onSubmit}>
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map((q) => (
                <Button key={q.description} type="button" variant={f.category === q.category && f.description === q.description ? 'secondary' : 'outline'} size="sm" className="h-7 text-xs" onClick={() => setF({ ...f, category: q.category, description: q.description })}>
                  {LABEL[q.category].split(' (')[0]}
                </Button>
              ))}
            </div>
            <Field label="Category">
              <SelectField value={f.category} onChange={(v) => setF({ ...f, category: v as ExpenseCategory })} options={EXPENSE_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))} />
            </Field>
            <Field label="What was it for">
              <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required maxLength={200} placeholder="Diesel 200 litres" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} required /></Field>
              <Field label="Paid by">
                <SelectField value={f.method} onChange={(v) => setF({ ...f, method: v as PaymentMethod })} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_LABELS[m] }))} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><DateInput value={f.date} max={todayISO()} onChange={(v) => setF({ ...f, date: v })} /></Field>
              <Field label="Paid to"><Input value={f.paid_to} onChange={(e) => setF({ ...f, paid_to: e.target.value })} maxLength={120} placeholder="Optional" /></Field>
            </div>
            <ErrorNote error={saveErr} />
            <Button size="lg" disabled={busy}>{busy ? 'Saving…' : 'Record expense'}</Button>
          </form>
        </Section>}
      </div>
    </>
  );
}
