import { useEffect, useState } from 'react';
import { useDesk } from '../../components/Desk';
import { EmptyIllo } from '../../components/illustrations';
import { Card, EmptyState, ErrorBox, Icon, Loading, PageHead, Stat, Tabs } from '../../components/ui';
import { fmtDate, naira } from '../../lib/api';
import { useApi } from '../../lib/hooks';

interface Row {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  vip: number;
  stays: number;
  nights: number;
  spend: number;
  last_stay: string | null;
  next_stay: string | null;
}

export default function Guests() {
  const desk = useDesk();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'spend' | 'recent' | 'name'>('spend');
  const [vip, setVip] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error } = useApi<Row[]>(`/guests?q=${encodeURIComponent(query)}&sort=${sort}${vip ? '&vip=1' : ''}&v=${desk.version}`);

  const returning = data?.filter((g) => g.stays > 1).length ?? 0;
  const withStays = data?.filter((g) => g.stays > 0).length ?? 0;

  return (
    <>
      <PageHead title="Guests" sub="Everyone who has stayed or booked. Repeat guests are recognised by phone number.">
        <button className="btn primary" onClick={() => desk.newReservation()}>
          <Icon name="plus" size={16} /> New booking
        </button>
      </PageHead>

      {data && !query && !vip && (
        <div className="cards cols-4" style={{ marginBottom: 16 }}>
          <Stat icon="user" label="Guest profiles" value={data.length >= 200 ? '200+' : data.length} />
          <Stat icon="history" label="Came back again" value={returning} foot={withStays ? `${Math.round((returning / withStays) * 100)}% of guests who stayed` : undefined} />
          <Stat icon="star" label="VIPs" value={data.filter((g) => g.vip).length} />
          <Stat icon="receipt" label="Top guest's lifetime spend" value={naira(data[0]?.spend ?? 0)} foot={data[0]?.name} />
        </div>
      )}

      <div className="row" style={{ marginBottom: 12 }}>
        <Tabs value={sort} onChange={setSort} options={[{ value: 'spend', label: 'Top spenders' }, { value: 'recent', label: 'Recent' }, { value: 'name', label: 'A–Z' }]} />
        <button className={`btn sm${vip ? ' gold' : ''}`} onClick={() => setVip(!vip)}>
          <Icon name="star" size={14} /> VIPs only
        </button>
        <span className="spacer" />
        <input className="input" style={{ width: 260 }} placeholder="Search name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <Card pad={false}>
        <ErrorBox error={error} />
        {!data ? (
          <Loading />
        ) : data.length === 0 ? (
          <EmptyState illo={<EmptyIllo kind="key" />} title="No guests match">Try a different name or phone number.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Guest</th>
                  <th className="r">Stays</th>
                  <th className="r">Nights</th>
                  <th className="r">Lifetime spend</th>
                  <th>Last stay</th>
                  <th>Next</th>
                </tr>
              </thead>
              <tbody>
                {data.map((g) => (
                  <tr key={g.id} className="click" onClick={() => desk.openGuest(g.id)}>
                    <td>
                      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                        <span className="strong">{g.name}</span>
                        {!!g.vip && <span className="vip">★ VIP</span>}
                      </div>
                      <div className="muted" style={{ fontSize: 12.5 }}>{g.phone}{g.email ? ` · ${g.email}` : ''}</div>
                    </td>
                    <td className="r">{g.stays}</td>
                    <td className="r">{g.nights}</td>
                    <td className="r strong">{naira(g.spend)}</td>
                    <td className="muted">{g.last_stay ? fmtDate(g.last_stay) : '—'}</td>
                    <td>{g.next_stay ? <span className="badge gold plain">{fmtDate(g.next_stay)}</span> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
