import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { ROLE_LABELS } from '../../../../shared/constants';
import { Card, ErrorBox, Field, Icon, Loading, PageHead, useSubmit, useToast } from '../../components/ui';
import { api, fmtDateTime } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';

interface Sessions {
  sessions: { id: string; created_at: string; last_seen_at: string | null; user_agent: string | null; ip: string | null; current: boolean }[];
  recovery_codes_left: number;
}

function deviceName(ua: string | null) {
  if (!ua) return 'Unknown device';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}
const iso = (s: string) => s.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');

export default function Account() {
  const { user } = useAuth();
  return (
    <>
      <PageHead title="My account" sub={`${user!.name} · ${ROLE_LABELS[user!.role]} · signed in as “${user!.username}”`} />
      <div className="cards cols-2" style={{ alignItems: 'start' }}>
        <div className="stack">
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
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [pw, setPw] = useState('');
  const { busy, error, submit } = useSubmit();

  const start = () =>
    submit(async () => {
      const r = await api<{ secret: string; uri: string }>('/auth/2fa/setup', { body: {} });
      const qr = await QRCode.toDataURL(r.uri, { margin: 1, width: 360, color: { dark: '#17140f', light: '#ffffff' } });
      setSetup({ ...r, qr });
    });

  const enable = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      const r = await api<{ recovery_codes: string[] }>('/auth/2fa/enable', { body: { code } });
      setCodes(r.recovery_codes);
      setSetup(null);
      setCode('');
      await refresh();
      toast('Two-step sign-in is on. Other devices were signed out.');
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
    const text = `Danest Hotel — recovery codes for ${user!.username}\nEach code works once. Keep them somewhere safe.\n\n${codes!.join('\n')}\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = `danest-recovery-codes-${user!.username}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card
      title={
        <span className="row" style={{ gap: 8 }}>
          <Icon name="shield" size={16} /> Two-step sign-in
          {user!.mfa ? <span className="badge green">On</span> : <span className="badge amber">Off</span>}
        </span>
      }
      sub="A code from your phone, on top of your password. Stops anyone who learns your password."
    >
      <div className="stack">
        {codes ? (
          <>
            <p><b>Save these recovery codes now.</b> If you lose your phone, each one lets you sign in once. They won't be shown again.</p>
            <div className="codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
            <div className="row">
              <button className="btn" onClick={download}><Icon name="download" size={16} /> Download</button>
              <button className="btn" onClick={() => (navigator.clipboard?.writeText(codes.join('\n')), toast('Copied'))}>Copy</button>
              <span className="spacer" />
              <button className="btn primary" onClick={() => setCodes(null)}>I've saved them</button>
            </div>
          </>
        ) : setup ? (
          <form className="stack" onSubmit={enable}>
            <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14 }}>
              <li>Install <b>Google Authenticator</b>, <b>Microsoft Authenticator</b> or <b>Authy</b> on your phone.</li>
              <li>Tap “add account” and scan this code.</li>
              <li>Type the 6-digit code it shows.</li>
            </ol>
            <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
              <img className="qr" src={setup.qr} alt="QR code to add Danest Hotel to your authenticator app" />
              <div className="stack" style={{ flex: 1, minWidth: 200 }}>
                <Field label="Can't scan? Enter this key">
                  <input className="input num" readOnly value={setup.secret.replace(/(.{4})/g, '$1 ').trim()} onFocus={(e) => e.target.select()} />
                </Field>
                <Field label="6-digit code">
                  <input className="input otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus required />
                </Field>
              </div>
            </div>
            <ErrorBox error={error} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setSetup(null)}>Cancel</button>
              <button className="btn primary" disabled={busy || code.length !== 6}>Turn on</button>
            </div>
          </form>
        ) : user!.mfa ? (
          disabling ? (
            <form className="stack" onSubmit={disable}>
              <Field label="Confirm with your password">
                <input className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
              </Field>
              <ErrorBox error={error} />
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn" onClick={() => setDisabling(false)}>Keep it on</button>
                <button className="btn danger" disabled={busy}>Turn off two-step sign-in</button>
              </div>
            </form>
          ) : (
            <div className="row">
              <span className="muted" style={{ fontSize: 14 }}>You'll be asked for a code each time you sign in on a new session.</span>
              <span className="spacer" />
              <button className="btn sm danger" onClick={() => setDisabling(true)}>Turn off</button>
            </div>
          )
        ) : (
          <>
            {user!.role === 'manager' && (
              <div className="error-box" style={{ background: 'var(--amber-soft)', color: 'var(--amber)' }}>
                Managers can see every naira in the business. Please turn this on.
              </div>
            )}
            <ErrorBox error={error} />
            <button className="btn gold" style={{ justifySelf: 'start' }} disabled={busy} onClick={start}>
              <Icon name="shield" size={16} /> Set up two-step sign-in
            </button>
          </>
        )}
      </div>
    </Card>
  );
}

function Password() {
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const { busy, error, setError, submit } = useSubmit();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (f.next !== f.confirm) return setError("The new passwords don't match");
    submit(async () => {
      await api('/auth/password', { body: { current: f.current, next: f.next } });
      setF({ current: '', next: '', confirm: '' });
      toast('Password changed. Your other devices were signed out.');
    });
  };
  const strength = f.next.length >= 14 && /[^A-Za-z0-9]/.test(f.next) ? 3 : f.next.length >= 12 ? 2 : f.next.length >= 10 ? 1 : 0;
  return (
    <Card title={<span className="row" style={{ gap: 8 }}><Icon name="lock" size={16} /> Password</span>} sub="At least 10 characters. A short sentence is easier to remember and harder to guess.">
      <form className="stack" onSubmit={onSubmit}>
        <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required /></Field>
        <div className="grid-2">
          <Field label="New password"><input className="input" type="password" autoComplete="new-password" minLength={10} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required /></Field>
          <Field label="Type it again"><input className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required /></Field>
        </div>
        {f.next && (
          <div className="row" style={{ gap: 6 }}>
            {[1, 2, 3].map((i) => <span key={i} style={{ height: 4, flex: 1, borderRadius: 2, background: strength >= i ? ['', 'var(--amber)', 'var(--gold)', 'var(--green)'][strength] : 'var(--line)' }} />)}
            <small className="muted" style={{ minWidth: 70, textAlign: 'right' }}>{['Too short', 'OK', 'Good', 'Strong'][strength]}</small>
          </div>
        )}
        <ErrorBox error={error} />
        <button className="btn primary" style={{ justifySelf: 'start' }} disabled={busy || strength === 0}>Change password</button>
      </form>
    </Card>
  );
}

function Devices() {
  const toast = useToast();
  const { data, reload } = useApi<Sessions>('/auth/sessions');
  const [now, setNow] = useState(0);
  useEffect(() => setNow(Date.now()), [data]);
  const revoke = async (body: unknown, msg: string) => {
    await api('/auth/sessions/revoke', { body }).then(() => (toast(msg), reload()), (e) => toast(e.message));
  };
  const others = data?.sessions.filter((s) => !s.current).length ?? 0;
  return (
    <Card
      title={<span className="row" style={{ gap: 8 }}><Icon name="device" size={16} /> Where you're signed in</span>}
      sub="If you don't recognise a device, sign it out and change your password."
      action={others > 0 && <button className="btn sm danger" onClick={() => revoke({ all_others: true }, 'Signed out of all other devices')}>Sign out others</button>}
    >
      {!data ? (
        <Loading />
      ) : (
        <div>
          {data.sessions.map((s) => (
            <div className="device" key={s.id}>
              <div className="ic"><Icon name={/iPhone|Android/.test(s.user_agent ?? '') ? 'phoneDevice' : 'device'} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 14 }}>{deviceName(s.user_agent)}</b> {s.current && <span className="badge green">This device</span>}
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {s.ip ?? 'Unknown network'} · signed in {fmtDateTime(iso(s.created_at))}
                  {s.last_seen_at && now - Date.parse(s.last_seen_at) > 10 * 60_000 ? ` · last active ${fmtDateTime(iso(s.last_seen_at))}` : ' · active now'}
                </div>
              </div>
              {!s.current && <button className="btn sm ghost danger" onClick={() => revoke({ id: s.id }, 'Device signed out')}>Sign out</button>}
            </div>
          ))}
          {data.recovery_codes_left > 0 && data.recovery_codes_left < 4 && (
            <div className="error-box" style={{ marginTop: 12 }}>Only {data.recovery_codes_left} recovery codes left. Turn two-step sign-in off and on again to get a fresh set.</div>
          )}
        </div>
      )}
    </Card>
  );
}
