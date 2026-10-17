import type { ReactNode } from 'react';
import type { HotelSettings } from '../../../../shared/constants';
import { cn } from '@/lib/utils';

/** The Danest crest. Always on white (it is a white roundel), sharp at any size and on any screen. */
export function Crest({ className }: { className?: string }) {
  return (
    <img
      src="/brand/crest-128.png"
      srcSet="/brand/crest-128.png 128w, /brand/crest-512.png 512w"
      sizes="(min-resolution: 2dppx) 128px, 64px"
      alt=""
      className={cn('shrink-0 rounded-full bg-white object-contain ring-1 ring-border', className)}
    />
  );
}

/**
 * The hotel's letterhead for everything that is printed or handed to a guest: invoices, receipts,
 * statements and reports. Name, address and contacts come from Settings, never invented.
 */
export function Letterhead({ hotel, title, meta, compact }: { hotel: HotelSettings; title: ReactNode; meta?: ReactNode; compact?: boolean }) {
  const contact = [hotel.phone, hotel.email].filter(Boolean).join(' · ');
  if (compact) {
    // Narrow receipt paper: everything centred and stacked.
    return (
      <header className="flex flex-col items-center gap-2 border-b border-dashed pb-4 text-center">
        <Crest className="size-20 ring-0" />
        <div className="text-base font-semibold">{hotel.name}</div>
        <div className="text-[11px] leading-snug text-muted-foreground">
          {hotel.address}
          {contact && <div>{contact}</div>}
        </div>
        <div className="mt-1 text-sm font-semibold tracking-wide uppercase">{title}</div>
        {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
      </header>
    );
  }
  return (
    <header className="flex flex-wrap items-center justify-between gap-6 border-b pb-6">
      <div className="flex items-center gap-4">
        <Crest className="size-24 ring-0 print:size-28" />
        <div>
          <div className="text-xl font-semibold tracking-tight">{hotel.name}</div>
          {hotel.tagline && <div className="text-xs text-brand-ink italic">{hotel.tagline}</div>}
          <div className="mt-1 max-w-72 text-xs leading-relaxed text-muted-foreground">
            {hotel.address}
            {contact && <div>{contact}</div>}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-2xl font-semibold tracking-tight">{title}</div>
        {meta && <div className="mt-0.5 space-y-0.5 text-sm text-muted-foreground">{meta}</div>}
      </div>
    </header>
  );
}
