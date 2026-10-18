import { BellRing, ChefHat, CookingPot, Utensils } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { KitchenStatus } from '../../../../shared/constants';
import { EmptyState, ErrorNote, LoadingRows, PageHeader } from '@/components/app/page';
import { StatusPill, type Tone } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api, fmtTime } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { cn } from '@/lib/utils';

interface Order {
  id: number;
  receipt_no: string;
  status: KitchenStatus;
  note: string | null;
  created_at: string;
  ready_at: string | null;
  served_at: string | null;
  method: string;
  taken_by: string | null;
  room_number: string | null;
  items: { qty: number; name: string }[];
}

const COLUMNS: { status: KitchenStatus; title: string; icon: typeof ChefHat; next: string; tone: Tone }[] = [
  { status: 'new', title: 'New', icon: BellRing, next: 'Start cooking', tone: 'danger' },
  { status: 'preparing', title: 'Cooking', icon: CookingPot, next: 'Ready to serve', tone: 'warning' },
  { status: 'ready', title: 'Ready', icon: Utensils, next: 'Served', tone: 'success' },
];

const minutesSince = (ts: string, now: number) => Math.max(0, Math.floor((now - Date.parse(ts.replace(' ', 'T') + 'Z')) / 60_000));

/** The kitchen's screen: every food order from the till, oldest first, moved along with one tap. */
export default function Kitchen() {
  const v = useLive('kitchen', 'sales');
  const [tick, setTick] = useState(0);
  const { data, error } = useApi<Order[]>(`/kitchen?v=${v + tick}`);
  const [now, setNow] = useState(Date.now());
  const seen = useRef<Set<number> | null>(null);

  // The waiting time on each ticket keeps counting without a refresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);

  // A new order makes itself known: a toast, and a short tone when the browser allows sound.
  useEffect(() => {
    if (!data) return;
    const fresh = data.filter((o) => o.status === 'new' && seen.current && !seen.current.has(o.id));
    seen.current = new Set(data.map((o) => o.id));
    if (!fresh.length) return;
    toast(`${fresh.length} new order${fresh.length > 1 ? 's' : ''}`, { description: fresh.map((o) => o.items.map((i) => `${i.qty} × ${i.name}`).join(', ')).join(' · ') });
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      o.frequency.value = 880;
      o.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.25);
    } catch {
      /* no sound until someone has touched the page; the toast still shows */
    }
  }, [data]);

  const advance = (o: Order) =>
    api(`/kitchen/${o.id}/advance`, { body: {} }).then(() => setTick((x) => x + 1), (e) => toast.error(e.message));

  if (error) return <ErrorNote error={error} />;
  if (!data) return <LoadingRows rows={6} />;
  const served = data.filter((o) => o.status === 'served');

  return (
    <>
      <PageHeader title="Kitchen" description="Food orders from the till appear here as they are rung up. Tap to move each one along." />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        {COLUMNS.map((c) => {
          const orders = data.filter((o) => o.status === c.status);
          return (
            <section key={c.status} aria-label={c.title} className="rounded-xl border bg-muted/30 p-3">
              <h2 className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold">
                <c.icon className="size-4" /> {c.title}
                <span className="ml-auto rounded-full bg-background px-2 text-xs tabular-nums">{orders.length}</span>
              </h2>
              {orders.length === 0 ? (
                <p className="px-1 py-6 text-center text-sm text-muted-foreground">Nothing here</p>
              ) : (
                <div className="space-y-3">
                  {orders.map((o) => {
                    const waited = minutesSince(o.created_at, now);
                    return (
                      <Card key={o.id} className={cn('gap-0 py-0 shadow-xs', c.status === 'new' && waited >= 10 && 'ring-2 ring-destructive')}>
                        <div className="flex items-center gap-2 border-b px-4 py-2.5">
                          <span className="font-semibold">{o.room_number ? `Room ${o.room_number}` : o.note || 'Counter'}</span>
                          <StatusPill tone={waited >= 20 ? 'danger' : waited >= 10 ? 'warning' : 'neutral'} className="ml-auto">{waited} min</StatusPill>
                        </div>
                        <ul className="space-y-1 px-4 py-3 text-base">
                          {o.items.map((i, n) => (
                            <li key={n}><span className="font-semibold tabular-nums">{i.qty} ×</span> {i.name}</li>
                          ))}
                        </ul>
                        {o.room_number && o.note && <p className="px-4 pb-2 text-sm text-muted-foreground">“{o.note}”</p>}
                        <div className="flex items-center gap-2 border-t px-4 py-2.5">
                          <span className="text-xs text-muted-foreground">{fmtTime(o.created_at)} · {o.taken_by?.split(' ')[0] ?? 'Till'}</span>
                          <Button size="lg" className="ml-auto h-11" variant={c.status === 'ready' ? 'outline' : 'default'} onClick={() => advance(o)}>{c.next}</Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {data.length === 0 && <EmptyState icon={ChefHat} title="No food orders yet" className="mt-6">When the till rings up anything from the Food menu, it shows here.</EmptyState>}
      {served.length > 0 && (
        <p className="mt-6 text-sm text-muted-foreground">
          Served in the last hour: {served.map((o) => `${o.room_number ? `Room ${o.room_number}` : o.note || 'Counter'} (${o.served_at ? fmtTime(o.served_at) : ''})`).join(' · ')}
        </p>
      )}
    </>
  );
}
