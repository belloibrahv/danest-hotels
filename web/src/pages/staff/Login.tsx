import { ShieldCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AsideCopy, AuthLayout } from '@/components/app/auth-layout';
import { Field } from '@/components/app/form';
import { ErrorNote } from '@/components/app/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';
import { useSubmit } from '@/lib/hooks';

// One-click demo accounts appear only in development builds with demo data loaded.
const DEMO = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_LOGINS === '1';
const DEMO_USERS = [
  ['manager', 'Manager'],
  ['frontdesk', 'Front desk'],
  ['bar', 'Bar & shop'],
  ['housekeeping', 'Housekeeping'],
];

export default function Login() {
  const { login, verify } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const { busy, error, setError, submit } = useSubmit();

  useEffect(() => {
    api<{ needs_setup: boolean }>('/setup/status').then((r) => setNeedsSetup(r.needs_setup), () => {});
  }, []);

  const go = (u: string, p: string) =>
    submit(async () => {
      const r = await login(u, p);
      if ('challenge' in r) {
        setChallenge(r.challenge);
        setPassword('');
        return;
      }
      nav(homeFor(r.user.role), { replace: true });
    });

  const onVerify = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      try {
        const u = await verify(challenge!, code);
        if (u.recovery_codes_left !== undefined) toast.warning(`Signed in with a recovery code — ${u.recovery_codes_left} left`, { description: 'Make a new set under Password & security.' });
        nav(homeFor(u.role), { replace: true });
      } catch (err) {
        if (err instanceof Error && /expired/.test(err.message)) setChallenge(null);
        setCode('');
        throw err;
      }
    });
  };

  return (
    <AuthLayout
      aside={
        <AsideCopy title="Every room, every bottle, every naira — in one place.">
          <p>Reservations, room bills, the bar till, the pool and gym, purchases and running costs add up to one honest profit figure, updated as you work.</p>
        </AsideCopy>
      }
    >
      {challenge ? (
        <form onSubmit={onVerify} className="grid gap-5">
          <div>
            <div className="mb-3 flex size-10 items-center justify-center rounded-lg border bg-muted/50">
              <ShieldCheck className="size-5" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">{recovery ? 'Use a recovery code' : 'Two-step verification'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{recovery ? 'Enter one of the codes you saved when you turned on two-step sign-in.' : 'Enter the 6-digit code from your authenticator app.'}</p>
          </div>
          <Field label={recovery ? 'Recovery code' : 'Code'} htmlFor="otp">
            <Input
              id="otp"
              autoFocus
              className={recovery ? 'font-mono' : 'h-12 text-center font-mono text-xl tracking-[0.5em]'}
              inputMode={recovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              maxLength={recovery ? 12 : 6}
              value={code}
              onChange={(e) => setCode(recovery ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, ''))}
              placeholder={recovery ? 'XXXX-XXXX' : '000000'}
              required
            />
          </Field>
          <ErrorNote error={error} />
          <Button size="lg" disabled={busy || (!recovery && code.length !== 6)}>
            {busy ? 'Checking…' : 'Verify'}
          </Button>
          <div className="flex justify-between text-sm">
            <button type="button" className="text-muted-foreground underline-offset-4 hover:underline" onClick={() => (setRecovery(!recovery), setCode(''), setError(null))}>
              {recovery ? 'Use authenticator app' : 'Use a recovery code'}
            </button>
            <button type="button" className="text-muted-foreground underline-offset-4 hover:underline" onClick={() => (setChallenge(null), setCode(''), setError(null))}>
              Start over
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={(e) => (e.preventDefault(), go(username, password))} className="grid gap-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">Use the account your manager created for you.</p>
          </div>
          {needsSetup && (
            <div className="rounded-lg border border-brand/30 bg-brand-soft p-3 text-sm">
              <b>This hotel isn't set up yet.</b> The owner creates the first account with the setup code.{' '}
              <Link to="/setup" className="font-medium underline underline-offset-4">
                Start setup
              </Link>
            </div>
          )}
          <Field label="Username" htmlFor="username">
            <Input id="username" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <ErrorNote error={error} />
          <Button size="lg" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          {DEMO && (
            <div className="rounded-lg border border-dashed p-3">
              <p className="mb-2 text-xs text-muted-foreground">
                Demo data · password <code className="font-mono">Danest@2026!</code>
              </p>
              <div className="grid grid-cols-2 gap-2">
                {DEMO_USERS.map(([u, label]) => (
                  <Button key={u} type="button" variant="outline" size="sm" disabled={busy} onClick={() => go(u, 'Danest@2026!')}>
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </form>
      )}
    </AuthLayout>
  );
}
