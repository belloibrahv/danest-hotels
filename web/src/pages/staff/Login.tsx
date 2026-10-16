import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { LoungeScene } from '../../components/illustrations';
import { ErrorBox, Field, Icon, useSubmit, useToast } from '../../components/kit';
import { homeFor, useAuth } from '../../lib/auth';

// Shown only in development / demo builds so the client can click through each role.
const DEMO = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_LOGINS === '1';
const DEMO_USERS = [
  { username: 'manager', label: 'Manager / owner', note: 'Sees everything, including profit' },
  { username: 'frontdesk', label: 'Front desk', note: 'Rooms, guests, folios, gym/pool/lounge' },
  { username: 'bar', label: 'Bar & shop', note: 'Till, room charges and stock levels' },
];

export default function Login() {
  const { login, verify } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const { busy, error, setError, submit } = useSubmit();
  const [needsSetup, setNeedsSetup] = useState(false);
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
        if (u.recovery_codes_left !== undefined) toast(`Signed in with a recovery code — ${u.recovery_codes_left} left. Make new ones under My account.`);
        nav(homeFor(u.role), { replace: true });
      } catch (err) {
        if (err instanceof Error && /expired/.test(err.message)) setChallenge(null);
        setCode('');
        throw err;
      }
    });
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
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h2 className="display">Every room, every bottle, every naira — in one place.</h2>
          <p>Reservations, guest folios, the bar till, the pool and gym, purchases and running costs all add up to one honest profit figure, updated as you work.</p>
        </div>
        <div style={{ position: 'absolute', inset: 'auto 0 0 0', height: '46%', opacity: 0.9, maskImage: 'linear-gradient(to top, #000 60%, transparent)' }}>
          <LoungeScene />
        </div>
        <small style={{ color: '#7d7464', position: 'relative' }}>Danest Hotel &amp; Suites · Old Bodija, Ibadan</small>
      </div>
      <div className="login-form">
        {challenge ? (
          <form onSubmit={onVerify} className="stack">
            <div>
              <span className="badge gold plain" style={{ marginBottom: 12 }}><Icon name="shield" size={14} /> Two-step sign-in</span>
              <h1 className="display" style={{ fontSize: 34 }}>{useRecovery ? 'Use a recovery code' : 'Enter your code'}</h1>
              <p className="muted" style={{ marginTop: 6 }}>
                {useRecovery ? 'Type one of the recovery codes you saved when you turned on two-step sign-in.' : 'Open your authenticator app and type the 6-digit code for Danest Hotel.'}
              </p>
            </div>
            <Field label={useRecovery ? 'Recovery code' : '6-digit code'}>
              <input
                className={`input${useRecovery ? '' : ' otp'}`}
                autoFocus
                inputMode={useRecovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                maxLength={useRecovery ? 12 : 6}
                value={code}
                onChange={(e) => setCode(useRecovery ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, ''))}
                placeholder={useRecovery ? 'XXXX-XXXX' : '••••••'}
                required
              />
            </Field>
            <ErrorBox error={error} />
            <button className="btn primary lg block" disabled={busy || (!useRecovery && code.length !== 6)}>
              {busy ? 'Checking…' : 'Verify and sign in'}
            </button>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="btn ghost sm" onClick={() => (setUseRecovery(!useRecovery), setCode(''), setError(null))}>
                {useRecovery ? 'Use my authenticator app' : "Can't use your phone?"}
              </button>
              <button type="button" className="btn ghost sm" onClick={() => (setChallenge(null), setCode(''), setError(null))}>
                Start over
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={(e) => (e.preventDefault(), go(username, password))} className="stack">
            <div>
              <h1 className="display" style={{ fontSize: 34 }}>Sign in</h1>
              <p className="muted" style={{ marginTop: 6 }}>Use the account your manager gave you.</p>
            </div>
            {needsSetup && (
              <div className="status-card gold">
                <b>This hotel hasn't been set up yet.</b>
                <p>The owner creates the first account with the setup code. <Link to="/setup">Start setup →</Link></p>
              </div>
            )}
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
        )}
      </div>
    </div>
  );
}
