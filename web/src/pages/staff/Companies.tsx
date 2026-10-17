import { BedDouble, Building2, Pencil, Plus, Printer, Wallet } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod, type ReservationStatus } from '../../../../shared/constants';
import { DateInput, Field, MoneyInput, SelectField } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, Money, PageHeader, StatCard } from '@/components/app/page';
import { ReservationStatusPill, StatusPill } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { api, fmtDate, naira, todayISO } from '@/lib/api';
import { can, useAuth } from '@/lib/auth';
import { useApi, useSubmit } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { useDesk } from './desk/Desk';

export interface Company {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  discount_pct: number;
  credit_limit: number;
  notes: string | null;
  active: number;
  balance: number;
  stays: number;
  in_house: number;
}
export interface CompanyStatement extends Company {
  charges: { id: number; date: string; amount: number; reservation_id: number; code: string; check_in: string; check_out: string; guest_name: string }[];
  payments: { id: number; date: string; amount: number; method: PaymentMethod; reference: string | null; received_by: string | null }[];
  open_stays: { id: number; code: string; status: ReservationStatus; check_in: string; check_out: string; guest_name: string; bill_to_company: number; balance: number }[];
}

/** Corporate accounts (city ledger): negotiated rates, bills on account, and what each company owes. */
export default function Companies() {
  const { user } = useAuth();
  const [v, setV] = useState(0);
  const { data, error } = useApi<Company[]>(`/companies?all=1&v=${v}`);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<Company | 'new' | null>(null);
  const refresh = () => setV((x) => x + 1);
  const owed = data?.reduce((a, c) => a + Math.max(0, c.balance), 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Company accounts"
        description="Negotiated discounts, stays billed to the company, and what each account owes."
        actions={
          can(user, 'manager') && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> New company
            </Button>
          )
        }
      />
      {data && data.length > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard icon={Building2} label="Active accounts" value={data.filter((c) => c.active).length} />
          <StatCard icon={Wallet} label="Owed to the hotel" value={<Money value={owed} />} hint={`${data.filter((c) => c.balance > 0).length} accounts with a balance`} />
          <StatCard icon={BedDouble} label="Guests in house on account" value={data.reduce((a, c) => a + c.in_house, 0)} />
        </div>
      )}
      <Card className="gap-0 overflow-hidden py-0 shadow-xs">
        <ErrorNote error={error} />
        {!data ? (
          <LoadingRows rows={5} />
        ) : data.length === 0 ? (
          <EmptyState icon={Building2} title="No company accounts yet" action={can(user, 'manager') && <Button size="sm" onClick={() => setEditing('new')}><Plus /> Add a company</Button>}>
            Set up companies that send guests regularly, with their negotiated discount and credit limit.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5">Company</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="hidden text-right md:table-cell">Credit limit</TableHead>
                <TableHead className="text-right">Stays</TableHead>
                <TableHead className="pr-5 text-right">Owes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((c) => (
                <TableRow key={c.id} className={cn('cursor-pointer', !c.active && 'opacity-55')} onClick={() => setOpen(c.id)}>
                  <TableCell className="pl-5">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{[c.contact_name, c.phone].filter(Boolean).join(' · ') || '—'}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.discount_pct ? `${c.discount_pct}%` : '—'}</TableCell>
                  <TableCell className="hidden text-right md:table-cell">{c.credit_limit ? <Money value={c.credit_limit} /> : <span className="text-muted-foreground">No limit</span>}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.stays}
                    {c.in_house > 0 && <StatusPill tone="success" className="ml-2">{c.in_house} in</StatusPill>}
                  </TableCell>
                  <TableCell className="pr-5 text-right">{c.balance > 0 ? <Money value={c.balance} className="font-medium text-destructive" /> : <StatusPill tone="success">Settled</StatusPill>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <StatementSheet id={open} onClose={() => setOpen(null)} onEdit={(c) => setEditing(c)} version={v} onChange={refresh} />
      <CompanyDialog company={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), refresh())} />
    </>
  );
}

function StatementSheet({ id, onClose, onEdit, version, onChange }: { id: number | null; onClose: () => void; onEdit: (c: Company) => void; version: number; onChange: () => void }) {
  const { user } = useAuth();
  const desk = useDesk();
  const { data: s, reload } = useApi<CompanyStatement>(id ? `/companies/${id}?v=${version}` : null);
  const [pay, setPay] = useState({ amount: '', method: 'transfer' as PaymentMethod, date: todayISO(), reference: '' });
  const { busy, error, submit } = useSubmit();

  // One chronological ledger with a running balance — what an accountant expects to see.
  const ledger = s ? ledgerOf(s) : [];

  const record = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api(`/companies/${id}/payments`, { body: { ...pay, amount: Number(pay.amount), reference: pay.reference || undefined } });
      toast.success(`${naira(Number(pay.amount))} received from ${s!.name}`);
      setPay({ ...pay, amount: '', reference: '' });
      reload();
      onChange();
    });
  };

  return (
    <Sheet open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {!s ? (
          <LoadingRows />
        ) : (
          <>
            <SheetHeader className="gap-3 border-b p-5">
              <div className="pr-8">
                <SheetTitle className="text-lg">{s.name}</SheetTitle>
                <SheetDescription>{[s.contact_name, s.phone, s.email].filter(Boolean).join(' · ') || 'No contact details'}</SheetDescription>
              </div>
              <div className="grid grid-cols-3 overflow-hidden rounded-lg border text-sm">
                {[
                  ['Owes', naira(s.balance), s.balance > 0 ? 'text-destructive' : 'text-success'],
                  ['Discount', s.discount_pct ? `${s.discount_pct}%` : 'None', ''],
                  ['Credit limit', s.credit_limit ? naira(s.credit_limit) : 'No limit', ''],
                ].map(([k, val, c], i) => (
                  <div key={k} className={cn('px-3 py-2.5', i < 2 && 'border-r')}>
                    <div className="text-xs text-muted-foreground">{k}</div>
                    <div className={cn('font-semibold tabular-nums', c)}>{val}</div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                {can(user, 'manager') && (
                  <Button size="sm" variant="outline" onClick={() => onEdit(s)}>
                    <Pencil /> Edit
                  </Button>
                )}
                <Button size="sm" variant="outline" asChild>
                  <a href={`/staff/statement/${s.id}`} target="_blank" rel="noopener">
                    <Printer /> Print statement
                  </a>
                </Button>
                <Button size="sm" variant="outline" onClick={() => desk.newReservation({ companyId: s.id })}>
                  <Plus /> Book a guest
                </Button>
              </div>
            </SheetHeader>
            <div className="space-y-6 p-5">
              {s.open_stays.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Current & upcoming stays</h3>
                  <div className="overflow-hidden rounded-lg border">
                    <Table>
                      <TableBody>
                        {s.open_stays.map((o) => (
                          <TableRow key={o.id} className="cursor-pointer" onClick={() => desk.openReservation(o.id)}>
                            <TableCell className="font-medium">{o.guest_name}</TableCell>
                            <TableCell className="tabular-nums">{fmtDate(o.check_in)} → {fmtDate(o.check_out)}</TableCell>
                            <TableCell><ReservationStatusPill status={o.status} /></TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">{o.bill_to_company ? 'Billed to account' : 'Guest pays'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              <div>
                <h3 className="mb-2 text-sm font-semibold">Statement</h3>
                {ledger.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing billed to this account yet.</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead>Date</TableHead>
                          <TableHead>Detail</TableHead>
                          <TableHead className="text-right">Charged</TableHead>
                          <TableHead className="text-right">Paid</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ledger.map((r) => (
                          <TableRow key={r.key} className={r.res ? 'cursor-pointer' : ''} onClick={() => r.res && desk.openReservation(r.res)}>
                            <TableCell className="text-xs tabular-nums">{fmtDate(r.date)}</TableCell>
                            <TableCell className="max-w-64 truncate text-sm">{r.text}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{r.debit ? naira(r.debit) : ''}</TableCell>
                            <TableCell className="text-right text-sm text-success tabular-nums">{r.credit ? naira(r.credit) : ''}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{naira(r.running)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell colSpan={4} className="font-semibold">Balance owed</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{naira(s.balance)}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </div>

              {can(user, 'manager') && s.balance > 0 && (
                <form onSubmit={record} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
                  <h3 className="text-sm font-semibold sm:col-span-2">Record a payment from {s.name}</h3>
                  <Field label="Amount">
                    <MoneyInput value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} required placeholder={String(s.balance)} />
                  </Field>
                  <Field label="Method">
                    <SelectField value={pay.method} onChange={(v) => setPay({ ...pay, method: v as PaymentMethod })} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_LABELS[m] }))} />
                  </Field>
                  <Field label="Date">
                    <DateInput value={pay.date} max={todayISO()} onChange={(v) => setPay({ ...pay, date: v })} />
                  </Field>
                  <Field label="Reference">
                    <Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="Transfer ref or cheque no." maxLength={80} />
                  </Field>
                  <div className="sm:col-span-2">
                    <ErrorNote error={error} />
                  </div>
                  <Button className="sm:col-span-2" disabled={busy || !pay.amount}>
                    Record payment
                  </Button>
                </form>
              )}
              {s.notes && <p className="rounded-md border bg-muted/40 p-3 text-sm">{s.notes}</p>}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CompanyDialog({ company, onClose, onSaved }: { company: Company | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const c = company && company !== 'new' ? company : null;
  const init = () => ({
    name: c?.name ?? '', contact_name: c?.contact_name ?? '', phone: c?.phone ?? '', email: c?.email ?? '', address: c?.address ?? '',
    discount_pct: String(c?.discount_pct ?? ''), credit_limit: String(c?.credit_limit || ''), notes: c?.notes ?? '', active: c ? !!c.active : true,
  });
  const [f, setF] = useState(init);
  const [key, setKey] = useState<typeof company>(null);
  if (key !== company) (setKey(company), setF(init()));
  const { busy, error, submit } = useSubmit();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api(c ? `/companies/${c.id}` : '/companies', { method: c ? 'PUT' : 'POST', body: { ...f, discount_pct: Number(f.discount_pct || 0), credit_limit: Number(f.credit_limit || 0) } });
      toast.success(c ? 'Company updated' : `${f.name} added`);
      onSaved();
    });
  };
  return (
    <Dialog open={!!company} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{c ? `Edit ${c.name}` : 'New company account'}</DialogTitle>
        </DialogHeader>
        <form id="company" className="grid gap-4" onSubmit={onSubmit}>
          <Field label="Company name">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={120} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact person"><Input value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></Field>
            <Field label="Phone"><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="Email (for statements)"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Address"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
            <Field label="Negotiated discount" hint="Off every night they book">
              <div className="relative">
                <Input inputMode="numeric" className="pr-7 tabular-nums" value={f.discount_pct} onChange={(e) => setF({ ...f, discount_pct: e.target.value.replace(/\D/g, '') })} placeholder="0" />
                <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
            </Field>
            <Field label="Credit limit" hint="Leave empty for no limit">
              <MoneyInput value={f.credit_limit} onChange={(v) => setF({ ...f, credit_limit: v })} />
            </Field>
          </div>
          <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} maxLength={500} placeholder="Billing instructions, PO requirements…" /></Field>
          {c && (
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} /> Account active
            </label>
          )}
          <ErrorNote error={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="company" disabled={busy}>{c ? 'Save' : 'Add company'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Every charge and payment on the account in date order, with the balance after each line. */
export function ledgerOf(s: CompanyStatement) {
  return [
    ...s.charges.map((c) => ({ date: c.date, key: `c${c.id}`, text: `${c.guest_name} · ${fmtDate(c.check_in)}–${fmtDate(c.check_out)} · ${c.code}`, debit: c.amount, credit: 0, res: c.reservation_id })),
    ...s.payments.map((p) => ({ date: p.date, key: `p${p.id}`, text: `Payment · ${PAYMENT_LABELS[p.method]}${p.reference ? ` · ${p.reference}` : ''}`, debit: 0, credit: p.amount, res: null as number | null })),
  ]
    .sort((a, b) => a.date.localeCompare(b.date))
    .reduce<{ rows: { date: string; key: string; text: string; debit: number; credit: number; res: number | null; running: number }[]; bal: number }>(
      (acc, r) => ((acc.bal += r.debit - r.credit), acc.rows.push({ ...r, running: acc.bal }), acc),
      { rows: [], bal: 0 },
    ).rows;
}
