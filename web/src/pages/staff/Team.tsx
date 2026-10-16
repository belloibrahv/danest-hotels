import { History, KeyRound, Plus, Search, ShieldCheck, ShieldOff, UserCog } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ROLES, ROLE_HELP, ROLE_LABELS, type Role } from '../../../../shared/constants';
import { Field, SelectField, useConfirm } from '@/components/app/form';
import { EmptyState, ErrorNote, LoadingRows, PageHeader } from '@/components/app/page';
import { StatusPill } from '@/components/app/status';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, fmtDateTime, naira } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi, useSubmit } from '@/lib/hooks';

interface U { id: number; name: string; username: string; role: Role; active: number; totp_enabled: number; last_login_at: string | null }
interface A { id: number; action: string; entity: string; entity_id: number | null; detail: string | null; created_at: string; user: string | null }

const ACTION: Record<string, string> = {
  login: 'signed in', login_failed: 'failed sign-in', create: 'created', update: 'updated', delete: 'deleted', confirm: 'confirmed', cancel: 'cancelled',
  check_in: 'checked in', check_out: 'checked out', check_out_with_balance: 'checked out with balance owed', payment: 'took a payment on', room_status: 'changed status of',
  stock_adjust: 'adjusted stock of', rate_change: 'changed rate of', booking_request: 'website booking', password_change: 'changed password', setup_owner: 'set up the hotel',
  mfa_enabled: 'turned on two-step sign-in', mfa_disabled: 'turned off two-step sign-in', mfa_failed: 'entered a wrong code', login_recovery_code: 'used a recovery code',
  sessions_revoked: 'signed out other devices', session_revoked: 'signed out a device', room_charge: 'charged to room', change_dates: 'changed dates of', room_move: 'moved room for',
  no_show: 'marked no-show', close_day: 'closed the day', close_day_with_variance: 'closed the day with a cash difference', reopen_day: 'reopened a closed day', resolve: 'resolved',
  bill_to_company: 'billed to company', company_payment: 'received company payment', set_company: 'changed company on', online_payment: 'online payment received', online_payment_mismatch: 'online payment amount mismatch',
  message: 'messaged guest on', seed: 'loaded demo data',
};
const RED = /failed|mismatch|delete|disabled|variance|reopen|with_balance/;

function describe(a: A) {
  let d: Record<string, unknown> = {};
  try {
    d = a.detail ? JSON.parse(a.detail) : {};
  } catch {
    /* ignore */
  }
  const bits: string[] = [];
  for (const k of ['amount', 'balance', 'total', 'variance'] as const) if (typeof d[k] === 'number') bits.push(`${k === 'balance' ? 'owed ' : ''}${naira(d[k] as number)}`);
  for (const k of ['reason', 'company', 'username', 'status', 'name', 'room', 'date'] as const) if (typeof d[k] === 'string') bits.push(String(d[k]));
  if (typeof d.change === 'number') bits.push(`${d.change > 0 ? '+' : ''}${d.change}`);
  return bits.join(' · ');
}

export default function Team() {
  return (
    <>
      <PageHeader title="Team & activity" description="Who can sign in, what they can see, and a record of everything important they do." />
      <Tabs defaultValue="team">
        <TabsList className="mb-4 h-9">
          <TabsTrigger value="team"><UserCog /> Team</TabsTrigger>
          <TabsTrigger value="activity"><History /> Activity log</TabsTrigger>
        </TabsList>
        <TabsContent value="team"><TeamList /></TabsContent>
        <TabsContent value="activity"><Activity /></TabsContent>
      </Tabs>
    </>
  );
}

function TeamList() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const { data, error, reload } = useApi<U[]>('/users');
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<U | null>(null);
  const patch = (u: U, body: object, msg: string) => api(`/users/${u.id}`, { method: 'PATCH', body }).then(() => (toast.success(msg), reload()), (e) => toast.error(e.message));

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setAdding(true)}><Plus /> Add staff</Button>
      </div>
      <Card className="gap-0 overflow-hidden py-0 shadow-xs">
        <ErrorNote error={error} />
        {!data ? (
          <LoadingRows rows={4} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5">Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Two-step</TableHead>
                <TableHead className="hidden md:table-cell">Last sign-in</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((u) => (
                <TableRow key={u.id} className={u.active ? '' : 'opacity-55'}>
                  <TableCell className="pl-5">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8"><AvatarFallback className="text-xs">{u.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</AvatarFallback></Avatar>
                      <div>
                        <div className="font-medium">{u.name}{u.id === user!.id && <span className="font-normal text-muted-foreground"> (you)</span>}</div>
                        <div className="text-xs text-muted-foreground">@{u.username}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{ROLE_LABELS[u.role]}</TableCell>
                  <TableCell>{u.totp_enabled ? <StatusPill tone="success"><ShieldCheck /> On</StatusPill> : <StatusPill tone={u.role === 'manager' ? 'warning' : 'neutral'}>Off</StatusPill>}</TableCell>
                  <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">{u.last_login_at ? fmtDateTime(u.last_login_at.replace('T', ' ').replace(/\.\d+Z$/, '')) : 'Never'}</TableCell>
                  <TableCell>{u.active ? <StatusPill tone="success">Active</StatusPill> : <StatusPill>Disabled</StatusPill>}</TableCell>
                  <TableCell className="pr-5 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm">Manage</Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setResetting(u)}><KeyRound /> Reset password</DropdownMenuItem>
                        {!!u.totp_enabled && u.id !== user!.id && (
                          <DropdownMenuItem onSelect={async () => (await confirm({ title: `Reset two-step sign-in for ${u.name}?`, description: 'Only if they lost their phone. They should set it up again straight away.', confirmLabel: 'Reset' })) && patch(u, { reset_2fa: true }, 'Two-step sign-in reset')}>
                            <ShieldOff /> Reset two-step
                          </DropdownMenuItem>
                        )}
                        {u.id !== user!.id && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onSelect={() => patch(u, { active: !u.active }, u.active ? `${u.name} can no longer sign in` : `${u.name} can sign in again`)}>
                              {u.active ? 'Disable account' : 'Enable account'}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        {ROLES.map((r) => (
          <div key={r} className="rounded-lg border bg-card p-3">
            <div className="font-medium">{ROLE_LABELS[r]}</div>
            <p className="mt-0.5 text-xs text-muted-foreground">{ROLE_HELP[r]}</p>
          </div>
        ))}
      </div>
      <AddStaff open={adding} onClose={() => setAdding(false)} onSaved={() => (setAdding(false), reload())} />
      <ResetPassword user={resetting} onClose={() => setResetting(null)} />
    </>
  );
}

function AddStaff({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', username: '', role: 'frontdesk' as Role, password: '' });
  const { busy, error, submit } = useSubmit();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/users', { body: f });
      toast.success(`${f.name} can now sign in as “${f.username}”`);
      setF({ name: '', username: '', role: 'frontdesk', password: '' });
      onSaved();
    });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a staff member</DialogTitle>
          <DialogDescription>Use their real name — it appears on everything they do.</DialogDescription>
        </DialogHeader>
        <form id="staff" className="grid gap-4" onSubmit={onSubmit}>
          <Field label="Full name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={3} maxLength={80} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Username"><Input autoCapitalize="none" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} required pattern="[a-z0-9._\-]{3,32}" /></Field>
            <Field label="Role"><SelectField value={f.role} onChange={(v) => setF({ ...f, role: v as Role })} options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} /></Field>
          </div>
          <p className="-mt-1 text-xs text-muted-foreground">{ROLE_HELP[f.role]}</p>
          <Field label="Temporary password" hint="10+ characters. Ask them to change it after signing in.">
            <Input autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={10} />
          </Field>
          <ErrorNote error={error} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="staff" disabled={busy}>Add staff</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPassword({ user, onClose }: { user: U | null; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const { busy, error, submit } = useSubmit();
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && (setPw(''), onClose())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New password for {user?.name}</DialogTitle>
          <DialogDescription>They will be signed out everywhere.</DialogDescription>
        </DialogHeader>
        <form id="reset" onSubmit={(e) => (e.preventDefault(), submit(async () => (await api(`/users/${user!.id}`, { method: 'PATCH', body: { password: pw } }), toast.success('Password reset'), setPw(''), onClose())))}>
          <Field label="New password" hint="10+ characters"><Input value={pw} onChange={(e) => setPw(e.target.value)} required minLength={10} autoComplete="new-password" /></Field>
          <div className="mt-3"><ErrorNote error={error} /></div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="reset" disabled={busy}>Reset password</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Activity() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error } = useApi<A[]>(`/audit?q=${encodeURIComponent(query)}`);
  return (
    <>
      <div className="mb-4 flex justify-end">
        <div className="relative w-full sm:w-72">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Filter: payment, login, a name…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <Card className="gap-0 overflow-hidden py-0 shadow-xs">
        <ErrorNote error={error} />
        {!data ? (
          <LoadingRows rows={8} />
        ) : data.length === 0 ? (
          <EmptyState icon={History} title="No matching activity" />
        ) : (
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
              {data.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="pl-5 whitespace-nowrap text-muted-foreground tabular-nums">{fmtDateTime(a.created_at)}</TableCell>
                  <TableCell>{a.user ?? <span className="text-muted-foreground">{a.action === 'booking_request' ? 'Guest website' : a.action.startsWith('online') ? 'Paystack' : 'System'}</span>}</TableCell>
                  <TableCell>
                    <span className={RED.test(a.action) ? 'font-medium text-destructive' : ''}>{ACTION[a.action] ?? a.action}</span>{' '}
                    <span className="text-muted-foreground">{a.entity.replace('_', ' ')}{a.entity_id ? ` #${a.entity_id}` : ''}</span>
                  </TableCell>
                  <TableCell className="pr-5 text-muted-foreground">{describe(a)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
