import { Activity, BedDouble, Coins, Package, Receipt, ShieldAlert, ShoppingCart, UserCog, Wine } from 'lucide-react';
import { EmptyState, LoadingRows, Section } from '@/components/app/page';
import { ACTION, RED, describe, type A } from '@/lib/activity';
import { fmtTime, naira } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { cn } from '@/lib/utils';

type Event = A & { type: 'audit' | 'sale'; label: string | null };

const ICON: Record<string, typeof Activity> = {
  sale: Wine, reservation: BedDouble, product: Package, purchase: ShoppingCart, expense: Receipt, facility_income: Coins,
  company: Coins, user: UserCog, audit_query: ShieldAlert, day: Coins,
};

function line(e: Event) {
  if (e.type === 'sale') {
    const d = JSON.parse(e.detail ?? '{}') as { total: number; method: string; items: string | null };
    return { what: `sold ${d.items ?? 'items'}`, extra: `${naira(d.total)}${d.method === 'room' ? ' · to room' : ` · ${d.method}`}` };
  }
  return { what: `${ACTION[e.action] ?? e.action.replace(/_/g, ' ')} ${e.label ?? e.entity.replace(/_/g, ' ')}`, extra: describe(e) };
}

/** Everything happening in the hotel today, newest first. Updates itself as it happens. */
export function ActivityFeed({ limit = 25, className }: { limit?: number; className?: string }) {
  const v = useLive('activity', 'sales');
  const { data } = useApi<{ events: Event[] }>(`/activity?limit=${limit}&v=${v}`);
  return (
    <Section title="Happening now" description="Today, as it happens" className={className} flush>
      {!data ? (
        <LoadingRows rows={6} />
      ) : data.events.length === 0 ? (
        <EmptyState icon={Activity} title="Quiet so far today" className="py-8" />
      ) : (
        <ol className="max-h-[28rem] divide-y overflow-y-auto">
          {data.events.map((e) => {
            const Icon = ICON[e.entity] ?? Activity;
            const { what, extra } = line(e);
            return (
              <li key={`${e.type}-${e.id}`} className="flex gap-3 px-5 py-2.5 text-sm">
                <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground', RED.test(e.action) && 'bg-danger-soft text-destructive')}>
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    <span className="font-medium">{e.user ?? 'Guest website'}</span> <span className={RED.test(e.action) ? 'text-destructive' : ''}>{what}</span>
                  </div>
                  {extra && <div className="truncate text-xs text-muted-foreground">{extra}</div>}
                </div>
                <time className="shrink-0 text-xs text-muted-foreground tabular-nums">{fmtTime(e.created_at)}</time>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
