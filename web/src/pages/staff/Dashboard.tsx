import { Link } from 'react-router-dom';
import { useDesk } from '../../components/Desk';
import { DailyBars, HBars } from '../../components/charts';
import { Card, ErrorBox, Icon, Loading, PageHead, Stat } from '../../components/kit';
import { fmtDate, fmtDateLong, naira, nairaShort, pct } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { SetupChecklist } from './Settings';
import { addDays } from '../../lib/api';
import { useApi } from '../../lib/hooks';

export interface Kpis {
  roomNightsSold: number;
  roomNightsAvailable: number;
  occupancy: number;
  adr: number;
  revpar: number;
}

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
  kpis: Kpis;
  collections: { byMethod: Record<string, number>; bySource: Record<string, number>; total: number };
  stockPurchases: number;
  stockValue: number;
}

interface Dash {
  ops: {
    date: string;
    last_closed: string | null;
    rooms: { total: number; occupied: number; available: number; cleaning: number; maintenance: number; sellable: number };
    occupancy: number;
    arrivals: number;
    departures: number;
    requests: number;
    balances: { n: number; v: number };
    forecast: { date: string; booked: number; requested: number }[];
    arrivalsList: { id: number; guest_name: string; vip: number; room_type: string; room_number: string | null; status: string; nights: number }[];
  };
  today?: PnL;
  month?: PnL;
  collectedToday?: PnL['collections'];
  last30?: { date: string; rooms: number; bar: number; facilities: number; expenses: number; occupied: number }[];
  lowStock?: { id: number; name: string; stock: number; reorder_level: number; unit: string }[];
}

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Africa/Lagos' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
const wd = new Intl.DateTimeFormat('en-GB', { weekday: 'narrow', timeZone: 'UTC' });

export function KpiStrip({ k, title = 'Hotel performance', sub }: { k: Kpis; title?: string; sub?: string }) {
  return (
    <Card title={title} sub={sub} pad={false}>
      <div className="kpi-row">
        <div>
          <small>Occupancy <span className="info" title="Room-nights sold ÷ room-nights available">?</span></small>
          <b>{pct(k.occupancy)}</b>
          <p>{k.roomNightsSold} of {k.roomNightsAvailable} room-nights</p>
        </div>
        <div>
          <small>ADR <span className="info" title="Average daily rate: room revenue ÷ room-nights sold. What a sold room earns per night.">?</span></small>
          <b>{naira(k.adr)}</b>
          <p>average paid per occupied room</p>
        </div>
        <div>
          <small>RevPAR <span className="info" title="Revenue per available room: room revenue ÷ all room-nights. Combines price and occupancy in one number.">?</span></small>
          <b>{naira(k.revpar)}</b>
          <p>earned per room, full or empty</p>
        </div>
      </div>
    </Card>
  );
}

function Forecast({ data, rooms }: { data: Dash['ops']['forecast']; rooms: number }) {
  if (!rooms) {
    return (
      <Card title="Next 14 days" sub="How full the coming fortnight already is">
        <div className="empty">Add your rooms in Settings and bookings will show up here.</div>
      </Card>
    );
  }
  const peak = data.reduce((a, d) => (d.booked > a.booked ? d : a), data[0]);
  return (
    <Card title="Next 14 days" sub={peak.booked ? `On the books now · busiest: ${fmtDate(peak.date)} (${pct(peak.booked / rooms)})` : 'Nothing booked yet for the next two weeks'}>
      <div className="forecast" role="img" aria-label="Rooms booked for each of the next 14 days">
        {data.map((d, i) => (
          <div key={d.date} className={`col${i === 0 ? ' today' : ''}`}>
            <span className="tip">
              {fmtDateLong(d.date)}: {d.booked} booked{d.requested ? ` + ${d.requested} requested` : ''} of {rooms}
            </span>
            <div className="stack">
              <i style={{ height: `${(d.booked / rooms) * 100}%` }} />
              {d.requested > 0 && <i className="req" style={{ height: `${(d.requested / rooms) * 100}%` }} />}
            </div>
            <small>{i === 0 ? 'Today' : wd.format(new Date(`${d.date}T00:00:00Z`))}</small>
          </div>
        ))}
      </div>
      <div className="legend" style={{ marginTop: 12 }}>
        <span><i style={{ background: 'var(--gold)' }} /> Confirmed & in house</span>
        <span><i style={{ background: 'repeating-linear-gradient(135deg, #e8cf95, #e8cf95 3px, #f4ead3 3px, #f4ead3 6px)' }} /> Website requests</span>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const desk = useDesk();
  const { data, error } = useApi<Dash>(`/dashboard?v=${desk.version}`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const { ops, month, today, last30, lowStock, collectedToday } = data;
  const firstName = user!.name.replace(/^(Mrs?|Ms|Dr)\.?\s+/, '').split(' ')[0];

  const attention = [
    ops.requests > 0 && { to: '/staff/reservations?status=pending', icon: 'calendar', text: `${ops.requests} website booking request${ops.requests > 1 ? 's' : ''} to confirm`, tone: 'gold' },
    ops.departures > 0 && { to: '/staff/reservations?view=departures', icon: 'logout', text: `${ops.departures} guest${ops.departures > 1 ? 's' : ''} due to check out`, tone: 'blue' },
    ops.balances.n > 0 && { to: '/staff/reservations?view=balances', icon: 'receipt', text: `${ops.balances.n} in-house guest${ops.balances.n > 1 ? 's' : ''} owe ${naira(ops.balances.v)}`, tone: 'red' },
    ops.rooms.cleaning > 0 && { to: '/staff/front-desk', icon: 'sparkle', text: `${ops.rooms.cleaning} room${ops.rooms.cleaning > 1 ? 's' : ''} waiting for housekeeping`, tone: 'amber' },
    ops.rooms.maintenance > 0 && { to: '/staff/front-desk', icon: 'bolt', text: `${ops.rooms.maintenance} room${ops.rooms.maintenance > 1 ? 's' : ''} out of order`, tone: 'red' },
    !!lowStock?.length && { to: '/staff/inventory', icon: 'box', text: `${lowStock.length} bar item${lowStock.length > 1 ? 's' : ''} running low`, tone: 'amber' },
    user!.role === 'manager' && (!ops.last_closed || ops.last_closed < addDays(ops.date, -1)) && {
      to: '/staff/close-day', icon: 'moon', tone: 'blue',
      text: ops.last_closed ? `Books closed up to ${fmtDate(ops.last_closed)} — close ${fmtDate(addDays(ops.last_closed, 1))}` : 'Close each day at night to count the cash and lock the books',
    },
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

  const ArrivalsCard = (
    <Card title="Arriving today" sub={ops.arrivalsList.length ? `${ops.arrivalsList.length} expected` : 'No arrivals expected'} pad={false} action={<Link className="btn sm" to="/staff/calendar">Tape chart</Link>}>
      {ops.arrivalsList.length === 0 ? (
        <div className="empty">No one is due in today.</div>
      ) : (
        <table className="t">
          <tbody>
            {ops.arrivalsList.map((a) => (
              <tr key={a.id} className="click" onClick={() => desk.openReservation(a.id)}>
                <td>
                  <span className="strong">{a.guest_name}</span> {!!a.vip && <span className="vip">★ VIP</span>}
                  <div className="muted" style={{ fontSize: 12.5 }}>{a.room_type} · {a.nights} night{a.nights > 1 ? 's' : ''}</div>
                </td>
                <td className="r">{a.room_number ? <b>Room {a.room_number}</b> : <span className="badge amber">Assign room</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );

  const occupancyStat = (
    <Stat icon="bed" label="Occupancy tonight" value={pct(ops.occupancy)} foot={`${ops.rooms.occupied} of ${ops.rooms.sellable} rooms · ${ops.rooms.available} ready to sell`} />
  );

  if (!month || !today || !last30 || !collectedToday) {
    return (
      <>
        <PageHead title={`${greeting()}, ${firstName}`} sub={fmtDateLong(ops.date)}>
          <button className="btn primary" onClick={() => desk.newReservation({ walkIn: true })}><Icon name="plus" size={16} /> Walk-in</button>
        </PageHead>
        <div className="cards cols-4" style={{ marginBottom: 16 }}>
          {occupancyStat}
          <Stat icon="calendar" label="Arrivals today" value={ops.arrivals} />
          <Stat icon="logout" label="Departures today" value={ops.departures} />
          <Stat icon="sparkle" label="Website requests" value={ops.requests} />
        </div>
        <div className="cards cols-2" style={{ marginBottom: 16 }}>
          {ArrivalsCard}
          {AttentionCard}
        </div>
        <Forecast data={ops.forecast} rooms={ops.rooms.total} />
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
          <Icon name="chart" size={16} /> Profit &amp; loss
        </Link>
        <button className="btn primary" onClick={() => desk.newReservation()}><Icon name="plus" size={16} /> New booking</button>
      </PageHead>

      <div style={{ marginBottom: 16 }}><SetupChecklist /></div>

      <div className="cards cols-4" style={{ marginBottom: 16 }}>
        <Stat icon="receipt" label="Earned today" value={nairaShort(today.totalRevenue)} foot={`Rooms ${nairaShort(today.revenue[0].amount)} · Bar ${nairaShort(today.revenue[1].amount + today.revenue[2].amount)} · Other ${nairaShort(today.revenue.slice(3).reduce((a, r) => a + r.amount, 0))}`} />
        <Stat icon="bolt" label="Cash collected today" value={nairaShort(collectedToday.total)} foot={`Cash ${nairaShort(collectedToday.byMethod.cash ?? 0)} · Transfer ${nairaShort(collectedToday.byMethod.transfer ?? 0)} · POS ${nairaShort(collectedToday.byMethod.pos ?? 0)}`} />
        <Stat
          icon="sparkle"
          label="Profit this month"
          value={<span style={{ color: month.netProfit < 0 ? 'var(--red)' : undefined }}>{nairaShort(month.netProfit)}</span>}
          foot={<>{pct(margin)} of {nairaShort(month.totalRevenue)} revenue kept</>}
        />
        {occupancyStat}
      </div>

      <div className="cards cols-2" style={{ marginBottom: 16 }}>
        <KpiStrip k={month.kpis} title="This month's performance" sub={`${fmtDate(month.from)} – ${fmtDate(month.to)} · the numbers investors ask for`} />
        <Forecast data={ops.forecast} rooms={ops.rooms.total} />
      </div>

      <div className="cards cols-main" style={{ marginBottom: 16 }}>
        <Card title="Earned each day, last 30 days" sub={`Rooms, bar and facilities · daily average ${naira(avg)}`}>
          <DailyBars
            label="Daily revenue over the last 30 days"
            data={series}
            tooltip={(d) => {
              const x = series.find((s) => s.date === d.date)!;
              return (
                <>
                  {fmtDateLong(d.date)} · {x.occupied} rooms
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
        {ArrivalsCard}
        {AttentionCard}
        <Card title="Where this month's money went" sub={`${naira(month.totalCostOfSales + month.totalOperating)} in costs`} action={lowStock?.length ? <Link className="btn sm" to="/staff/purchases">Restock</Link> : undefined}>
          <HBars tone="ink" rows={costs} />
        </Card>
      </div>
    </>
  );
}
