import { useEffect, useState } from 'react';
import type { Facility, HotelSettings } from '../../../shared/constants';
import { api } from './api';

export interface PublicHotel extends Omit<HotelSettings, 'bank_details'> {
  facility_items: { id: number; facility: Facility; name: string; price: number }[];
  bookable: boolean;
  online_payments: boolean;
  images: {
    hero: Photo | null;
    logo: Photo | null;
    gallery: Photo[];
    facilities: Record<Facility, Photo | null>;
  };
}

export type Photo = { id: number; alt: string };
export const photoUrl = (p: Photo) => `/api/public/images/${p.id}`;

let cache: Promise<PublicHotel> | null = null;

/** The hotel's own details, as the owner entered them in Settings. Fetched once per page load. */
export function useHotel(): PublicHotel | null {
  const [h, setH] = useState<PublicHotel | null>(null);
  useEffect(() => {
    cache ??= api<PublicHotel>('/public/hotel');
    cache.then(setH, () => (cache = null));
  }, []);
  return h;
}

/** "14:00" → "2:00 pm" */
export function time12(t: string) {
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return t;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** Picks an illustration for a room type from its name, whatever the owner called it. */
export function sceneFor(name: string) {
  const n = name.toLowerCase();
  if (/royal|presidential|penthouse|ambassador/.test(n)) return 'royal';
  if (/executive|suite|business/.test(n)) return 'executive';
  if (/deluxe|superior|premium/.test(n)) return 'deluxe';
  return 'standard';
}

/** The hotel's initials, for the monogram used until a logo is uploaded. */
export function initialsOf(name: string) {
  const words = name.replace(/&/g, ' ').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(hotel|and|suites?|the)$/i.test(w));
  return (words.slice(0, 2).map((w) => w[0].toUpperCase()).join('') || name.slice(0, 1).toUpperCase() || 'H');
}

/** The hotel's own colour, if set: the brand tokens follow it, with softer and darker shades mixed from it. */
export function useBrandColor() {
  const hotel = useHotel();
  const color = hotel?.brand_color;
  useEffect(() => {
    const root = document.documentElement;
    if (!color || !/^#[0-9a-f]{6}$/i.test(color)) {
      for (const v of ['--brand', '--brand-soft', '--brand-ink', '--chart-1']) root.style.removeProperty(v);
      return;
    }
    root.style.setProperty('--brand', color);
    root.style.setProperty('--chart-1', color);
    root.style.setProperty('--brand-soft', `color-mix(in oklch, ${color} 14%, var(--background))`);
    root.style.setProperty('--brand-ink', `color-mix(in oklch, ${color} 72%, var(--foreground))`);
  }, [color]);
}
