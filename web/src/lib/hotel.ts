import { useEffect, useState } from 'react';
import type { Facility, HotelSettings } from '../../../shared/constants';
import { api } from './api';

export interface PublicHotel extends Omit<HotelSettings, 'bank_details'> {
  facility_items: { id: number; facility: Facility; name: string; price: number }[];
  bookable: boolean;
}

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
