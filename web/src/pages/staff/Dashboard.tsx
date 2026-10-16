import { Link } from 'react-router-dom';
import { Card, ErrorBox, Icon, Loading, PageHead, Stat } from '../../components/ui';
import { DailyBars, HBars } from '../../components/charts';
import { fmtDate, fmtDateLong, naira, nairaShort, pct } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';

export interface PnL {
  from: string;
  to: string;
  revenue: { key: string; label: string; group: 'core' | 'other'; amount: number }[];
  totalRevenue: number;
  costOfSales: { key: string; label: string; amount: number }[];
  totalCostOfSales: number;
  grossProfit: number;
  operating: { key: string; label: string; amount: number }[];
  totalOperating: number;
  netProfit: number;
  stockPurchases: number;
  stockValue: number;
}

interface Dash {
  ops: {
    date: string;
    rooms: { total: number; occupied: number; available: number; cleaning: number; maintenance: number; sellable: number };
    occupancy: number;
    arrivals: number;
    departures: number;
    requests: number;
    balances: { n: number; v: number };
  };
  today?: PnL;
  month?: PnL;
  last30?: { date: string; rooms: number; bar: number; facilities: number; expenses: number }[];
  lowStock?: { id: number; name: string; stock: number; reorder_level: number; unit: string }[];
}

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Africa/Lagos' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export default function Dashboard() {
  const { user } = useAuth();
  const { data, error } = useApi<Dash>('/dashboard');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const { ops, month, today, last30, lowStock } = data;
  const firstName = user!.name.replace(/^(Mrs?|Ms|Dr)\.?\s+/, '').split(' ')[0];

  const attention = [
    ops.requests > 0 && { to: '/staff/reservations?status=pending', icon: 'calendar', text: `${ops.requests} website booking request${ops.requests > 1 ? 's' : ''} to confirm`, tone: 'gold' },
    ops.arrivals > 0 && { to: '/staff/reservations?view=arrivals', icon: 'bed', text: `${ops.arrivals} arrival${ops.arrivals > 1 ? 's' : ''} expected today`, tone: 'blue' },
    ops.departures > 0 && { to: '/staff/reservations?view=departures', icon: 'logout', text: `${ops.departures} guest${ops.departures > 1 ? 's' : ''} due to check out`, tone: 'blue' },
    ops.balances.n > 0 && { to: '/staff/reservations?view=inhouse', icon: 'receipt', text: `${ops.balances.n} in-house guest${ops.balances.n > 1 ? 's' : ''} owe ${naira(ops.balances.v)}`, tone: 'red' },
    ops.rooms.cleaning > 0 && { to: '/staff/front-desk', icon: 'sparkle', text: `${ops.rooms.cleaning} room${ops.rooms.cleaning > 1 ? 's' : ''} waiting for housekeeping`, tone: 'amber' },
    ops.rooms.maintenance > 0 && { to: '/staff/front-desk', icon: 'bolt', text: `${ops.rooms.maintenance} room${ops.rooms.maintenance > 1 ? 's' : ''} out of order`, tone: 'red' },
    !!lowStock?.length && { to: '/staff/inventory', icon: 'box', text: `${lowStock.length} bar item${lowStock.length > 1 ? 's' : ''} running low`, tone: 'amber' },
  ].filter(Boolean) as { to: string; icon: string; text: string; tone: string }[];

  const AttentionCard = (
    <Card title="Needs attention" sub={attention.length ? `${attention.length} thing${attention.length > 1 ? 's' : ''}` : 'All clear'} pad={false}>
      {attention.length === 0 ? (
        <div className="empty">Nothing waiting. Enjoy the calm.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {attention.map((a) => (
            <li key={a.text} style={{ borderBottom: '1px solid var(--line)' }}>
              <Link to={a.to} className="row" style={{ padding: '14px 20px', textDecoration: 'none', flexWrap: 'nowrap' }}>
                <span className={`badge plain ${a.tone}`} style={{ width: 32, height: 32, padding: 0, justifyContent: 'center' }}>
                  <Icon name={a.icon} size={16} />
                </span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{a.text}</span>
                <span className="spacer" />
                <Icon name="arrow" size={16} className="muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  const occupancyStat = (
    <Stat icon="bed" label="Occupancy tonight" value={pct(ops.occupancy)} foot={`${ops.rooms.occupied} of ${ops.rooms.sellable} rooms · ${ops.rooms.available} ready to sell`} />
  );

  if (!month || !today || !last30) {
    return (
      <>
        <PageHead title={`${greeting()}, ${firstName}`} sub={fmtDateLong(ops.date)} />
        <div className="cards cols-4" style={{ marginBottom: 16 }}>
          {occupancyStat}
          <Stat icon="calendar" label="Arrivals today" value={ops.arrivals} />
          <Stat icon="logout" label="Departures today" value={ops.departures} />
          <Stat icon="sparkle" label="Website requests" value={ops.requests} />
        </div>
        <div className="cards cols-2">{AttentionCard}</div>
      </>
    );
  }

  const margin = month.totalRevenue ? month.netProfit / month.totalRevenue : 0;
  const series = last30.map((d) => ({ ...d, value: d.rooms + d.bar + d.facilities }));
  const avg = series.slice(0, -1).reduce((a, d) => a + d.value, 0) / Math.max(1, series.length - 1);
  const core = month.revenue.filter((r) => r.group === 'core');
  const other = month.revenue.filter((r) => r.group === 'other');
  const otherTotal = other.reduce((a, r) => a + r.amount, 0);
  const costs = [
    { label: 'Drinks & snacks sold (cost)', value: month.costOfSales.filter((c) => c.key.startsWith('cogs')).reduce((a, c) => a + c.amount, 0) },
    ...month.costOfSales.filter((c) => !c.key.startsWith('cogs')).map((c) => ({ label: c.label, value: c.amount })),
    ...month.operating.map((c) => ({ label: c.label, value: c.amount })),
  ]
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  return (
    <>
      <PageHead title={`${greeting()}, ${firstName}`} sub={`${fmtDateLong(ops.date)} · here's how Danest is doing`}>
        <Link to="/staff/reports" className="btn">
          <Icon name="chart" size={16} /> Full profit &amp; loss
        </Link>
      </PageHead>

      <div className="cards cols-4" style={{ marginBottom: 16 }}>
        <Stat icon="receipt" label="Taken today" value={nairaShort(today.totalRevenue)} foot={`Rooms ${nairaShort(today.revenue[0].amount)} · Bar ${nairaShort(today.revenue[1].amount + today.revenue[2].amount)}`} />
        <Stat icon="chart" label="Revenue this month" value={nairaShort(month.totalRevenue)} foot={`${fmtDate(month.from)} – ${fmtDate(month.to)}`} />
        <Stat
          icon="sparkle"
          label="Profit this month"
          value={<span style={{ color: month.netProfit < 0 ? 'var(--red)' : undefined }}>{nairaShort(month.netProfit)}</span>}
          foot={<>{pct(margin)} of revenue kept after all costs</>}
        />
        {occupancyStat}
      </div>

      <div className="cards cols-main" style={{ marginBottom: 16 }}>
        <Card title="Money in, last 30 days" sub={`Rooms, bar and facilities · daily average ${naira(avg)}`}>
          <DailyBars
            label="Daily revenue over the last 30 days"
            data={series}
            tooltip={(d) => {
              const x = series.find((s) => s.date === d.date)!;
              return (
                <>
                  {fmtDateLong(d.date)}
                  <br />
                  <b>{naira(d.value)}</b>
                  <br />
                  Rooms {nairaShort(x.rooms)} · Bar {nairaShort(x.bar)} · Facilities {nairaShort(x.facilities)}
                </>
              );
            }}
          />
        </Card>
        <Card title="Where this month's money came from" sub={`Other income is ${pct(month.totalRevenue ? otherTotal / month.totalRevenue : 0)} of the total`}>
          <div className="stack" style={{ gap: 20 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Main business</div>
              <HBars rows={core.map((r) => ({ label: r.label, value: r.amount }))} />
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Other income</div>
              <HBars rows={other.map((r) => ({ label: r.label, value: r.amount }))} />
            </div>
          </div>
        </Card>
      </div>

      <div className="cards cols-3">
        {AttentionCard}
        <Card title="Where this month's money went" sub={`${naira(month.totalCostOfSales + month.totalOperating)} in costs`}>
          <HBars tone="ink" rows={costs} />
        </Card>
        <Card title="Running low at the bar" sub="At or below reorder level" action={<Link className="btn sm" to="/staff/purchases">Restock</Link>} pad={false}>
          {lowStock?.length ? (
            <table className="t">
              <tbody>
                {lowStock.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="r">
                      <span className={`badge ${p.stock === 0 ? 'red' : 'amber'}`}>
                        {p.stock === 0 ? 'Out' : `${p.stock} left`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">Everything is well stocked.</div>
          )}
        </Card>
      </div>
    </>
  );
}
