import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { GuestSheet } from './GuestSheet';
import { NewReservation, type NewReservationPreset } from './NewReservation';
import { ReservationSheet } from './ReservationSheet';

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
  const [creating, setCreating] = useState<{ preset?: NewReservationPreset } | null>(null);
  const [version, setVersion] = useState(0);
  const changed = useCallback(() => setVersion((v) => v + 1), []);

  const api = useMemo<DeskApi>(
    () => ({
      openReservation: (id) => (setGuestId(null), setResId(id)),
      openGuest: (id) => (setResId(null), setGuestId(id)),
      newReservation: (preset) => (setResId(null), setGuestId(null), setCreating({ preset })),
      version,
      changed,
    }),
    [version, changed],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <ReservationSheet id={resId} onClose={() => setResId(null)} />
      <GuestSheet id={guestId} onClose={() => setGuestId(null)} />
      <NewReservation
        open={!!creating}
        preset={creating?.preset}
        onClose={() => setCreating(null)}
        onCreated={(id) => {
          setCreating(null);
          changed();
          setResId(id);
        }}
      />
    </Ctx.Provider>
  );
}
