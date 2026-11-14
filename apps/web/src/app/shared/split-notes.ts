import { SplitOption } from '@railvaani/split-engine';

/** True when a split's leg 2 boards at a different station than leg 1 arrives
 *  at (e.g. arrive Kanpur Central, depart Govindpuri): the traveller walks
 *  between stations, and the card must say so plainly. */
export function isStationChange(option: SplitOption): boolean {
  return (
    option.type === 'split' &&
    option.legs.length === 2 &&
    option.legs[0]!.to !== option.legs[1]!.from
  );
}

/** Strip the railway suffix so 'Kanpur Central' reads as the place: 'Kanpur'. */
export function shortPlaceName(name: string): string {
  return name.replace(/\s*(?:junction|central|cantt|cant|terminus|jn)\s*$/i, '').trim() || name;
}

/** 'Change stations in Kanpur: Kanpur Central → Govindpuri', or null when the
 *  traveller waits at one station. */
export function stationChangeNote(
  option: SplitOption,
  hubName: string,
  name: (code: string) => string,
): string | null {
  if (!isStationChange(option)) return null;
  const arrive = name(option.legs[0]!.to) || option.legs[0]!.to;
  const depart = name(option.legs[1]!.from) || option.legs[1]!.from;
  const place = shortPlaceName(hubName || arrive);
  return `Change stations in ${place}: ${arrive} → ${depart}`;
}

/** Truthful wait label: the waiting station is named only when leg 2 boards
 *  where leg 1 arrives. Otherwise the wait stands alone and the change note
 *  carries the stations. */
export function splitWaitLabel(
  option: SplitOption,
  fallbackName: string,
  name: (code: string) => string,
  fmt: (mins: number) => string,
): string {
  const wait = option.connectionMins ?? 0;
  if (wait <= 0) return '';
  const at = isStationChange(option) ? '' : ` at ${name(option.legs[1]!.from) || fallbackName}`;
  return `${fmt(wait)} wait${at}`;
}
