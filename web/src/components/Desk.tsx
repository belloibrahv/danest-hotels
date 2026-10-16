import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { GuestDrawer } from '../pages/staff/GuestDrawer';
import { NewReservation, type NewReservationPreset } from '../pages/staff/NewReservation';
import { ReservationDrawer } from '../pages/staff/ReservationDrawer';

/**
 * The front desk's shared surfaces. Any screen (tape chart, room board, search, dashboard)
 * can open a reservation, a guest profile or a new booking without owning that UI itself.
 * `version` bumps after every change so open lists refetch.
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
  const [resId, setResId] = useState<number | null>(null);
  const [guestId, setGuestId] = useState<number | null>(null);
  const [creating, setCreating] = useState<NewReservationPreset | null | false>(false);
  const [version, setVersion] = useState(0);
  const changed = useCallback(() => setVersion((v) => v + 1), []);

  const api = useMemo<DeskApi>(
    () => ({
      openReservation: (id) => (setGuestId(null), setResId(id)),
      openGuest: (id) => (setResId(null), setGuestId(id)),
      newReservation: (preset) => setCreating(preset ?? null),
      version,
      changed,
    }),
    [version, changed],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {resId !== null && <ReservationDrawer id={resId} onClose={() => setResId(null)} />}
      {guestId !== null && <GuestDrawer id={guestId} onClose={() => setGuestId(null)} />}
      {creating !== false && (
        <NewReservation
          preset={creating ?? undefined}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            changed();
            setResId(id);
          }}
        />
      )}
    </Ctx.Provider>
  );
}
