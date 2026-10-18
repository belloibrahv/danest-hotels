import { format } from 'date-fns';
import { CalendarRange } from 'lucide-react';
import { useState } from 'react';
import type { DateRange as DayRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { addDays, todayISO } from '@/lib/api';
import { cn } from '@/lib/utils';

export type Range = { from: string; to: string };

const monthStart = (d: string) => `${d.slice(0, 8)}01`;
const lastMonth = (d: string) => {
  const end = addDays(monthStart(d), -1);
  return { from: monthStart(end), to: end };
};

export function presets(): { key: string; label: string; range: Range }[] {
  const t = todayISO();
  return [
    { key: 'today', label: 'Today', range: { from: t, to: t } },
    { key: 'yesterday', label: 'Yesterday', range: { from: addDays(t, -1), to: addDays(t, -1) } },
    { key: '7d', label: 'Last 7 days', range: { from: addDays(t, -6), to: t } },
    { key: 'month', label: 'This month', range: { from: monthStart(t), to: t } },
    { key: 'last', label: 'Last month', range: lastMonth(t) },
    { key: '90d', label: 'Last 90 days', range: { from: addDays(t, -89), to: t } },
    { key: 'year', label: 'This year', range: { from: `${t.slice(0, 4)}-01-01`, to: t } },
  ];
}

export function useRange(initial = 'month') {
  const [key, setKey] = useState(initial);
  const [custom, setCustom] = useState<Range>(presets().find((p) => p.key === initial)!.range);
  const range = key === 'custom' ? custom : presets().find((p) => p.key === key)!.range;
  return { key, setKey, range, setCustom, qs: `from=${range.from}&to=${range.to}` };
}

const d = (iso: string) => new Date(`${iso}T12:00:00`);
const label = (r: Range) =>
  r.from === r.to ? format(d(r.from), 'd MMM yyyy') : `${format(d(r.from), r.from.slice(0, 4) === r.to.slice(0, 4) ? 'd MMM' : 'd MMM yyyy')} – ${format(d(r.to), 'd MMM yyyy')}`;

/** Preset list + two-month calendar in one popover, like the date pickers in Stripe and Linear. */
export function DateRangePicker({ state, className }: { state: ReturnType<typeof useRange>; className?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DayRange | undefined>();
  const t = todayISO();
  const current = presets().find((p) => p.key === state.key);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft({ from: d(state.range.from), to: d(state.range.to) });
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('justify-start gap-2 font-normal', className)}>
          <CalendarRange className="size-4 opacity-60" />
          <span className="font-medium">{current?.label ?? 'Custom'}</span>
          <span className="text-muted-foreground">{label(state.range)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-auto flex-col p-0 sm:flex-row" align="start">
        <div className="flex flex-row flex-wrap gap-1 border-b p-2 sm:w-36 sm:flex-col sm:border-r sm:border-b-0">
          {presets().map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={state.key === p.key ? 'secondary' : 'ghost'}
              className="justify-start"
              onClick={() => {
                state.setKey(p.key);
                setOpen(false);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="p-2">
          <Calendar
            mode="range"
            numberOfMonths={2}
            selected={draft}
            defaultMonth={draft?.from}
            onSelect={setDraft}
            disabled={{ after: d(t) }}
          />
          <div className="flex justify-end gap-2 border-t p-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!draft?.from}
              onClick={() => {
                const from = format(draft!.from!, 'yyyy-MM-dd');
                const to = format(draft!.to ?? draft!.from!, 'yyyy-MM-dd');
                state.setCustom({ from, to });
                state.setKey('custom');
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
