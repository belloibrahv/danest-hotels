import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { PoolScene } from '../components/illustrations';
import { ErrorBox, Field, Icon, Loading, useSubmit } from '../components/kit';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * First run only. The owner creates their own account with their real name, using the
 * one-time setup code from the server. After that this page is closed for good.
 */
export default function Setup() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState<boolean | null>(null);
  const [f, setF] = useState({ code: '', name: '', username: '', password: '', confirm: '' });
  const { busy, error, setError, submit } = useSubmit();

  useEffect(() => {
    api<{ needs_setup: boolean }>('/setup/status').then((r) => setStatus(r.needs_setup), () => setStatus(false));
  }, []);

  if (status === null) return <Loading />;
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
    <div className="login">
      <div className="login-art">
        <div className="brand">
          <img src="/brand/crest-128.png" alt="" />
          <span>
            <b style={{ color: '#fff' }}>Danest</b>
            <small style={{ color: '#8f8676' }}>First-time setup</small>
          </span>
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h2 className="display">Welcome. Let's get the hotel ready.</h2>
          <p>Create your own owner account first. Next you'll add your rooms and prices, your bar stock and your staff. Nothing here is made up — the system starts empty and fills with your hotel's real business.</p>
          <ol className="steps" style={{ color: '#d9d1c1' }}>
            <li><span><b style={{ color: '#fff' }}>Your account</b> — the owner, with full access</span></li>
            <li><span><b style={{ color: '#fff' }}>Hotel details</b> — phone, address, check-in times</span></li>
            <li><span><b style={{ color: '#fff' }}>Rooms &amp; prices</b> — then bar stock and staff</span></li>
          </ol>
        </div>
        <div style={{ position: 'absolute', inset: 'auto 0 0 0', height: '22%', opacity: 0.8, maskImage: 'linear-gradient(to top, #000 40%, transparent)' }}>
          <PoolScene />
        </div>
        <span />
      </div>
      <div className="login-form">
        <form onSubmit={onSubmit} className="stack">
          <div>
            <span className="badge gold plain" style={{ marginBottom: 12 }}><Icon name="shield" size={14} /> Step 1 of 3</span>
            <h1 className="display" style={{ fontSize: 34 }}>Create the owner account</h1>
            <p className="muted" style={{ marginTop: 6 }}>Use your real name — it appears on every action you take in the activity log.</p>
          </div>
          <Field label="Setup code" hint="From the person who installed the system (in the server log or the DANEST_SETUP_CODE setting)">
            <input className="input num" autoComplete="off" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} required />
          </Field>
          <Field label="Your full name">
            <input className="input" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={3} maxLength={80} />
          </Field>
          <Field label="Choose a username" hint="Letters, numbers and dots. You'll sign in with this.">
            <input className="input" autoCapitalize="none" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, '') })} required pattern="[a-z0-9._\-]{3,32}" />
          </Field>
          <div className="grid-2">
            <Field label="Password (10+ characters)">
              <input className="input" type="password" autoComplete="new-password" minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
            </Field>
            <Field label="Type it again">
              <input className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required />
            </Field>
          </div>
          <ErrorBox error={error} />
          <button className="btn primary lg block" disabled={busy}>{busy ? 'Creating…' : 'Create account and continue'}</button>
        </form>
      </div>
    </div>
  );
}
