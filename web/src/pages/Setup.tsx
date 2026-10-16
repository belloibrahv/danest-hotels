import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AsideCopy, AuthLayout } from '@/components/app/auth-layout';
import { Field } from '@/components/app/form';
import { ErrorNote, LoadingRows } from '@/components/app/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSubmit } from '@/lib/hooks';

/** First run only: the owner creates their own account with the one-time setup code. */
export default function Setup() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState<boolean | null>(null);
  const [f, setF] = useState({ code: '', name: '', username: '', password: '', confirm: '' });
  const { busy, error, setError, submit } = useSubmit();

  useEffect(() => {
    api<{ needs_setup: boolean }>('/setup/status').then((r) => setStatus(r.needs_setup), () => setStatus(false));
  }, []);

  if (status === null) return <LoadingRows />;
  if (!status) return <Navigate to="/staff/login" replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setError("The passwords don't match");
    submit(async () => {
      await api('/setup/owner', { body: { code: f.code, name: f.name, username: f.username, password: f.password } });
      await refresh();
      nav('/staff?welcome=1', { replace: true });
    });
  };

  return (
    <AuthLayout
      aside={
        <AsideCopy title="Let's get the hotel ready.">
          <p>Create the owner account first. Then add your rooms and prices, bar stock and staff. The system starts empty, so every number you see is your hotel's real business.</p>
          <ol className="mt-6 space-y-2">
            {['Owner account', 'Hotel details', 'Rooms & rates', 'Stock, prices & staff'].map((s, i) => (
              <li key={s} className="flex items-center gap-3">
                <span className="flex size-6 items-center justify-center rounded-full border border-current/30 text-xs">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </AsideCopy>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="mb-1">
          <p className="text-xs font-medium text-muted-foreground">Step 1 of 4</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Create the owner account</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use your real name — it appears on every action you take.</p>
        </div>
        <Field label="Setup code" htmlFor="code" hint="From whoever installed the system.">
          <Input id="code" className="font-mono uppercase" autoComplete="off" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} required />
        </Field>
        <Field label="Full name" htmlFor="name">
          <Input id="name" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={3} maxLength={80} />
        </Field>
        <Field label="Username" htmlFor="username">
          <Input id="username" autoCapitalize="none" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, '') })} required pattern="[a-z0-9._\-]{3,32}" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Password" htmlFor="pw">
            <Input id="pw" type="password" autoComplete="new-password" minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required placeholder="10+ characters" />
          </Field>
          <Field label="Confirm" htmlFor="pw2">
            <Input id="pw2" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required />
          </Field>
        </div>
        <ErrorNote error={error} />
        <Button size="lg" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
