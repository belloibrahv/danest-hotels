import { useState } from 'react';
import type { RoomStatus } from '../../../../shared/constants';
import { Card, ErrorBox, Icon, Loading, Modal, PageHead, useSubmit, useToast } from '../../components/ui';
import { api, fmtDate } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { useDesk } from '../../components/Desk';

interface Room {
  id: number;
  number: string;
  floor: number;
  status: RoomStatus;
  room_type: string;
  room_type_id: number;
  rate: number;
  reservation_id: number | null;
  check_out: string | null;
  guest_name: string | null;
  guest_vip: number | null;
  arriving_today: number;
}

const LABEL: Record<RoomStatus, string> = { available: 'Ready', occupied: 'Occupied', cleaning: 'Being cleaned', maintenance: 'Out of order' };
const TONE: Record<RoomStatus, string> = { available: 'green', occupied: 'blue', cleaning: 'amber', maintenance: 'red' };

export default function FrontDesk() {
  const desk = useDesk();
  const { data, error, reload } = useApi<Room[]>(`/rooms?v=${desk.version}`);
  const [sel, setSel] = useState<Room | null>(null);
  const { busy, error: actErr, submit } = useSubmit();
  const toast = useToast();

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const floors = [...new Set(data.map((r) => r.floor))];
  const counts = (s: RoomStatus) => data.filter((r) => r.status === s).length;

  const setStatus = (room: Room, status: RoomStatus, msg: string) =>
    submit(async () => {
      await api(`/rooms/${room.id}/status`, { method: 'PATCH', body: { status } });
      toast(msg);
      setSel(null);
      reload();
      desk.changed();
    });

  return (
    <>
      <PageHead title="Room board" sub="Every room at a glance. Tap a room to act on it." >
        <button className="btn" onClick={reload}>Refresh</button>
      </PageHead>

      <div className="row" style={{ marginBottom: 20 }}>
        {(Object.keys(LABEL) as RoomStatus[]).map((s) => (
          <span key={s} className={`badge ${TONE[s]}`}>
            {LABEL[s]} · {counts(s)}
          </span>
        ))}
      </div>

      <div className="stack" style={{ gap: 24 }}>
        {floors.map((f) => (
          <Card key={f} title={f === 1 ? 'Ground floor' : f === 2 ? 'First floor' : 'Second floor · suites'}>
            <div className="room-board">
              {data
                .filter((r) => r.floor === f)
                .map((r) => (
                  <button key={r.id} className={`room-tile ${r.status}`} onClick={() => (r.reservation_id ? desk.openReservation(r.reservation_id) : setSel(r))}>
                    <span className="no">{r.number}</span>
                    <span className="type">{r.room_type}</span>
                    {r.status === 'occupied' ? (
                      <>
                        <span className="guest">{r.guest_vip ? '★ ' : ''}{r.guest_name}</span>
                        <span className="muted" style={{ fontSize: 12 }}>Leaves {fmtDate(r.check_out!)}</span>
                      </>
                    ) : (
                      <span className={`badge ${TONE[r.status]}`} style={{ justifySelf: 'start' }}>{LABEL[r.status]}</span>
                    )}
                    {r.arriving_today > 0 && r.status !== 'occupied' && <span className="badge gold plain" style={{ justifySelf: 'start' }}>Arrival today</span>}
                  </button>
                ))}
            </div>
          </Card>
        ))}
      </div>

      {sel && (
        <Modal title={`Room ${sel.number}`} onClose={() => setSel(null)}>
          <div className="stack">
            <p className="muted">
              {sel.room_type} · <span className={`badge ${TONE[sel.status]}`}>{LABEL[sel.status]}</span>
            </p>
            <ErrorBox error={actErr} />
            {sel.status === 'available' && (
              <>
                <button className="btn gold lg block" onClick={() => (desk.newReservation({ roomId: sel.id, typeId: sel.room_type_id, walkIn: true }), setSel(null))}>
                  <Icon name="plus" size={16} /> Walk-in guest — check in to {sel.number}
                </button>
                <button className="btn block" disabled={busy} onClick={() => setStatus(sel, 'cleaning', `Room ${sel.number} sent to housekeeping`)}>Needs cleaning</button>
                <button className="btn danger block" disabled={busy} onClick={() => setStatus(sel, 'maintenance', `Room ${sel.number} taken out of order`)}>Take out of order (repairs)</button>
              </>
            )}
            {sel.status === 'cleaning' && (
              <button className="btn primary lg block" disabled={busy} onClick={() => setStatus(sel, 'available', `Room ${sel.number} is ready`)}>
                <Icon name="check" size={16} /> Cleaned — mark ready
              </button>
            )}
            {sel.status === 'maintenance' && (
              <button className="btn primary lg block" disabled={busy} onClick={() => setStatus(sel, 'available', `Room ${sel.number} back in service`)}>
                Repaired — back in service
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
