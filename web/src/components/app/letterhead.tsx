import type { ReactNode } from 'react';
import type { HotelSettings } from '../../../../shared/constants';
import { initialsOf, photoUrl, useHotel } from '@/lib/hotel';
import { cn } from '@/lib/utils';

/**
 * The hotel's mark: the logo uploaded in Settings, or Danest's own crest, or until a hotel has a
 * logo, its initials in its colour. Round, on white, sharp at any size.
 */
export function Crest({ className }: { className?: string }) {
  const hotel = useHotel();
  const base = cn('shrink-0 rounded-full bg-white object-contain ring-1 ring-border', className);
  if (!hotel) return <span className={cn(base, 'inline-block bg-muted')} aria-hidden />;
  if (hotel.images.logo) return <img src={photoUrl(hotel.images.logo)} alt="" className={base} />;
  if (hotel.builtin_brand)
    return <img src="/brand/crest-128.png" srcSet="/brand/crest-128.png 128w, /brand/crest-512.png 512w" sizes="(min-resolution: 2dppx) 128px, 64px" alt="" className={base} />;
  return (
    <span className={cn(base, 'inline-flex items-center justify-center bg-brand font-display font-medium text-brand-foreground ring-0 [container-type:inline-size]')} aria-hidden>
      <span className="text-[38cqi] leading-none">{initialsOf(hotel.name || hotel.short_name)}</span>
    </span>
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
