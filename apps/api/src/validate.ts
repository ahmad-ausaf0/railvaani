import { CLASS_LABELS, QUOTA_LABELS, type Quota, type TrainClass } from '@railvaani/train-core';

/** Pure request validators for the data endpoints. Each answers a yes/no (or
 *  a parsed value) so the endpoints stay thin and the tests stay honest. */

/** Today's date in IST as YYYY-MM-DD, whatever zone the host clock runs in. */
export function istToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

/** Station codes are 2 to 5 upper-case letters. */
export function isStationCode(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Z]{2,5}$/.test(v);
}

/** Journey date: YYYY-MM-DD, a real calendar day, not in the past (IST). */
export function isValidDate(v: unknown, today: string = istToday()): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return false;
  return v >= today;
}

export function isTrainClass(v: unknown): v is TrainClass {
  return typeof v === 'string' && Object.hasOwn(CLASS_LABELS, v);
}

export function isQuota(v: unknown): v is Quota {
  return typeof v === 'string' && Object.hasOwn(QUOTA_LABELS, v);
}

/** Train numbers are 4 or 5 digits. */
export function isTrainNo(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4,5}$/.test(v);
}

/** Parse a budget head: undefined when absent, null when invalid, else a
 *  positive number. */
export function parseBudget(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
