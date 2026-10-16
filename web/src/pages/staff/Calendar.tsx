import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReservationStatus, RoomStatus } from '../../../../shared/constants';
import { useDesk } from '../../components/Desk';
import { Card, ErrorBox, Icon, Loading, PageHead, StatusBadge, Tabs } from '../../components/kit';
import { addDays, fmtDate, naira, nightsBetween, todayISO } from '../../lib/api';
import { useApi } from '../../lib/hooks';

interface Data {
  from: string;
  days: number;
  today: string;
  rooms: { id: number; number: string; floor: number; status: RoomStatus; room_type: string; room_type_id: number }[];
  stays: { id: number; code: string; room_id: number | null; room_type_id: number; check_in: string; check_out: string; status: ReservationStatus; guest_name: string; guest_vip: number; balance: number }[];
}

const MIN_DAY = 56;
const ROW = 46;
const RAIL = 150;
const HEAD = 52;
const ROOM_DOT: Record<RoomStatus, string> = { available: 'var(--green)', occupied: 'var(--blue)', cleaning: 'var(--amber)', maintenance: 'var(--red)' };
const wd = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });
const mon = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function Calendar() {
  const desk = useDesk();
  const t = todayISO();
  const [from, setFrom] = useState(addDays(t, -2));
  const [days, setDays] = useState<'14' | '21' | '28'>('14');
  const { data, error } = useApi<Data>(`/calendar?from=${from}&days=${days}&v=${desk.version}`);

  // Columns stretch to fill the screen, but never squeeze below a readable width.
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [!!data]);
  const DAY = Math.max(MIN_DAY, Math.floor((width - RAIL - 2) / Number(days)));

  const dates = useMemo(() => Array.from({ length: Number(days) }, (_, i) => addDays(from, i)), [from, days]);
  const rowOf = useMemo(() => new Map((data?.rooms ?? []).map((r, i) => [r.id, i])), [data]);

  if (error) return <ErrorBox error={error} />;

  const unassigned = data?.stays.filter((s) => !s.room_id && s.status !== 'checked_out') ?? [];
  const end = addDays(from, Number(days));
  const occupiedTonight = data?.stays.filter((s) => s.room_id && s.check_in <= t && (s.status === 'checked_in' || (s.status === 'confirmed' && s.check_out > t))).length ?? 0;

  return (
    <>
      <PageHead title="Tape chart" sub={`${mon.format(new Date(`${from}T00:00:00Z`))} · ${occupiedTonight} of ${data?.rooms.length ?? '–'} rooms taken tonight. Click an empty night to book it.`}>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => setFrom(addDays(from, -7))} aria-label="Previous week">‹</button>
          <button className="btn sm" onClick={() => setFrom(addDays(t, -2))}>Today</button>
          <button className="btn sm" onClick={() => setFrom(addDays(from, 7))} aria-label="Next week">›</button>
        </div>
        <Tabs value={days} onChange={setDays} options={[{ value: '14', label: '2 weeks' }, { value: '21', label: '3 weeks' }, { value: '28', label: '4 weeks' }]} />
        <button className="btn primary" onClick={() => desk.newReservation()}>
          <Icon name="plus" size={16} /> New
        </button>
      </PageHead>

      <div className="legend" style={{ marginBottom: 12 }}>
        <span><i style={{ background: 'var(--ink)' }} /> In house</span>
        <span><i style={{ background: 'var(--gold)' }} /> Confirmed</span>
        <span><i style={{ background: 'var(--gold-soft)', outline: '1.5px dashed var(--gold)' }} /> Website request</span>
        <span><i style={{ background: '#e8e2d6' }} /> Departed</span>
        <span><i style={{ background: '#ff7a6b', width: 8, height: 8, borderRadius: 4 }} /> Owes money</span>
      </div>

      {!data ? (
        <div ref={wrap}><Card><Loading /></Card></div>
      ) : (
        <div className="card tape" ref={wrap} style={{ ['--day' as string]: `${DAY}px` } as React.CSSProperties}>
          <div className="tape-grid" style={{ gridTemplateColumns: `${RAIL}px repeat(${days}, ${DAY}px)` }}>
            <div className="tape-corner">Room</div>
            {dates.map((d) => {
              const w = new Date(`${d}T00:00:00Z`).getUTCDay();
              return (
                <div key={d} className={`tape-head${w === 0 || w === 6 ? ' weekend' : ''}${d === t ? ' today' : ''}`}>
                  <div>
                    {wd.format(new Date(`${d}T00:00:00Z`))}
                    <b>{Number(d.slice(8))}</b>
                  </div>
                </div>
              );
            })}
            {data.rooms.map((r) => (
              <Row key={r.id} room={r} dates={dates} today={t} onBook={(d) => desk.newReservation({ roomId: r.id, typeId: r.room_type_id, checkIn: d, checkOut: addDays(d, 1), walkIn: d === t && r.status === 'available' })} />
            ))}

            {/* the "now" line sits at the middle of today */}
            {t >= from && t < end && <div className="tape-now" style={{ left: RAIL + nightsBetween(from, t) * DAY + DAY / 2 }} />}

            {data.stays.map((s) => {
              const row = s.room_id ? rowOf.get(s.room_id) : undefined;
              if (row === undefined) return null;
              // Bars run from the middle of the arrival day to the middle of the departure day, like a paper tape chart.
              const startCol = nightsBetween(from, s.check_in);
              const endCol = nightsBetween(from, s.check_out);
              const left = RAIL + Math.max(startCol * DAY + DAY / 2, 0);
              const right = RAIL + Math.min(endCol * DAY + DAY / 2, Number(days) * DAY);
              if (right <= left) return null;
              return (
                <button
                  key={s.id}
                  className={`tape-bar ${s.status}`}
                  style={{ left: left + 2, width: right - left - 4, top: HEAD + row * ROW + 6 }}
                  onClick={() => desk.openReservation(s.id)}
                  title={`${s.guest_name} · ${fmtDate(s.check_in)} → ${fmtDate(s.check_out)}${s.balance > 0 ? ` · owes ${naira(s.balance)}` : ''}`}
                >
                  {s.balance > 0 && s.status !== 'pending' && s.status !== 'confirmed' && <span className="owe" />}
                  {!!s.guest_vip && <span aria-label="VIP">★</span>}
                  {s.guest_name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {unassigned.length > 0 && (
        <Card title="Not yet given a room" sub="Confirmed bookings and website requests in this period. Open one to assign a room." pad={false}>
          <div className="table-wrap">
            <table className="t">
              <tbody>
                {unassigned.map((s) => (
                  <tr key={s.id} className="click" onClick={() => desk.openReservation(s.id)}>
                    <td className="strong">{s.guest_name}</td>
                    <td className="num">{fmtDate(s.check_in)} → {fmtDate(s.check_out)}</td>
                    <td>{data?.rooms.find((r) => r.room_type_id === s.room_type_id)?.room_type}</td>
                    <td><StatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function Row({ room, dates, today, onBook }: { room: Data['rooms'][number]; dates: string[]; today: string; onBook: (d: string) => void }) {
  return (
    <>
      <div className="tape-room">
        <b>{room.number}</b>
        <span className="muted" style={{ fontSize: 12 }}>{room.room_type.replace(' Room', '').replace(' Suite', ' ste')}</span>
        <span className="dot" style={{ background: ROOM_DOT[room.status] }} title={room.status} />
      </div>
      {dates.map((d) => {
        const w = new Date(`${d}T00:00:00Z`).getUTCDay();
        const blocked = room.status === 'maintenance' && d <= addDays(today, 2);
        const past = d < today;
        return (
          <div
            key={d}
            className={`tape-cell${w === 0 || w === 6 ? ' weekend' : ''}${d === today ? ' today' : ''}${blocked ? ' blocked' : ''}`}
            style={past ? { cursor: 'default', background: '#faf8f3' } : undefined}
            onClick={() => !blocked && !past && onBook(d)}
            title={blocked ? 'Out of order' : past ? undefined : `Book room ${room.number} from ${fmtDate(d)}`}
          />
        );
      })}
    </>
  );
}
