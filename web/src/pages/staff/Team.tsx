import { useEffect, useState, type FormEvent } from 'react';
import { ROLES, ROLE_HELP, ROLE_LABELS, type Role } from '../../../../shared/constants';
import { Card, ErrorBox, Field, Icon, Loading, Modal, PageHead, Tabs, useSubmit, useToast } from '../../components/kit';
import { api, fmtDateTime, naira } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';

interface U { id: number; name: string; username: string; role: Role; active: number; totp_enabled: number; last_login_at: string | null; created_at: string }
interface A { id: number; action: string; entity: string; entity_id: number | null; detail: string | null; created_at: string; user: string | null }

const ACTION_TEXT: Record<string, string> = {
  login: 'signed in', login_failed: 'failed sign-in', create: 'created', update: 'updated', delete: 'deleted', confirm: 'confirmed', cancel: 'cancelled',
  check_in: 'checked in', check_out: 'checked out', check_out_with_balance: 'checked out WITH BALANCE OWED', payment: 'took a payment on', room_status: 'changed status of',
  stock_adjust: 'adjusted stock of', rate_change: 'changed rate of', booking_request: 'website booking request', password_change: 'changed password', seed: 'loaded demo data',
  mfa_enabled: 'turned on two-step sign-in', mfa_disabled: 'turned OFF two-step sign-in', mfa_failed: 'entered a wrong sign-in code', login_recovery_code: 'signed in with a recovery code',
  sessions_revoked: 'signed out other devices', session_revoked: 'signed out a device', room_charge: 'charged to room', change_dates: 'changed dates of', room_move: 'moved room for',
};

function describe(a: A) {
  let d: Record<string, unknown> = {};
  try { d = a.detail ? JSON.parse(a.detail) : {}; } catch { /* keep empty */ }
  const bits: string[] = [];
  if (typeof d.amount === 'number') bits.push(naira(d.amount));
  if (typeof d.balance === 'number') bits.push(`owed ${naira(d.balance)}`);
  if (typeof d.total === 'number') bits.push(naira(d.total));
  if (typeof d.reason === 'string') bits.push(`“${d.reason}”`);
  if (typeof d.change === 'number') bits.push(`${d.change > 0 ? '+' : ''}${d.change}`);
  if (typeof d.username === 'string') bits.push(d.username);
  if (typeof d.status === 'string') bits.push(d.status);
  return bits.join(' · ');
}

export default function Team() {
  const [tab, setTab] = useState<'team' | 'activity'>('team');
  return (
    <>
      <PageHead title="Team & activity" sub="Who can sign in, what they can see, and a record of everything important they do." />
      <div style={{ marginBottom: 16 }}>
        <Tabs value={tab} onChange={setTab} options={[{ value: 'team', label: 'Team' }, { value: 'activity', label: 'Activity log' }]} />
      </div>
      {tab === 'team' ? <TeamList /> : <Activity />}
    </>
  );
}

function TeamList() {
  const { user } = useAuth();
  const { data, error, reload } = useApi<U[]>('/users');
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<U | null>(null);
  const toast = useToast();

  const resetMfa = async (u: U) => {
    await api(`/users/${u.id}`, { method: 'PATCH', body: { reset_2fa: true } }).then(
      () => (toast(`Two-step sign-in reset for ${u.name}`), reload()),
      (e) => toast(e.message),
    );
  };

  const toggle = async (u: U) => {
    await api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }).then(
      () => (toast(u.active ? `${u.name} can no longer sign in` : `${u.name} can sign in again`), reload()),
      (e) => toast(e.message),
    );
  };

  return (
    <Card pad={false} title="Staff accounts" action={<button className="btn primary sm" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add staff</button>}>
      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Two-step</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td className="strong">{u.name}{u.id === user!.id && <span className="muted"> (you)</span>}</td>
                  <td className="muted">{u.username}</td>
                  <td>{ROLE_LABELS[u.role]}</td>
                  <td>{u.totp_enabled ? <span className="badge green"><Icon name="shield" size={12} /> On</span> : <span className={`badge ${u.role === 'manager' ? 'amber' : ''}`}>Off</span>}</td>
                  <td className="muted num">{u.last_login_at ? fmtDateTime(u.last_login_at.replace('T', ' ').replace(/\.\d+Z$/, '')) : 'Never'}</td>
                  <td>{u.active ? <span className="badge green">Active</span> : <span className="badge">Disabled</span>}</td>
                  <td className="r" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" onClick={() => setResetting(u)}>Reset password</button>
                    {!!u.totp_enabled && u.id !== user!.id && (
                      <button className="btn ghost sm" onClick={() => confirm(`Turn off two-step sign-in for ${u.name}? Do this only if they lost their phone — they should set it up again.`) && resetMfa(u)}>
                        Reset 2-step
                      </button>
                    )}
                    {u.id !== user!.id && <button className="btn ghost sm danger" onClick={() => toggle(u)}>{u.active ? 'Disable' : 'Enable'}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card-body muted" style={{ fontSize: 13.5, borderTop: '1px solid var(--line)' }}>
        <b style={{ color: 'var(--ink)' }}>Managers</b> see everything. <b style={{ color: 'var(--ink)' }}>Front desk</b> handles rooms, guests and gym/pool/lounge takings but never sees profit or costs.{' '}
        <b style={{ color: 'var(--ink)' }}>Bar &amp; shop</b> uses the till and sees stock levels, not cost prices.{' '}
        <b style={{ color: 'var(--ink)' }}>Housekeeping</b> sees the rooms to clean and reports repairs, from a phone.
      </div>
      {adding && <UserForm onClose={() => setAdding(false)} onSaved={() => (setAdding(false), reload())} />}
      {resetting && <ResetForm u={resetting} onClose={() => setResetting(null)} />}
    </Card>
  );
}

function UserForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', username: '', role: 'frontdesk' as Role, password: '' });
  const { busy, error, submit } = useSubmit();
  const toast = useToast();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(async () => {
      await api('/users', { body: f });
      toast(`${f.name} can now sign in as “${f.username}”`);
      onSaved();
    });
  };
  return (
    <Modal title="Add a staff member" onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <Field label="Full name" hint="Their real name — it appears on everything they do in the activity log"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={3} maxLength={80} /></Field>
        <div className="grid-2">
          <Field label="Username" hint="Letters, numbers, dots"><input className="input" autoCapitalize="none" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} required pattern="[a-z0-9._\-]{3,32}" /></Field>
          <Field label="Role">
            <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </Field>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>{ROLE_HELP[f.role]}</p>
        <Field label="Temporary password" hint="At least 10 characters. Ask them to change it after signing in."><input className="input" type="text" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={10} /></Field>
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Add staff</button>
        </div>
      </form>
    </Modal>
  );
}

function ResetForm({ u, onClose }: { u: U; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const { busy, error, submit } = useSubmit();
  const toast = useToast();
  return (
    <Modal title={`New password for ${u.name}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), submit(async () => (await api(`/users/${u.id}`, { method: 'PATCH', body: { password: pw } }), toast('Password reset — they have been signed out everywhere'), onClose())))}>
        <Field label="New password" hint="At least 10 characters"><input className="input" type="text" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={10} /></Field>
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Reset password</button>
        </div>
      </form>
    </Modal>
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
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <Card
      pad={false}
      title="Activity log"
      sub="Sign-ins, money movements, stock corrections and deletions — the latest 300"
      action={<input className="input" style={{ width: 220, height: 34 }} placeholder="Filter: payment, login, Grace…" value={q} onChange={(e) => setQ(e.target.value)} />}
    >
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id}>
                <td className="num muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.created_at)}</td>
                <td>{a.user ?? <span className="muted">{a.action === 'booking_request' ? 'Guest website' : 'Unknown'}</span>}</td>
                <td>
                  <span style={/balance|failed|delete|disabled/.test(a.action) ? { color: 'var(--red)', fontWeight: 700 } : undefined}>
                    {ACTION_TEXT[a.action] ?? a.action}
                  </span>{' '}
                  <span className="muted">{a.entity.replace('_', ' ')}{a.entity_id ? ` #${a.entity_id}` : ''}</span>
                </td>
                <td className="muted">{describe(a)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
