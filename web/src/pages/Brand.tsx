import { Check } from 'lucide-react';
import { useEffect } from 'react';
import { StatusPill, VipBadge } from '@/components/app/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Eyebrow, SitePage } from './site';

const COLORS = [
  ['Ink', 'var(--primary)', 'Text, primary actions, the sidebar mark'],
  ['Danest gold', 'var(--brand)', 'The crest ring. Guest selection, highlights, first chart series — used sparingly'],
  ['Motto red', 'var(--destructive)', 'Money owed, errors and destructive actions only'],
  ['Warm grey', 'var(--muted)', 'Surfaces and quiet backgrounds'],
  ['Border', 'var(--border)', 'Hairlines between things'],
];
const STATUS = [['success', 'Ready / paid'], ['info', 'In house'], ['brand', 'Request'], ['warning', 'Needs attention'], ['danger', 'Owed / out of order']] as const;
const CHART = [['var(--chart-1)', 'Rooms'], ['var(--chart-2)', 'Bar & shop'], ['var(--chart-3)', 'Facilities'], ['var(--chart-4)', 'Costs']];

/** The Danest design language, built from the same components as the product. */
export default function Brand() {
  useEffect(() => {
    document.title = 'Design language — Danest';
  }, []);
  return (
    <SitePage>
      <div className="mx-auto max-w-5xl space-y-20 px-4 py-16 sm:px-6">
        <header>
          <Eyebrow>Design language</Eyebrow>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Quiet, precise, hospitable.</h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            A neutral interface so the important things — money owed, arrivals, a room out of order — stand out. Danest gold from the crest marks the brand and the guest's choices, never the
            background.
          </p>
        </header>

        <section>
          <h2 className="mb-6 text-xl font-semibold">Colour</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {COLORS.map(([name, v, use]) => (
              <Card key={name} className="gap-0 overflow-hidden py-0 shadow-xs">
                <div className="h-20 border-b" style={{ background: v }} />
                <CardContent className="p-3">
                  <div className="text-sm font-medium">{name}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{use}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-2">{STATUS.map(([t, l]) => <StatusPill key={t} tone={t}>{l}</StatusPill>)}</div>
          <p className="mt-3 text-sm text-muted-foreground">Status colours always come with words. Chart colours were checked for colour-blind separation and contrast in light and dark mode:</p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">{CHART.map(([c, l]) => <span key={l} className="flex items-center gap-2"><i className="size-3 rounded-sm" style={{ background: c }} /> {l}</span>)}</div>
        </section>

        <section>
          <h2 className="mb-6 text-xl font-semibold">Type</h2>
          <Card className="gap-0 divide-y py-0 shadow-xs">
            {[
              ['Display · Geist 600, −2.5% tracking', <span className="text-4xl font-semibold tracking-tight">Good evening, Folake</span>],
              ["Figures · Geist, tabular numerals", <span className="text-3xl font-semibold tabular-nums">₦1,284,500</span>],
              ['Body · Geist 400, 14px', <span>Send your request, we call to confirm, and you pay when you arrive.</span>],
              ['Label · Geist 500, 12px', <span className="text-xs font-medium text-foreground/80">Check-in date</span>],
            ].map(([k, v]) => (
              <div key={String(k)} className="grid gap-2 p-5 sm:grid-cols-[220px_1fr] sm:items-baseline">
                <span className="text-xs text-muted-foreground">{k}</span>
                {v}
              </div>
            ))}
          </Card>
        </section>

        <section>
          <h2 className="mb-6 text-xl font-semibold">Writing</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['Reserve in two minutes.', 'Seamless online reservation solution.'],
              ['Outstanding balance of ₦31,800 — record payment first.', 'Error 409: folio not settled.'],
              ["We couldn't find a booking with that reference and phone number.", 'Invalid credentials supplied.'],
            ].map(([good, bad]) => (
              <Card key={good} className="gap-0 py-0 shadow-xs sm:col-span-2">
                <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
                  <p className="flex gap-2 text-sm"><Check className="size-4 shrink-0 text-success" /> {good}</p>
                  <p className="text-sm text-muted-foreground line-through decoration-destructive/40">{bad}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-6 text-xl font-semibold">Components</h2>
          <Card className="gap-0 py-0 shadow-xs">
            <CardContent className="space-y-6 p-6">
              <div className="flex flex-wrap gap-2">
                <Button>Primary</Button>
                <Button variant="outline">Secondary</Button>
                <Button variant="ghost">Quiet</Button>
                <Button variant="destructive">Destructive</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Badge</Badge>
                <VipBadge />
                <StatusPill tone="success">Paid</StatusPill>
                <StatusPill tone="danger">Owes ₦31,800</StatusPill>
              </div>
              <div className="grid max-w-lg gap-3 sm:grid-cols-2">
                <Input placeholder="Guest name" />
                <Input placeholder="080…" type="tel" />
              </div>
              <p className="text-xs text-muted-foreground">Built on shadcn/ui and Radix: keyboard accessible, with focus rings, dark mode and reduced motion.</p>
            </CardContent>
          </Card>
        </section>
      </div>
    </SitePage>
  );
}
