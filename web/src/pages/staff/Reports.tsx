import { DailyBars } from '../../components/charts';
import { DateRange, useRange } from '../../components/DateRange';
import { Card, ErrorBox, Icon, Loading, PageHead, Stat } from '../../components/ui';
import { fmtDate, fmtDateLong, naira, nairaShort, pct } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { KpiStrip, type Kpis, type PnL } from './Dashboard';

interface Report extends PnL {
  previous: { from: string; to: string; totalRevenue: number; netProfit: number; kpis: Kpis };
  daily: { date: string; rooms: number; bar: number; facilities: number; expenses: number; occupied: number }[];
  rooms: number;
}

function Delta({ now, before }: { now: number; before: number }) {
  if (!before) return <span className="muted">no earlier data</span>;
  const d = (now - before) / Math.abs(before);
  return (
    <span className={d >= 0 ? 'delta-up' : 'delta-down'}>
      {d >= 0 ? '▲' : '▼'} {pct(Math.abs(d))} <span className="muted" style={{ fontWeight: 500 }}>vs previous period</span>
    </span>
  );
}

export default function Reports() {
  const range = useRange('month');
  const { data: p, error } = useApi<Report>(`/reports/pnl?${range.qs}`);

  return (
    <>
      <PageHead title="Profit & loss" sub="Everything the hotel earned, minus everything it cost — for any period you choose.">
        <a className="btn" href={`/api/reports/pnl.csv?${range.qs}`} download>
          <Icon name="download" size={16} /> Download for Excel
        </a>
        <button className="btn" onClick={() => print()}>Print</button>
      </PageHead>
      <div className="row" style={{ marginBottom: 16 }}>
        <DateRange state={range} />
      </div>
      <ErrorBox error={error} />
      {!p ? (
        <Loading />
      ) : (
        <>
          <div className="cards cols-4" style={{ marginBottom: 16 }}>
            <Stat label="Revenue" value={nairaShort(p.totalRevenue)} foot={<Delta now={p.totalRevenue} before={p.previous.totalRevenue} />} />
            <Stat label="Gross profit" value={nairaShort(p.grossProfit)} foot={`${pct(p.totalRevenue ? p.grossProfit / p.totalRevenue : 0)} after cost of sales`} />
            <Stat label="Running costs" value={nairaShort(p.totalOperating)} foot={`${pct(p.totalRevenue ? p.totalOperating / p.totalRevenue : 0)} of revenue`} />
            <Stat
              label="Net profit"
              value={<span style={{ color: p.netProfit < 0 ? 'var(--red)' : 'var(--green)' }}>{nairaShort(p.netProfit)}</span>}
              foot={<Delta now={p.netProfit} before={p.previous.netProfit} />}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <KpiStrip
              k={p.kpis}
              title="Room performance"
              sub={`Before: occupancy ${pct(p.previous.kpis.occupancy)} · ADR ${naira(p.previous.kpis.adr)} · RevPAR ${naira(p.previous.kpis.revpar)} (${fmtDate(p.previous.from)} – ${fmtDate(p.previous.to)})`}
            />
          </div>

          <div className="cards cols-main" style={{ alignItems: 'start' }}>
            <Card pad={false} title="Statement" sub={`${fmtDateLong(p.from)} – ${fmtDateLong(p.to)}`}>
              <table className="pnl">
                <tbody>
                  <tr className="section"><td colSpan={2}>Revenue — main business</td></tr>
                  {p.revenue.filter((r) => r.group === 'core').map((r) => <tr key={r.key}><td className="indent">{r.label}</td><td>{naira(r.amount)}</td></tr>)}
                  <tr className="section"><td colSpan={2}>Revenue — other income</td></tr>
                  {p.revenue.filter((r) => r.group === 'other').map((r) => <tr key={r.key}><td className="indent">{r.label}</td><td>{naira(r.amount)}</td></tr>)}
                  <tr className="sub"><td>Total revenue</td><td>{naira(p.totalRevenue)}</td></tr>

                  <tr className="section"><td colSpan={2}>Cost of sales</td></tr>
                  {p.costOfSales.map((r) => <tr key={r.key}><td className="indent">{r.label}</td><td>({naira(r.amount)})</td></tr>)}
                  <tr className="sub"><td>Gross profit</td><td>{naira(p.grossProfit)}</td></tr>

                  <tr className="section"><td colSpan={2}>Running costs</td></tr>
                  {p.operating.map((r) => <tr key={r.key}><td className="indent">{r.label}</td><td>({naira(r.amount)})</td></tr>)}
                  <tr className="sub"><td>Total running costs</td><td>({naira(p.totalOperating)})</td></tr>

                  <tr className="total">
                    <td>Net profit</td>
                    <td style={{ color: p.netProfit < 0 ? 'var(--red)' : 'var(--green)' }}>{naira(p.netProfit)}</td>
                  </tr>
                  <tr className="memo"><td>Memo: stock bought in this period</td><td>{naira(p.stockPurchases)}</td></tr>
                  <tr className="memo"><td>Memo: stock on the shelf today (at cost)</td><td>{naira(p.stockValue)}</td></tr>
                </tbody>
              </table>
            </Card>

            <div className="stack">
              {p.daily.length > 0 && (
                <Card title="Money in, day by day" sub="Rooms, bar and facilities">
                  <DailyBars
                    height={240}
                    label="Daily revenue"
                    data={p.daily.map((d) => ({ date: d.date, value: d.rooms + d.bar + d.facilities }))}
                    tooltip={(d) => {
                      const x = p.daily.find((y) => y.date === d.date)!;
                      return (
                        <>
                          {fmtDate(d.date)} · <b>{naira(d.value)}</b>
                          <br />
                          {x.occupied} of {p.rooms} rooms · spent {naira(x.expenses)}
                        </>
                      );
                    }}
                  />
                </Card>
              )}
              <Card title="Money actually collected" sub="Cash in hand and in the bank — room-bill charges count once the guest pays">
                <div className="stack" style={{ gap: 10 }}>
                  {(['cash', 'transfer', 'pos'] as const).map((m) => (
                    <div key={m} className="row" style={{ justifyContent: 'space-between' }}>
                      <span>{{ cash: 'Cash', transfer: 'Bank transfer', pos: 'POS / card' }[m]}</span>
                      <b className="num">{naira(p.collections.byMethod[m] ?? 0)}</b>
                    </div>
                  ))}
                  <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                    <b>Total collected</b>
                    <b className="num">{naira(p.collections.total)}</b>
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {Object.entries(p.collections.bySource).map(([k, v]) => `${k} ${nairaShort(v)}`).join(' · ')}
                  </div>
                </div>
              </Card>
              <Card title="How to read this">
                <div className="stack muted" style={{ fontSize: 14, gap: 10 }}>
                  <p><b style={{ color: 'var(--ink)' }}>Rooms</b> are earned night by night, the way a night audit posts them: each night a guest sleeps here earns that stay's rate, whenever they pay.</p>
                  <p><b style={{ color: 'var(--ink)' }}>Collected</b> is the cash side: what actually arrived by cash, transfer or POS in the period.</p>
                  <p><b style={{ color: 'var(--ink)' }}>Drinks &amp; confectionery</b> are charged at what each item cost when it was sold, so a big restock doesn't make one month look bad.</p>
                  <p><b style={{ color: 'var(--ink)' }}>Room supplies &amp; laundry</b> sit in cost of sales because they rise and fall with how many rooms you sell. Salaries, diesel, NEPA and repairs are running costs.</p>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
