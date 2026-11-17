import type { Availability } from '@railvaani/train-core';

export type StampTone = 'rv-stamp-ok' | 'rv-stamp-rac' | 'rv-stamp-bad' | 'rv-stamp-muted';
export type AvailTone = 'rv-avail-ok' | 'rv-avail-rac' | 'rv-avail-bad' | 'rv-avail-muted' | 'rv-avail-wl';

/** Pure presentation: a seat status to its stamp colour class.
 *  Available green, RAC amber, waitlist and unchecked neutral, regret red. */
export function stampTone(a?: { state?: string } | null): StampTone {
  const s = a?.state ?? '';
  if (s === 'AVAILABLE') return 'rv-stamp-ok';
  if (s === 'RAC') return 'rv-stamp-rac';
  if (s === 'REGRET' || s === 'NOT_AVAILABLE') return 'rv-stamp-bad';
  return 'rv-stamp-muted';
}

/** Pure presentation: the same status as coloured text for table rows.
 *  Waitlist carries its own violet pair (chips and table rows alike); stamps
 *  stay neutral for unchecked and muted. */
export function availTone(a?: { state?: string } | null): AvailTone {
  if (a?.state === 'WL') return 'rv-avail-wl';
  const t = stampTone(a);
  return t === 'rv-stamp-ok' ? 'rv-avail-ok'
    : t === 'rv-stamp-rac' ? 'rv-avail-rac'
    : t === 'rv-stamp-bad' ? 'rv-avail-bad'
    : 'rv-avail-muted';
}

/** Pure presentation: uppercase stamp text for a seat status. */
export function stampText(a?: { state?: string; count?: number; wlPrefix?: string } | null): string {
  const s = a?.state ?? '';
  const count = a?.count ?? 0;
  if (s === 'AVAILABLE') return count > 0 ? `Available ${count}` : 'Available';
  if (s === 'RAC') return count > 0 ? `RAC ${count}` : 'RAC';
  if (s === 'WL') {
    if (count <= 0) return 'Waitlist';
    // IRCTC notation, e.g. GNWL104/WL64, so the figure reads like the booking site.
    return a?.wlPrefix ? `WL ${a.wlPrefix}/${count}` : `WL ${count}`;
  }
  if (s === 'REGRET') return 'Regret';
  if (s === 'NOT_AVAILABLE') return 'Not available';
  return 'Check seats on IRCTC';
}
