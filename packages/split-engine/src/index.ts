import {
  Availability,
  ProviderError,
  Quota,
  Train,
  TrainDataProvider,
  TrainClass,
} from '@railvaani/train-core';

const DEFAULT_MIN_CONNECTION = 90;
const DEFAULT_MAX_CONNECTION = 480;
const DEFAULT_MAX_RESULTS = 8;
const DEFERRED_REFINE_MIN = 14;

/** What the user asked the engine for. */
export interface SplitQuery {
  from: string;
  to: string;
  /** YYYY-MM-DD, departure date of the FIRST leg. */
  date: string;
  cls: TrainClass;
  /** Default 'GN'. */
  quota?: Quota;
  /** Per-head budget in rupees. Options over it stay in the list but rank last. */
  budgetPerHead?: number;
  /** Drop over-budget options entirely instead of ranking them last. */
  onlyWithinBudget?: boolean;
  /** Minimum gap at the hub, minutes. Default 90: platform change without a sprint. */
  minConnectionMins?: number;
  /** Maximum gap at the hub, minutes. Default 480 (8h). */
  maxConnectionMins?: number;
  /** Explicit hub station codes. Overrides provider station enumeration. */
  hubs?: string[];
  /** Cap on returned options. Default 8. */
  maxResults?: number;
  /**
   * 'eager' (default) fetches availability for every candidate, like the mock
   * provider tests expect. 'deferred' builds fares-only options first, then
   * fetches availability for the top slice only: the right mode for live
   * providers where every call costs a network round trip.
   */
  availabilityMode?: 'eager' | 'deferred';
}

/** One booked segment of an option. */
export interface SplitLeg {
  trainNumber: string;
  trainName: string;
  from: string;
  to: string;
  /** Departure date of THIS leg, YYYY-MM-DD (a next-day connection has a later date). */
  date: string;
  depTime: string;
  arrTime: string;
  fare: number;
  availability: Availability;
}

/** One complete option: a direct train, or a two-leg split via one hub. */
export interface SplitOption {
  type: 'direct' | 'split';
  legs: SplitLeg[];
  /** Intermediate station code, splits only. */
  hub?: string;
  connectionMins?: number;
  totalFare: number;
  totalDurationMins: number;
  withinBudget: boolean;
  /** Every leg AVAILABLE or RAC. */
  bookable: boolean;
  /** Any leg on WL: bookable only if the waitlist clears. */
  needsWaitlist: boolean;
  /** Plain-language one-liner for the results list. */
  explanation: string;
}

function addDaysISO(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${date}`);
  }
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtGap(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Minutes from the leg's departure date 00:00 to arrival. */
function arrivalAbs(t: Train): number {
  const [h, m] = t.depTime.split(':');
  return (Number(h) || 0) * 60 + (Number(m) || 0) + t.durationMins;
}

/** Departure minutes from the train's own date 00:00. */
function departureAbs(t: Train): number {
  const [h, m] = t.depTime.split(':');
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

async function safeFare(
  provider: TrainDataProvider,
  trainNo: string,
  from: string,
  to: string,
  cls: TrainClass,
  quota: Quota,
): Promise<number | null> {
  try {
    return await provider.getFare(trainNo, from, to, cls, quota);
  } catch (e) {
    if (e instanceof ProviderError) return null;
    throw e;
  }
}

async function safeAvailability(
  provider: TrainDataProvider,
  trainNo: string,
  from: string,
  to: string,
  date: string,
  cls: TrainClass,
  quota: Quota,
): Promise<Availability | null> {
  try {
    return await provider.getAvailability(trainNo, from, to, date, cls, quota);
  } catch (e) {
    if (e instanceof ProviderError) return null;
    throw e;
  }
}

async function buildLeg(
  provider: TrainDataProvider,
  t: Train,
  date: string,
  cls: TrainClass,
  quota: Quota,
  withAvailability = true,
): Promise<SplitLeg | null> {
  const fare = await safeFare(provider, t.number, t.from, t.to, cls, quota);
  if (fare === null) return null;
  const availability =
    (withAvailability
      ? await safeAvailability(provider, t.number, t.from, t.to, date, cls, quota)
      : null) ?? {
      state: 'NOT_AVAILABLE' as const,
      count: 0,
    };
  return {
    trainNumber: t.number,
    trainName: t.name,
    from: t.from,
    to: t.to,
    date,
    depTime: t.depTime,
    arrTime: t.arrTime,
    fare,
    availability,
  };
}

function makeOption(
  legs: SplitLeg[],
  totalDurationMins: number,
  hub: string | undefined,
  connectionMins: number | undefined,
): SplitOption {
  const totalFare = legs.reduce((sum, l) => sum + l.fare, 0);
  return {
    type: hub === undefined ? 'direct' : 'split',
    legs,
    ...(hub !== undefined ? { hub } : {}),
    ...(connectionMins !== undefined ? { connectionMins } : {}),
    totalFare,
    totalDurationMins,
    withinBudget: false,
    bookable: false,
    needsWaitlist: false,
    explanation: '',
  };
}

function recomputeOptionVerdicts(opt: SplitOption): void {
  opt.bookable = opt.legs.every(
    (l) => l.availability.state === 'AVAILABLE' || l.availability.state === 'RAC',
  );
  opt.needsWaitlist = opt.legs.some((l) => l.availability.state === 'WL');
}

/** Ranking: within budget, then bookable, then cheapest, then fastest, direct first on ties. */
function compareOptions(a: SplitOption, b: SplitOption): number {
  if (a.withinBudget !== b.withinBudget) return a.withinBudget ? -1 : 1;
  if (a.bookable !== b.bookable) return a.bookable ? -1 : 1;
  if (a.totalFare !== b.totalFare) return a.totalFare - b.totalFare;
  if (a.totalDurationMins !== b.totalDurationMins) return a.totalDurationMins - b.totalDurationMins;
  if (a.type !== b.type) return a.type === 'direct' ? -1 : 1;
  return (a.hub ?? '').localeCompare(b.hub ?? '');
}

/**
 * Finds direct options and one-hub split options for a query, applies budget and
 * connection constraints, and returns them best-first: within budget, then bookable,
 * then cheapest, then fastest, direct trains winning ties.
 */
export async function findOptions(
  provider: TrainDataProvider,
  query: SplitQuery,
): Promise<SplitOption[]> {
  if (query.from === query.to) {
    throw new Error('Origin and destination must differ.');
  }
  const quota: Quota = query.quota ?? 'GN';
  const minConn = query.minConnectionMins ?? DEFAULT_MIN_CONNECTION;
  const maxConn = query.maxConnectionMins ?? DEFAULT_MAX_CONNECTION;
  const maxResults = query.maxResults ?? DEFAULT_MAX_RESULTS;
  const availabilityMode = query.availabilityMode ?? 'eager';
  const withAvailability = availabilityMode !== 'deferred';

  const options: SplitOption[] = [];

  // Direct trains first.
  const directTrains = await provider.searchTrains(query.from, query.to, query.date);
  for (const t of directTrains) {
    const leg = await buildLeg(provider, t, query.date, query.cls, quota, withAvailability);
    if (!leg) continue;
    const opt = makeOption([leg], t.durationMins, undefined, undefined);
    recomputeOptionVerdicts(opt);
    opt.explanation = `${t.number} ${t.name} direct, Rs ${leg.fare}`;
    options.push(opt);
  }

  // Splits via hubs. A provider that knows its best vias supplies them; otherwise
  // every known station is a candidate (mock seed scale).
  let hubs = query.hubs;
  if (!hubs) {
    const suggested =
      typeof provider.suggestHubs === 'function'
        ? await provider.suggestHubs(query.from, query.to)
        : null;
    if (suggested && suggested.length > 0) {
      hubs = suggested.filter((c) => c !== query.from && c !== query.to).slice(0, 8);
    } else {
      const stations = (await provider.listStations()) ?? [];
      hubs = [...new Set(stations.map((s) => s.code))].filter(
        (c) => c !== query.from && c !== query.to,
      );
    }
  }
  for (const hub of hubs) {
    const leg1Trains = await provider.searchTrains(query.from, hub, query.date);
    for (let shift = 0; shift <= 1; shift += 1) {
      const date2 = addDaysISO(query.date, shift);
      const leg2Trains = await provider.searchTrains(hub, query.to, date2);
      for (const t1 of leg1Trains) {
        for (const t2 of leg2Trains) {
          // Splitting one train's own journey into two tickets adds a fee and nothing else.
          if (t1.number === t2.number) continue;
          const dep2 = shift * 1440 + departureAbs(t2);
          const conn = dep2 - arrivalAbs(t1);
          if (conn < minConn || conn > maxConn) continue;
          const leg1 = await buildLeg(provider, t1, query.date, query.cls, quota, withAvailability);
          if (!leg1) continue;
          const leg2 = await buildLeg(provider, t2, date2, query.cls, quota, withAvailability);
          if (!leg2) continue;
          const opt = makeOption([leg1, leg2], dep2 + t2.durationMins - departureAbs(t1), hub, conn);
          recomputeOptionVerdicts(opt);
          opt.explanation = `Via ${hub}: ${t1.number} ${query.from}-${hub} + ${t2.number} ${hub}-${query.to}, Rs ${opt.totalFare}, ${fmtGap(conn)} at ${hub}`;
          options.push(opt);
        }
      }
    }
  }

  const budget = query.budgetPerHead;
  for (const opt of options) {
    opt.withinBudget = budget === undefined ? true : opt.totalFare <= budget;
  }

  const seen = new Set<string>();
  const deduped = options.filter((o) => {
    const key = `${o.type}|${o.hub ?? ''}|${o.legs.map((l) => l.trainNumber).join('+')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort(compareOptions);

  // Deferred availability: refine the top slice only, then re-rank. Options below
  // the slice keep NOT_AVAILABLE and rank as unbookable.
  if (!withAvailability) {
    const refineCount = Math.min(deduped.length, Math.max(maxResults * 2, DEFERRED_REFINE_MIN));
    for (const opt of deduped.slice(0, refineCount)) {
      let changed = false;
      for (const leg of opt.legs) {
        const avail = await safeAvailability(
          provider, leg.trainNumber, leg.from, leg.to, leg.date, query.cls, quota,
        );
        if (avail) {
          leg.availability = avail;
          changed = true;
        }
      }
      if (changed) recomputeOptionVerdicts(opt);
    }
    deduped.sort(compareOptions);
  }

  const filtered = query.onlyWithinBudget ? deduped.filter((o) => o.withinBudget) : deduped;
  return filtered.slice(0, maxResults);
}
