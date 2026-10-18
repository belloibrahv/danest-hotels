import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from './utils';

/**
 * One live connection per open tab. The server only says *what* changed ("sales", "stock"…);
 * each screen refetches through its own API, so it never sees data its role can't. Put
 * `useLive('sales', 'stock')` in a fetch key and the screen keeps itself current.
 */
export type Topic = 'reservations' | 'rooms' | 'sales' | 'stock' | 'money' | 'activity' | 'queries' | 'kitchen';
type Status = 'connecting' | 'live' | 'offline';

const Ctx = createContext<{ status: Status; versions: Partial<Record<Topic, number>> }>({ status: 'offline', versions: {} });

export function LiveProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('connecting');
  const [versions, setVersions] = useState<Partial<Record<Topic, number>>>({});
  const connectedBefore = useRef(false);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return setStatus('offline');
    const es = new EventSource('/api/live');
    const bump = (topics: Topic[]) => setVersions((v) => Object.fromEntries([...Object.entries(v), ...topics.map((t) => [t, (v[t] ?? 0) + 1])]));
    es.addEventListener('hello', (e) => {
      setStatus('live');
      // Back after a drop: whatever changed meanwhile was missed, so everything refreshes once.
      if (connectedBefore.current) bump(JSON.parse((e as MessageEvent).data).topics);
      connectedBefore.current = true;
    });
    es.addEventListener('change', (e) => bump(JSON.parse((e as MessageEvent).data).topics));
    // The browser retries on its own; this only tells people the screen may be behind.
    es.onerror = () => setStatus(es.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
    return () => es.close();
  }, []);

  const value = useMemo(() => ({ status, versions }), [status, versions]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** A number that goes up whenever any of these topics change. */
export function useLive(...topics: Topic[]) {
  const { versions } = useContext(Ctx);
  return topics.reduce((a, t) => a + (versions[t] ?? 0), 0);
}

export function LiveBadge({ className }: { className?: string }) {
  const { status } = useContext(Ctx);
  const label = status === 'live' ? 'Live' : status === 'connecting' ? 'Reconnecting' : 'Not live';
  return (
    <span
      className={cn('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium text-muted-foreground', className)}
      title={status === 'live' ? 'Screens update by themselves as things happen in the hotel' : 'Live updates are paused; numbers refresh when you reopen a page'}
      aria-live="polite"
    >
      <span className="relative flex size-2">
        {status === 'live' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />}
        <span className={cn('relative inline-flex size-2 rounded-full', status === 'live' ? 'bg-success' : status === 'connecting' ? 'bg-warning' : 'bg-muted-foreground')} />
      </span>
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
