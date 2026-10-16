import { ArrowRight, Check } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Section } from './page';
import { Progress } from '@/components/ui/progress';
import { useApi } from '@/lib/hooks';
import { cn } from '@/lib/utils';

interface Checklist {
  profile: boolean;
  room_types: boolean;
  rooms: boolean;
  products: boolean;
  facility_items: boolean;
  team: boolean;
  mfa: boolean;
}

const STEPS: [keyof Checklist, string, string, string][] = [
  ['profile', 'Hotel details', 'Phone, address and check-in times for the website and invoices', '/staff/settings?tab=hotel'],
  ['room_types', 'Room types and rates', 'Standard, Deluxe, Executive Suite…', '/staff/settings?tab=rooms'],
  ['rooms', 'Room numbers', 'A whole floor at once: 101-108', '/staff/settings?tab=rooms'],
  ['products', 'Bar & shop items and opening stock', 'Selling prices, then a purchase for what is on the shelf', '/staff/inventory'],
  ['facility_items', 'Gym, pool and lounge prices', 'Day passes, memberships, VIP tables', '/staff/settings?tab=facilities'],
  ['team', 'Staff accounts', 'Each person with their real name and role', '/staff/team'],
  ['mfa', 'Two-step sign-in for managers', 'Protects the business from a stolen password', '/staff/account'],
];

/** Shown on the owner's dashboard until the hotel is fully set up. */
export function SetupChecklist() {
  const { data } = useApi<Checklist>('/setup/checklist');
  const [showDone, setShowDone] = useState(false);
  if (!data) return null;
  const done = STEPS.filter(([k]) => data[k]).length;
  if (done === STEPS.length) return null;
  // What is left comes first; finished steps fold away so the day's work stays on screen.
  const steps = showDone ? STEPS : STEPS.filter(([k]) => !data[k]);
  return (
    <Section
      title="Finish setting up"
      description={`${done} of ${STEPS.length} done. Everything starts empty, so every number is your hotel's real business.`}
      action={
        done > 0 && (
          <button className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Hide done' : `Show ${done} done`}
          </button>
        )
      }
      flush
    >
      <Progress value={(done / STEPS.length) * 100} className="h-1 rounded-none" />
      <ul className="grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-y-0">
        {steps.map(([k, title, text, to]) => (
          <li key={k} className="sm:border-b sm:odd:border-r">
            <Link to={to} className={cn('group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/50', data[k] && 'opacity-60')}>
              <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border', data[k] && 'border-success bg-success text-background')}>{data[k] && <Check className="size-3.5" />}</span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm font-medium', data[k] && 'line-through')}>{title}</span>
                <span className="block truncate text-xs text-muted-foreground">{text}</span>
              </span>
              {!data[k] && <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
