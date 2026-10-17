import QRCode from 'qrcode';
import { Copy, Download, KeyRound, Laptop, ShieldCheck, Smartphone } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { BOOKS, ROLE_LABELS, hasRole } from '../../../../shared/constants';
import { Field } from '@/components/app/form';
import { ErrorNote, LoadingRows, PageHeader, Section } from '@/components/app/page';
import { StatusPill } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, fmtDateTime } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi, useSubmit } from '@/lib/hooks';
import { cn } from '@/lib/utils';

interface Sessions {
  sessions: { id: string; created_at: string; last_seen_at: string | null; user_agent: string | null; ip: string | null; current: boolean }[];
  recovery_codes_left: number;
}
const iso = (s: string) => s.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
function device(ua: string | null) {
  if (!ua) return 'Unknown device';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

export default function Account() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Password & security" description={`${user!.name} · ${ROLE_LABELS[user!.role]} · @${user!.username}`} />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <TwoStep />
          <Password />
        </div>
        <Devices />
      </div>
    </>
  );
}

function TwoStep() {
  const { user, refresh } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [pw, setPw] = useState('');
  const { busy, error, submit } = useSubmit();

  const start = () =>
    submit(async () => {
      const r = await api<{ secret: string; uri: string }>('/auth/2fa/setup', { body: {} });
      setSetup({ secret: r.secret, qr: await QRCode.toDataURL(r.uri, { margin: 1, width: 360 }) });
    });
  const enable = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      const r = await api<{ recovery_codes: string[] }>('/auth/2fa/enable', { body: { code } });
      setCodes(r.recovery_codes);
      setSetup(null);
      setCode('');
      await refresh();
      toast.success('Two-step sign-in is on', { description: 'Other devices were signed out.' });
    });
  };
  const disable = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/auth/2fa/disable', { body: { password: pw } });
      setDisabling(false);
      setPw('');
      await refresh();
      toast('Two-step sign-in is off');
    });
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`Danest — recovery codes for ${user!.username}\nEach works once.\n\n${codes!.join('\n')}\n`], { type: 'text/plain' }));
    a.download = `danest-recovery-codes-${user!.username}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Section
      title={<span className="flex items-center gap-2"><ShieldCheck className="size-4" /> Two-step sign-in {user!.mfa ? <StatusPill tone="success">On</StatusPill> : <StatusPill tone="warning">Off</StatusPill>}</span>}
      description="A code from your phone as well as your password, so a stolen password alone isn't enough."
    >
      {codes ? (
        <div className="space-y-4">
          <p className="text-sm"><b>Save these recovery codes now.</b> Each signs you in once if you lose your phone. They won't be shown again.</p>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-dashed bg-muted/40 p-4 font-mono text-sm">{codes.map((c) => <span key={c}>{c}</span>)}</div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={download}><Download /> Download</Button>
            <Button variant="outline" size="sm" onClick={() => (navigator.clipboard?.writeText(codes.join('\n')), toast('Copied'))}><Copy /> Copy</Button>
            <Button size="sm" className="ml-auto" onClick={() => setCodes(null)}>I've saved them</Button>
          </div>
        </div>
      ) : setup ? (
        <form className="space-y-4" onSubmit={enable}>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Install Google Authenticator, Microsoft Authenticator or Authy.</li>
            <li>Add an account and scan this code.</li>
            <li>Enter the 6-digit code it shows.</li>
          </ol>
          <div className="flex flex-wrap items-start gap-5">
            <img src={setup.qr} alt="QR code for your authenticator app" className="size-44 rounded-lg border bg-white p-2" />
            <div className="min-w-48 flex-1 space-y-3">
              <Field label="Or enter this key"><Input readOnly className="font-mono text-xs" value={setup.secret.replace(/(.{4})/g, '$1 ').trim()} onFocus={(e) => e.target.select()} /></Field>
              <Field label="6-digit code"><Input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="h-11 text-center font-mono text-lg tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required /></Field>
            </div>
          </div>
          <ErrorNote error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setSetup(null)}>Cancel</Button>
            <Button disabled={busy || code.length !== 6}>Turn on</Button>
          </div>
        </form>
      ) : user!.mfa ? (
        disabling ? (
          <form className="space-y-3" onSubmit={disable}>
            <Field label="Confirm with your password"><Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus /></Field>
            <ErrorNote error={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDisabling(false)}>Keep it on</Button>
              <Button variant="destructive" disabled={busy}>Turn off</Button>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">You'll be asked for a code on each new sign-in.</p>
            <Button variant="outline" size="sm" onClick={() => setDisabling(true)}>Turn off</Button>
          </div>
        )
      ) : (
        <div className="space-y-3">
          {hasRole(user!.role, BOOKS) && <p className="rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">Your account can see every naira in the business. Please turn this on.</p>}
          <ErrorNote error={error} />
          <Button disabled={busy} onClick={start}><ShieldCheck /> Set up two-step sign-in</Button>
        </div>
      )}
    </Section>
  );
}

function Password() {
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const { busy, error, setError, submit } = useSubmit();
  const strength = f.next.length >= 14 && /[^A-Za-z0-9]/.test(f.next) ? 3 : f.next.length >= 12 ? 2 : f.next.length >= 10 ? 1 : 0;
  return (
    <Section title={<span className="flex items-center gap-2"><KeyRound className="size-4" /> Password</span>} description="At least 10 characters. A short sentence is easy to remember and hard to guess.">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (f.next !== f.confirm) return setError("The new passwords don't match");
          submit(async () => {
            await api('/auth/password', { body: { current: f.current, next: f.next } });
            setF({ current: '', next: '', confirm: '' });
            toast.success('Password changed', { description: 'Your other devices were signed out.' });
          });
        }}
      >
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="New password"><Input type="password" autoComplete="new-password" minLength={10} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required /></Field>
          <Field label="Confirm"><Input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required /></Field>
        </div>
        {f.next && (
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((i) => <span key={i} className={cn('h-1 flex-1 rounded-full bg-muted', strength >= i && ['', 'bg-warning', 'bg-brand', 'bg-success'][strength])} />)}
            <span className="w-14 text-right text-xs text-muted-foreground">{['Too short', 'OK', 'Good', 'Strong'][strength]}</span>
          </div>
        )}
        <ErrorNote error={error} />
        <Button className="justify-self-start" disabled={busy || strength === 0}>Change password</Button>
      </form>
    </Section>
  );
}

function Devices() {
  const { data, reload } = useApi<Sessions>('/auth/sessions');
  const revoke = (body: unknown, msg: string) => api('/auth/sessions/revoke', { body }).then(() => (toast.success(msg), reload()), (e) => toast.error(e.message));
  const others = data?.sessions.filter((s) => !s.current).length ?? 0;
  return (
    <Section
      title={<span className="flex items-center gap-2"><Laptop className="size-4" /> Signed-in devices</span>}
      description="If you don't recognise one, sign it out and change your password."
      action={others > 0 && <Button variant="outline" size="sm" onClick={() => revoke({ all_others: true }, 'Signed out of other devices')}>Sign out others</Button>}
      flush
    >
      {!data ? (
        <LoadingRows rows={3} />
      ) : (
        <ul className="divide-y">
          {data.sessions.map((s) => {
            const Icon = /iPhone|Android/.test(s.user_agent ?? '') ? Smartphone : Laptop;
            const recent = s.last_seen_at && Date.now() - Date.parse(s.last_seen_at) < 10 * 60_000;
            return (
              <li key={s.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="flex size-9 items-center justify-center rounded-lg border bg-muted/50"><Icon className="size-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">{device(s.user_agent)} {s.current && <StatusPill tone="success">This device</StatusPill>}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {s.ip ?? 'Unknown network'} · since {fmtDateTime(iso(s.created_at))} · {recent ? 'active now' : s.last_seen_at ? `last seen ${fmtDateTime(iso(s.last_seen_at))}` : ''}
                  </div>
                </div>
                {!s.current && <Button variant="ghost" size="sm" onClick={() => revoke({ id: s.id }, 'Device signed out')}>Sign out</Button>}
              </li>
            );
          })}
        </ul>
      )}
      {data && data.recovery_codes_left > 0 && data.recovery_codes_left < 4 && (
        <p className="border-t px-5 py-3 text-xs text-destructive">Only {data.recovery_codes_left} recovery codes left. Turn two-step sign-in off and on again for a fresh set.</p>
      )}
    </Section>
  );
}
