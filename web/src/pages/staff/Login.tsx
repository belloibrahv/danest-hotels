import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorBox, Field, useSubmit } from '../../components/ui';
import { homeFor, useAuth } from '../../lib/auth';

// Shown only in development / demo builds so the client can click through each role.
const DEMO = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_LOGINS === '1';
const DEMO_USERS = [
  { username: 'manager', label: 'Manager / owner', note: 'Sees everything, including profit' },
  { username: 'frontdesk', label: 'Front desk', note: 'Rooms, guests, gym/pool/lounge' },
  { username: 'bar', label: 'Bar & shop', note: 'Till and stock levels only' },
];

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit();

  const go = (u: string, p: string) =>
    submit(async () => {
      const user = await login(u, p);
      nav(homeFor(user.role), { replace: true });
    });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    go(username, password);
  };

  return (
    <div className="login">
      <div className="login-art">
        <div className="brand">
          <img src="/brand/crest-128.png" alt="" />
          <span>
            <b style={{ color: '#fff' }}>Danest</b>
            <small style={{ color: '#8f8676' }}>Back office</small>
          </span>
        </div>
        <div>
          <h2 className="display">Every room, every bottle, every naira — in one place.</h2>
          <p>Reservations, the bar till, the pool and gym, purchases and running costs all add up to one honest profit figure, updated as you work.</p>
        </div>
        <img src="/brand/building-900.jpg" alt="" style={{ opacity: 0.18, filter: 'grayscale(1) invert(1)', mixBlendMode: 'screen', position: 'absolute', right: -80, bottom: 40, width: 640, pointerEvents: 'none' }} />
        <small style={{ color: '#7d7464' }}>Danest Hotel &amp; Suites · Old Bodija, Ibadan</small>
      </div>
      <div className="login-form">
        <form onSubmit={onSubmit} className="stack">
          <div>
            <h1 className="display" style={{ fontSize: 34 }}>Sign in</h1>
            <p className="muted" style={{ marginTop: 6 }}>Use the account your manager gave you.</p>
          </div>
          <Field label="Username">
            <input className="input" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field label="Password">
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <ErrorBox error={error} />
          <button className="btn primary lg block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {DEMO && (
            <div className="demo-users">
              <div className="muted" style={{ marginBottom: 6 }}>
                Demo accounts · password <code>Danest@2026!</code>
              </div>
              {DEMO_USERS.map((d) => (
                <button type="button" key={d.username} onClick={() => go(d.username, 'Danest@2026!')} disabled={busy}>
                  <span>
                    <b>{d.label}</b>
                    <br />
                    <span className="muted">{d.note}</span>
                  </span>
                  <span className="muted">→</span>
                </button>
              ))}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
