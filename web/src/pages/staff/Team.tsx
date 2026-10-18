import { History, KeyRound, Plus, Search, ShieldCheck, ShieldOff, UserCog } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { BOOKS, ROLES, ROLE_HELP, ROLE_LABELS, hasRole, type Role } from '../../../../shared/constants';
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
import { api, fmtDateTime } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ACTION, RED, describe, type A } from '@/lib/activity';
import { useApi, useSubmit } from '@/lib/hooks';

interface U { id: number; name: string; username: string; role: Role; active: number; totp_enabled: number; last_login_at: string | null }

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
  const [changing, setChanging] = useState<U | null>(null);
  // Only an owner can make an owner, except in a hotel upgraded from before owners existed: its manager promotes the first one.
  const ownerRoles = ROLES.filter((r) => r !== 'ceo' || user!.role === 'ceo' || !data?.some((u) => u.role === 'ceo' && u.active));
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
                  <TableCell>{u.totp_enabled ? <StatusPill tone="success"><ShieldCheck /> On</StatusPill> : <StatusPill tone={hasRole(u.role, BOOKS) ? 'warning' : 'neutral'}>Off</StatusPill>}</TableCell>
                  <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">{u.last_login_at ? fmtDateTime(u.last_login_at.replace('T', ' ').replace(/\.\d+Z$/, '')) : 'Never'}</TableCell>
                  <TableCell>{u.active ? <StatusPill tone="success">Active</StatusPill> : <StatusPill>Disabled</StatusPill>}</TableCell>
                  <TableCell className="pr-5 text-right">
                    {u.role === 'ceo' && user!.role !== 'ceo' ? null : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm">Manage</Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setResetting(u)}><KeyRound /> Reset password</DropdownMenuItem>
                        {u.id !== user!.id && <DropdownMenuItem onSelect={() => setChanging(u)}><UserCog /> Change role</DropdownMenuItem>}
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
                    )}
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
      <ChangeRole user={changing} roles={ownerRoles} onClose={() => setChanging(null)} onSave={(u, role) => patch(u, { role }, `${u.name} is now ${ROLE_LABELS[role]}. They will sign in again.`).then(() => setChanging(null))} />
    </>
  );
}

function AddStaff({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
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
            <Field label="Role"><SelectField value={f.role} onChange={(v) => setF({ ...f, role: v as Role })} options={ROLES.filter((r) => r !== 'ceo' || user!.role === 'ceo').map((r) => ({ value: r, label: ROLE_LABELS[r] }))} /></Field>
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

function ChangeRole({ user, roles, onClose, onSave }: { user: U | null; roles: readonly Role[]; onClose: () => void; onSave: (u: U, role: Role) => Promise<unknown> }) {
  const [role, setRole] = useState<Role>('frontdesk');
  const [key, setKey] = useState<U | null>(null);
  if (key !== user) (setKey(user), user && setRole(user.role));
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change role for {user?.name}</DialogTitle>
          <DialogDescription>They are signed out everywhere and see the new screens next time they sign in.</DialogDescription>
        </DialogHeader>
        <Field label="Role"><SelectField value={role} onChange={(v) => setRole(v as Role)} options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} /></Field>
        <p className="text-xs text-muted-foreground">{ROLE_HELP[role]}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!user || role === user.role} onClick={() => onSave(user!, role)}>Change role</Button>
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
