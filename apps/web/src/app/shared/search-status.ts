/**
 * Search-status rules for the results page: the slow-search line, the rule
 * that options on screen outrank the error banner, and the header note for
 * options hidden by the Any-class budget filter. Pure, so the specs can
 * test them without a component.
 */

export const SLOW_SEARCH_LINE = 'Taking longer than usual, still searching…';

/** The step line shown while a search runs and no options have arrived:
 *  past the 20-second mark it swaps the stage text for the slow-search
 *  note. Not an error state: it never shows a retry and never blames the
 *  user's connection. */
export function slowSearchLine(
  running: boolean,
  hasOptions: boolean,
  slow: boolean,
): string | null {
  return running && !hasOptions && slow ? SLOW_SEARCH_LINE : null;
}

/** Options on screen outrank the error banner: an error is never shown
 *  once options have arrived. */
export function visibleError(error: string, hasOptions: boolean): string {
  return hasOptions ? '' : error;
}

/** Still-pending seat checks are abandoned in the UI this long after the
 *  options first rendered: cards keep their last-known status and the status
 *  line clears. The check pass must never hold the line indefinitely. */
export const SEAT_CHECK_CAP_MS = 30_000;

/** The status line for the post-results seat-check pass. 'Checking seats…'
 *  while the pass is pending, and '' once it settles or once the 30-second
 *  cap has expired (pending checks abandoned, last-known statuses kept). */
export function seatCheckLine(
  checking: boolean,
  resultsRenderedAtMs: number | null,
  nowMs: number,
): string {
  if (!checking || resultsRenderedAtMs === null) return '';
  return nowMs - resultsRenderedAtMs >= SEAT_CHECK_CAP_MS ? '' : 'Checking seats…';
}

/** Header note for options the Any-class budget filter hid. */
export function budgetHiddenNote(hidden: number, budget?: number): string | null {
  if (hidden <= 0 || budget === undefined) return null;
  return `${hidden} option${hidden === 1 ? '' : 's'} hidden by your ₹${budget} budget`;
}
