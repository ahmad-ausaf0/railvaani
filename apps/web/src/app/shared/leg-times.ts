/** Pure date and duration helpers for option cards.
 *
 *  Every date here derives from the searched journey date that the split engine
 *  stamps on each leg. Nothing reads the viewer's clock. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Minutes from 00:00 for an 'HH:MM' (or 'HH:MM:SS') clock time; 0 when unparseable. */
export function timeAbs(time: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Whole days the arrival clock time sits at or behind the departure clock time:
 *  1 for an overnight leg (22:40 to 06:15), 0 for a same-day one. */
export function arrDayDelta(depTime: string, arrTime: string): number {
  return timeAbs(arrTime) <= timeAbs(depTime) ? 1 : 0;
}

/** YYYY-MM-DD shifted by n days, computed in UTC so no zone shifts the day.
 *  Returns '' for an invalid date. */
export function addDaysISO(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 'Sat 14 Nov': short weekday, day of month, short month, from YYYY-MM-DD.
 *  Empty when the date is invalid, so templates can hide the line. */
export function fmtShortDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!m) return '';
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Leg duration in minutes. Uses the leg's day offset when the caller knows it,
 *  otherwise derives it from the clock times (arrival at or before departure
 *  means the train crosses midnight). */
export function legDurationMins(depTime: string, arrTime: string, dayOffset?: number): number {
  const delta = dayOffset ?? arrDayDelta(depTime, arrTime);
  return timeAbs(arrTime) - timeAbs(depTime) + delta * 1440;
}

/** '11h 05m', '45m' under an hour, '3h' on the hour. */
export function fmtDuration(mins: number): string {
  const m = Math.max(0, Math.round(mins || 0));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${mm}m`;
  return mm === 0 ? `${h}h` : `${h}h ${String(mm).padStart(2, '0')}m`;
}

/** Split summary arithmetic: first departure to final arrival, every leg's
 *  duration plus every connection wait. */
export function splitTotalMins(
  legs: ReadonlyArray<{ depTime: string; arrTime: string }>,
  connectionMins: number,
): number {
  return legs.reduce((sum, l) => sum + legDurationMins(l.depTime, l.arrTime), 0) + connectionMins;
}
