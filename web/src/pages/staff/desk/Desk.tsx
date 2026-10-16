import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { GuestSheet } from './GuestSheet';
import { NewReservation, type NewReservationPreset } from './NewReservation';
import { ReservationSheet } from './ReservationSheet';

/**
 * The front desk's shared surfaces. Any screen (tape chart, room board, search, dashboard)
 * can open a reservation, a guest profile or a new booking without owning that UI itself.
 * `version` bumps after every change so open lists refetch.
 *
 * The open reservation or guest lives in the address (?reservation=12, ?guest=5): a link can be
 * shared with a colleague, a refresh keeps it open, and the phone's back gesture closes the sheet.
 */
interface DeskApi {
  openReservation: (id: number) => void;
  openGuest: (id: number) => void;
  newReservation: (preset?: NewReservationPreset) => void;
  version: number;
  changed: () => void;
}

const Ctx = createContext<DeskApi>({ openReservation: () => {}, openGuest: () => {}, newReservation: () => {}, version: 0, changed: () => {} });
export const useDesk = () => useContext(Ctx);

export function DeskProvider({ children }: { children: ReactNode }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const idParam = (k: string) => (/^\d+$/.test(params.get(k) ?? '') ? Number(params.get(k)) : null);
  const resId = idParam('reservation');
  const guestId = idParam('guest');
  const [creating, setCreating] = useState<{ preset?: NewReservationPreset } | null>(null);
  const [version, setVersion] = useState(0);
  const changed = useCallback(() => setVersion((v) => v + 1), []);

  /** Show one sheet (or none). Opening adds a history entry so "back" closes it. */
  const show = useCallback(
    (sheet: { reservation?: number; guest?: number } | null) => {
      const next = new URLSearchParams(location.search);
      if (!sheet && !next.has('reservation') && !next.has('guest')) return;
      next.delete('reservation');
      next.delete('guest');
      if (sheet?.reservation) next.set('reservation', String(sheet.reservation));
      if (sheet?.guest) next.set('guest', String(sheet.guest));
      const to = { pathname: location.pathname, search: next.toString() ? `?${next}` : '' };
      const opened = (location.state as { sheet?: boolean } | null)?.sheet;
      if (!sheet && opened) navigate(-1);
      else navigate(to, { replace: !sheet || opened, state: sheet ? { sheet: true } : null });
    },
    [location, navigate],
  );

  const api = useMemo<DeskApi>(
    () => ({
      openReservation: (id) => show({ reservation: id }),
      openGuest: (id) => show({ guest: id }),
      newReservation: (preset) => (show(null), setCreating({ preset })),
      version,
      changed,
    }),
    [version, changed, show],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <ReservationSheet id={resId} onClose={() => show(null)} />
      <GuestSheet id={guestId} onClose={() => show(null)} />
      <NewReservation
        open={!!creating}
        preset={creating?.preset}
        onClose={() => setCreating(null)}
        onCreated={(id) => {
          setCreating(null);
          changed();
          show({ reservation: id });
        }}
      />
    </Ctx.Provider>
  );
}
