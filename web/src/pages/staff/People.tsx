import { CalendarDays, ChevronLeft, ChevronRight, FileText, Plus, Users, Wallet } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from '../../../../shared/constants';
import { DateInput, Field, MoneyInput, SelectField, useConfirm } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, Money, PageHeader, Section, StatCard } from '@/components/app/page';
import { StatusPill, type Tone } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { addDays, api, fmtDate, naira, nairaShort, todayISO } from '@/lib/api';
import { can, useAuth } from '@/lib/auth';
import { useApi, useSubmit } from '@/lib/hooks';
import { fmtMonth, recentMonths } from '@/lib/months';
import { cn } from '@/lib/utils';

export const DEPARTMENTS: Record<string, string> = {
  management: 'Management',
  front_office: 'Front office',
  housekeeping: 'Housekeeping',
  bar: 'Bar',
  kitchen: 'Kitchen',
  facilities: 'Pool & gym',
  security: 'Security',
  maintenance: 'Maintenance',
  general: 'General',
};

export interface Employee {
  id: number;
  name: string;
  position: string;
  department: string;
  active: number;
  user_id: number | null;
  username?: string | null;
  phone?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
  start_date?: string | null;
  monthly_salary?: number;
  pension?: number;
  notes?: string | null;
}

export default function People() {
  const { user } = useAuth();
  const pay = can(user, 'manager', 'accountant', 'auditor');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? (pay ? 'staff' : 'rota');
  return (
    <>
      <PageHeader title={pay ? 'Staff & payroll' : 'Rota'} description={pay ? 'Everyone who works here, their shifts, and each month’s pay.' : 'Who is on, and when.'} />
      <Tabs value={tab} onValueChange={(t) => setParams({ tab: t }, { replace: true })}>
        {pay && (
          <TabsList className="mb-4 h-9">
            <TabsTrigger value="staff"><Users /> Staff</TabsTrigger>
            <TabsTrigger value="rota"><CalendarDays /> Rota</TabsTrigger>
            <TabsTrigger value="payroll"><Wallet /> Payroll</TabsTrigger>
          </TabsList>
        )}
        {pay && <TabsContent value="staff"><StaffList /></TabsContent>}
        <TabsContent value="rota"><Rota /></TabsContent>
        {pay && <TabsContent value="payroll"><Payroll /></TabsContent>}
      </Tabs>
    </>
  );
}

// ---------- staff ----------

function StaffList() {
  const { user } = useAuth();
  const manager = can(user, 'manager');
  const { data, error, reload } = useApi<Employee[]>('/employees?all=1');
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <LoadingRows rows={8} />;
  const active = data.filter((e) => e.active);
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="On the payroll" value={active.length} />
        <StatCard label="Monthly pay" value={nairaShort(active.reduce((a, e) => a + (e.monthly_salary ?? 0), 0))} hint="Before deductions" />
        <StatCard label="With a sign-in" value={active.filter((e) => e.user_id).length} hint="The rest are on the payroll only" />
        <StatCard label="Departments" value={new Set(active.map((e) => e.department)).size} />
      </div>
      <Card className="gap-0 overflow-hidden py-0 shadow-xs">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <span className="text-sm font-semibold">Staff</span>
          {manager && <Button size="sm" onClick={() => setEditing('new')}><Plus /> Add staff member</Button>}
        </div>
        {data.length === 0 ? (
          <EmptyState icon={Users} title="No staff records yet">Add everyone who is paid, including staff who never sign in.</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5">Name</TableHead>
                <TableHead className="hidden md:table-cell">Department</TableHead>
                <TableHead className="hidden lg:table-cell">Bank</TableHead>
                <TableHead className="text-right">Monthly pay</TableHead>
                <TableHead className="pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((e) => (
                <TableRow key={e.id} className={e.active ? '' : 'opacity-50'}>
                  <TableCell className="pl-5">
                    <div className="font-medium">{e.name}</div>
                    <div className="text-xs text-muted-foreground">{e.position}{e.username ? ` · signs in as @${e.username}` : ''}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{DEPARTMENTS[e.department] ?? e.department}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{e.bank_name ? `${e.bank_name} · ${e.account_number ?? ''}` : '—'}</TableCell>
                  <TableCell className="text-right"><Money value={e.monthly_salary ?? 0} /></TableCell>
                  <TableCell className="pr-5 text-right">{manager && <Button variant="ghost" size="sm" onClick={() => setEditing(e)}>Edit</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <EmployeeDialog employee={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), reload())} />
    </>
  );
}

function EmployeeDialog({ employee, onClose, onSaved }: { employee: Employee | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const e = employee && employee !== 'new' ? employee : null;
  const users = useApi<{ id: number; name: string; username: string; active: number }[]>(employee ? '/users' : null);
  const init = () => ({
    name: e?.name ?? '', position: e?.position ?? '', department: e?.department ?? 'general', phone: e?.phone ?? '', bank_name: e?.bank_name ?? '', account_number: e?.account_number ?? '',
    start_date: e?.start_date ?? '', monthly_salary: String(e?.monthly_salary ?? ''), pension: e ? !!e.pension : true, user_id: e?.user_id ? String(e.user_id) : '', notes: e?.notes ?? '', active: e ? !!e.active : true,
  });
  const [f, setF] = useState(init);
  const [key, setKey] = useState<typeof employee>(null);
  if (key !== employee) (setKey(employee), setF(init()));
  const { busy, error, submit } = useSubmit();
  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    submit(async () => {
      await api(e ? `/employees/${e.id}` : '/employees', { method: e ? 'PUT' : 'POST', body: { ...f, monthly_salary: Number(f.monthly_salary || 0), user_id: f.user_id ? Number(f.user_id) : null } });
      toast.success(e ? 'Saved' : `${f.name} added`);
      onSaved();
    });
  };
  return (
    <Dialog open={!!employee} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{e ? `Edit ${e.name}` : 'Add a staff member'}</DialogTitle></DialogHeader>
        <form id="employee" className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
          <Field label="Full name" className="sm:col-span-2"><Input value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} required maxLength={80} /></Field>
          <Field label="Position"><Input value={f.position} onChange={(x) => setF({ ...f, position: x.target.value })} required maxLength={60} placeholder="Housekeeper" /></Field>
          <Field label="Department"><SelectField value={f.department} onChange={(x) => setF({ ...f, department: x })} options={Object.entries(DEPARTMENTS).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Monthly pay" hint="Basic, before deductions"><MoneyInput value={f.monthly_salary} onChange={(x) => setF({ ...f, monthly_salary: x })} required /></Field>
          <Field label="Started"><DateInput value={f.start_date} max={todayISO()} onChange={(x) => setF({ ...f, start_date: x })} placeholder="Optional" /></Field>
          <Field label="Phone"><Input type="tel" value={f.phone} onChange={(x) => setF({ ...f, phone: x.target.value })} maxLength={20} /></Field>
          <Field label="Signs in as" hint="Only if they use the system">
            <SelectField value={f.user_id || 'none'} onChange={(x) => setF({ ...f, user_id: x === 'none' ? '' : x })} options={[{ value: 'none', label: 'No sign-in' }, ...(users.data ?? []).filter((u) => u.active).map((u) => ({ value: String(u.id), label: `${u.name} (@${u.username})` }))]} />
          </Field>
          <Field label="Bank"><Input value={f.bank_name} onChange={(x) => setF({ ...f, bank_name: x.target.value })} maxLength={60} placeholder="GTBank" /></Field>
          <Field label="Account number"><Input inputMode="numeric" value={f.account_number} onChange={(x) => setF({ ...f, account_number: x.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="10 digits" className="font-mono" /></Field>
          <label className="flex items-center gap-3 text-sm sm:col-span-2"><Switch checked={f.pension} onCheckedChange={(x) => setF({ ...f, pension: x })} /> Pension deducted (8%)</label>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(x) => setF({ ...f, notes: x.target.value })} rows={2} maxLength={300} /></Field>
          {e && <label className="flex items-center gap-3 text-sm sm:col-span-2"><Switch checked={f.active} onCheckedChange={(x) => setF({ ...f, active: x })} /> Still works here</label>}
          <div className="sm:col-span-2"><ErrorNote error={error} /></div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="employee" disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- rota ----------

const SHIFT: Record<string, { label: string; short: string; tone: Tone }> = {
  morning: { label: 'Morning', short: 'AM', tone: 'info' },
  afternoon: { label: 'Afternoon', short: 'PM', tone: 'brand' },
  night: { label: 'Night', short: 'Night', tone: 'neutral' },
  off: { label: 'Off', short: 'Off', tone: 'success' },
  leave: { label: 'Leave', short: 'Leave', tone: 'warning' },
};
const CYCLE = ['morning', 'afternoon', 'night', 'off', 'leave', ''];

interface RotaData { week: string; days: string[]; employees: Employee[]; shifts: { employee_id: number; date: string; shift: string }[] }

function Rota() {
  const { user } = useAuth();
  const manager = can(user, 'manager');
  const [week, setWeek] = useState(todayISO());
  const { data, error, reload } = useApi<RotaData>(`/rota?week=${week}`);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const { busy, submit } = useSubmit();
  if (error) return <ErrorNote error={error} />;
  if (!data) return <LoadingRows rows={8} />;
  const key = (e: number, d: string) => `${e}|${d}`;
  const saved = new Map(data.shifts.map((s) => [key(s.employee_id, s.date), s.shift]));
  const shiftOf = (e: number, d: string) => draft[key(e, d)] ?? saved.get(key(e, d)) ?? '';
  const changed = Object.keys(draft).length;
  const cycle = (e: number, d: string) => {
    if (!manager) return;
    const next = CYCLE[(CYCLE.indexOf(shiftOf(e, d)) + 1) % CYCLE.length];
    setDraft({ ...draft, [key(e, d)]: next });
  };
  const save = () =>
    submit(async () => {
      await api('/rota', { method: 'PUT', body: { changes: Object.entries(draft).map(([k, shift]) => { const [employee_id, date] = k.split('|'); return { employee_id: Number(employee_id), date, shift: shift || null }; }) } });
      toast.success('Rota saved');
      setDraft({});
      reload();
    });
  const me = data.employees.find((e) => e.user_id === user!.id);
  const t = todayISO();
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => (setDraft({}), setWeek(addDays(data.week, -7)))} aria-label="Previous week"><ChevronLeft /></Button>
        <span className="min-w-44 text-center text-sm font-medium">Week of {fmtDate(data.week)}</span>
        <Button variant="outline" size="icon" onClick={() => (setDraft({}), setWeek(addDays(data.week, 7)))} aria-label="Next week"><ChevronRight /></Button>
        <Button variant="ghost" size="sm" onClick={() => (setDraft({}), setWeek(todayISO()))}>This week</Button>
        {manager && <span className="text-xs text-muted-foreground">Tap a box to change the shift.</span>}
        {changed > 0 && <Button className="ml-auto" onClick={save} disabled={busy}>Save {changed} change{changed > 1 ? 's' : ''}</Button>}
      </div>
      {me && (
        <p className="mb-4 text-sm">
          Your week: {data.days.map((d) => `${new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${SHIFT[shiftOf(me.id, d)]?.label ?? '—'}`).join(' · ')}
        </p>
      )}
      <Card className="gap-0 overflow-x-auto py-0 shadow-xs">
        {data.employees.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No staff yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="sticky left-0 bg-muted/40 pl-5">Staff</TableHead>
                {data.days.map((d) => (
                  <TableHead key={d} className={cn('text-center', d === t && 'text-foreground')}>
                    {new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.employees.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="sticky left-0 bg-card pl-5">
                    <div className="font-medium whitespace-nowrap">{e.name}</div>
                    <div className="text-xs text-muted-foreground">{e.position}</div>
                  </TableCell>
                  {data.days.map((d) => {
                    const s = shiftOf(e.id, d);
                    return (
                      <TableCell key={d} className={cn('p-1 text-center', d === t && 'bg-muted/30')}>
                        <button
                          type="button"
                          disabled={!manager}
                          onClick={() => cycle(e.id, d)}
                          className={cn('h-9 w-full min-w-14 rounded-md text-xs disabled:cursor-default', draft[key(e.id, d)] !== undefined && 'ring-2 ring-brand', manager && 'hover:bg-muted')}
                          aria-label={`${e.name}, ${d}: ${SHIFT[s]?.label ?? 'no shift'}`}
                        >
                          {s ? <StatusPill tone={SHIFT[s].tone} dot={false}>{SHIFT[s].short}</StatusPill> : <span className="text-muted-foreground">—</span>}
                        </button>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {Object.values(SHIFT).map((s) => <StatusPill key={s.label} tone={s.tone} dot={false}>{s.short} = {s.label}</StatusPill>)}
      </div>
    </>
  );
}

// ---------- payroll ----------

interface PayLine { id: number; employee_id: number; name: string; position: string; bank_name: string | null; account_number: string | null; basic: number; allowances: number; overtime: number; pension: number; paye: number; other_deductions: number; note: string | null; gross: number; net: number }
interface PayRun { id: number; month: string; status: 'draft' | 'approved' | 'paid'; approved_by_name: string | null; approved_at: string | null; paid_by_name: string | null; paid_on: string | null; method: string | null; lines: PayLine[]; totals: { gross: number; net: number; pension: number; paye: number; other_deductions: number; people: number } }

const RUN_TONE: Record<PayRun['status'], Tone> = { draft: 'warning', approved: 'info', paid: 'success' };
const RUN_LABEL: Record<PayRun['status'], string> = { draft: 'Draft', approved: 'Approved — to pay', paid: 'Paid' };

function Payroll() {
  const { user } = useAuth();
  const writer = can(user, 'manager', 'accountant');
  const manager = can(user, 'manager');
  const [month, setMonth] = useState(recentMonths()[1]);
  const { data, error, reload } = useApi<{ run: PayRun | null; history: { month: string; status: string; people: number }[] }>(`/payroll?month=${month}`);
  const [editing, setEditing] = useState<PayLine | null>(null);
  const [paying, setPaying] = useState(false);
  const confirm = useConfirm();
  const act = (fn: () => Promise<unknown>, msg: string) => fn().then(() => (toast.success(msg), reload()), (e) => toast.error(e.message));
  if (error) return <ErrorNote error={error} />;
  if (!data) return <LoadingRows rows={8} />;
  const r = data.run;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SelectField className="w-48" value={month} onChange={setMonth} options={recentMonths().map((m) => ({ value: m, label: fmtMonth(m) }))} />
        {r && <StatusPill tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</StatusPill>}
        <div className="ml-auto flex flex-wrap gap-2">
          {r && <Button variant="outline" asChild><Link to={`/staff/payslips/${month}`} target="_blank"><FileText /> Payslips</Link></Button>}
          {r?.status === 'draft' && manager && <Button variant="ghost" onClick={async () => (await confirm({ title: `Throw away the ${fmtMonth(month)} draft?`, confirmLabel: 'Throw away', destructive: true })) && act(() => api(`/payroll/${month}`, { method: 'DELETE' }), 'Draft removed')}>Throw away draft</Button>}
          {r?.status === 'draft' && manager && <Button onClick={async () => (await confirm({ title: `Approve ${fmtMonth(month)} pay of ${naira(r.totals.gross)}?`, description: 'After approval, no line can be changed.', confirmLabel: 'Approve' })) && act(() => api(`/payroll/${month}/approve`, { body: {} }), 'Pay approved')}>Approve</Button>}
          {r?.status === 'approved' && writer && <Button onClick={() => setPaying(true)}>Mark as paid</Button>}
        </div>
      </div>
      {!r ? (
        <Card className="py-0 shadow-xs">
          <EmptyState icon={Wallet} title={`No pay run for ${fmtMonth(month)}`} action={writer && <Button size="sm" onClick={() => act(() => api('/payroll', { body: { month } }), 'Pay run drafted from current salaries')}><Plus /> Start {fmtMonth(month)} pay</Button>}>
            It starts from everyone’s monthly pay, with pension at 8% for those enrolled. Add allowances, overtime and PAYE before approving.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="Gross pay" value={nairaShort(r.totals.gross)} hint={`${r.totals.people} staff`} />
            <StatCard label="Take-home" value={nairaShort(r.totals.net)} hint="Paid into bank accounts" />
            <StatCard label="PAYE to remit" value={nairaShort(r.totals.paye)} hint="To the state tax office" />
            <StatCard label="Pension to remit" value={nairaShort(r.totals.pension)} hint="Staff 8% share" />
          </div>
          <Card className="gap-0 overflow-x-auto py-0 shadow-xs">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-5">Staff</TableHead>
                  <TableHead className="text-right">Basic</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Allowances + overtime</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Deductions</TableHead>
                  <TableHead className="text-right">Take-home</TableHead>
                  {r.status === 'draft' && writer && <TableHead className="pr-5" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="pl-5">
                      <div className="font-medium">{l.name}</div>
                      <div className="text-xs text-muted-foreground">{l.position}{l.note ? ` · ${l.note}` : ''}</div>
                    </TableCell>
                    <TableCell className="text-right"><Money value={l.basic} /></TableCell>
                    <TableCell className="hidden text-right md:table-cell"><Money value={l.allowances + l.overtime} /></TableCell>
                    <TableCell className="hidden text-right text-muted-foreground sm:table-cell" title={`Pension ${naira(l.pension)} · PAYE ${naira(l.paye)} · other ${naira(l.other_deductions)}`}><Money value={l.pension + l.paye + l.other_deductions} /></TableCell>
                    <TableCell className="text-right font-semibold"><Money value={l.net} /></TableCell>
                    {r.status === 'draft' && writer && <TableCell className="pr-5 text-right"><Button variant="ghost" size="sm" onClick={() => setEditing(l)}>Adjust</Button></TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <p className="mt-3 text-xs text-muted-foreground">
            {r.approved_by_name && `Approved by ${r.approved_by_name}. `}
            {r.paid_on && `Paid ${fmtDate(r.paid_on)} by ${PAYMENT_LABELS[r.method as PaymentMethod] ?? r.method}${r.paid_by_name ? ` (${r.paid_by_name})` : ''}; booked as a salaries expense.`}
            {' '}PAYE is entered per person: confirm amounts with your accountant under the current tax rules.
          </p>
        </>
      )}
      <AdjustLine line={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), reload())} />
      <MarkPaid month={paying ? month : null} total={r?.totals.gross ?? 0} onClose={() => setPaying(false)} onSaved={() => (setPaying(false), reload())} />
    </>
  );
}

function AdjustLine({ line, onClose, onSaved }: { line: PayLine | null; onClose: () => void; onSaved: () => void }) {
  const fields = ['basic', 'allowances', 'overtime', 'pension', 'paye', 'other_deductions'] as const;
  const labels: Record<(typeof fields)[number], string> = { basic: 'Basic', allowances: 'Allowances', overtime: 'Overtime', pension: 'Pension (8%)', paye: 'PAYE', other_deductions: 'Other deductions (loans, advances)' };
  const init = () => ({ ...Object.fromEntries(fields.map((k) => [k, String(line?.[k] ?? 0)])), note: line?.note ?? '' }) as Record<(typeof fields)[number] | 'note', string>;
  const [f, setF] = useState(init);
  const [key, setKey] = useState<PayLine | null>(null);
  if (key !== line) (setKey(line), setF(init()));
  const { busy, error, submit } = useSubmit();
  const gross = Number(f.basic) + Number(f.allowances) + Number(f.overtime);
  const net = gross - Number(f.pension) - Number(f.paye) - Number(f.other_deductions);
  return (
    <Dialog open={!!line} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{line?.name}</DialogTitle>
          <DialogDescription>{line?.position}</DialogDescription>
        </DialogHeader>
        <form id="payline" className="grid grid-cols-2 gap-3" onSubmit={(e) => (e.preventDefault(), submit(async () => (await api(`/payroll/lines/${line!.id}`, { method: 'PATCH', body: { ...Object.fromEntries(fields.map((k) => [k, Number(f[k] || 0)])), note: f.note } }), onSaved())))}>
          {fields.map((k) => <Field key={k} label={labels[k]} className={k === 'other_deductions' ? 'col-span-2' : ''}><MoneyInput value={f[k]} onChange={(x) => setF({ ...f, [k]: x })} /></Field>)}
          <Field label="Note" className="col-span-2"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={120} placeholder="Salary advance repaid" /></Field>
          <div className="col-span-2 flex justify-between border-t pt-3 text-sm"><span className="text-muted-foreground">Gross {naira(gross)}</span><span className={cn('font-semibold', net < 0 && 'text-destructive')}>Take-home {naira(net)}</span></div>
          <div className="col-span-2"><ErrorNote error={error} /></div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="payline" disabled={busy || net < 0}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MarkPaid({ month, total, onClose, onSaved }: { month: string | null; total: number; onClose: () => void; onSaved: () => void }) {
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const [on, setOn] = useState(todayISO());
  const { busy, error, submit } = useSubmit();
  return (
    <Dialog open={!!month} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark {month && fmtMonth(month)} pay as paid</DialogTitle>
          <DialogDescription>Books {naira(total)} as the month’s salaries expense, once.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Paid by"><SelectField value={method} onChange={(x) => setMethod(x as PaymentMethod)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_LABELS[m] }))} /></Field>
          <Field label="Date"><DateInput value={on} max={todayISO()} onChange={setOn} /></Field>
          <ErrorNote error={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => submit(async () => (await api(`/payroll/${month}/paid`, { body: { method, date: on } }), toast.success('Pay recorded as paid'), onSaved()))}>Record payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
