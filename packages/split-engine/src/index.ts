import {
  Availability,
  CLASS_LABELS,
  ProviderError,
  Quota,
  Train,
  TrainDataProvider,
  TrainClass,
  SearchClass,
} from '@railvaani/train-core';

/** Station-coordinate lookup, loaded on demand so the ~127 kB map stays out
 *  of the app's initial bundle. Null also when the load fails: every geo test
 *  then reads "unknown" and options fall back to unfiltered. */
type StationCoordLookup = (code: string) => [number, number] | undefined;
let coordLookup: StationCoordLookup | null = null;
let coordLookupFailed = false;

async function loadStationCoords(): Promise<StationCoordLookup | null> {
  if (coordLookupFailed) return null;
  if (!coordLookup) {
    try {
      const mod = await import('@railvaani/train-core/station-coordinates');
      coordLookup = mod.stationCoord;
    } catch {
      coordLookupFailed = true;
    }
  }
  return coordLookup;
}

const DEFAULT_MIN_CONNECTION = 90;
const DEFAULT_MAX_CONNECTION = 480;
const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_MAX_DIRECTS = 20;
const DEFAULT_MAX_SPLITS = 8;
const MAX_DETOUR_FACTOR = 1.6;
const FORWARD_HUB_RADIUS_KM = 150;
const FORWARD_HUB_PROJECTION_MAX = 0.6;
const FORWARD_HUB_EXTRA_COUNT = 3;
const HUB_LIST_CAP = 8;
const MAX_SPLITS_PER_HUB = 4;
const ORIGIN_CLUSTER_KM = 6.5;
const DEFERRED_REFINE_MIN = 14;

/** What the user asked the engine for. */
export interface SplitQuery {
  from: string;
  to: string;
  /** YYYY-MM-DD, departure date of the FIRST leg. */
  date: string;
  /** One real class applied to every leg, or 'ANY': each option then picks
   *  its cheapest bookable class, and a split may mix classes across legs. */
  cls: SearchClass;
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
  /** Cap on returned direct options. Default 20. Ignored when maxResults is set. */
  maxDirects?: number;
  /** Cap on returned split options. Default 8. Ignored when maxResults is set. */
  maxSplits?: number;
  /** Legacy single cap over the combined list. When set, maxDirects and maxSplits
   *  are ignored so old callers keep today's behaviour. */
  maxResults?: number;
  /** Any mode only: the engine records here how many options the budget
   *  hard filter dropped, for the results header. */
  hiddenByBudget?: { count: number };
  /**
   * Hide trains whose departure on the journey date has already passed
   * (railway time is IST). Default false: mock-provider tests use fixed
   * dates, and a server in another timezone must not guess the user's now.
   */
  excludeDeparted?: boolean;
  /** Optional live progress: (stage, done, total) as the search advances. */
  onProgress?: (stage: 'searching' | 'checking_seats', done: number, total: number) => void;
  /**
   * 'eager' (default) fetches availability for every candidate, like the mock
   * provider tests expect. 'deferred' builds fares-only options first, then
   * fetches availability for the top slice only: the right mode for live
   * providers where every call costs a network round trip.
   */
  availabilityMode?: 'eager' | 'deferred';
}

/** One class's fare and seat status on a leg, in Any-class mode. */
export interface LegClassOption {
  cls: TrainClass;
  fare: number;
  availability: Availability;
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
  /** The class this leg's fare/availability are for. Undefined in
   *  single-class mode (the query's class applies to every leg); set in
   *  Any-class mode, where each option picks its own class per leg. */
  cls?: TrainClass;
  /** Any-class mode only: every class the train carries on this leg,
   *  cheapest first. The array is shared by every option carrying this
   *  leg, so one availability lookup serves them all. */
  perClass?: LegClassOption[];
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

/** Today's date and minutes-of-day on IST (railway time), for a UTC instant. */
function istNow(nowMs: number): { date: string; mins: number } {
  const d = new Date(nowMs + (5 * 60 + 30) * 60_000);
  return { date: d.toISOString().slice(0, 10), mins: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** Departure minutes-of-day from an 'HH:MM' clock string. */
function depMinutesOf(depTime: string): number {
  const [h, m] = depTime.split(':');
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

/** Great-circle distance in km (haversine). */
function haversineKm(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Where `hub` sits along the origin->destination axis: 0 at the origin, 1 at
 *  the destination, negative behind it. A local flat-earth approximation is
 *  plenty at Indian network distances. */
function axisProjection(
  origin: [number, number],
  dest: [number, number],
  hub: [number, number],
): number {
  const midLat = ((origin[0] + dest[0]) / 2) * (Math.PI / 180);
  const kx = 111.32 * Math.cos(midLat);
  const ky = 110.57;
  const ux = (dest[1] - origin[1]) * kx;
  const uy = (dest[0] - origin[0]) * ky;
  const vx = (hub[1] - origin[1]) * kx;
  const vy = (hub[0] - origin[0]) * ky;
  const denom = ux * ux + uy * uy;
  if (denom === 0) return 0;
  return (vx * ux + vy * uy) / denom;
}

/** True when the hub keeps the journey pointing the right way and its
 *  crow-flies detour stays within the cap. undefined when coordinates are
 *  missing for any of the three stations: no geo data, no rejection. */
function hubKeepsDirection(
  origin: [number, number] | undefined,
  dest: [number, number] | undefined,
  hub: [number, number] | undefined,
): boolean | undefined {
  if (!origin || !dest || !hub) return undefined;
  const proj = axisProjection(origin, dest, hub);
  if (proj < 0 || proj > 1.1) return false;
  const direct = haversineKm(origin, dest);
  const detour = haversineKm(origin, hub) + haversineKm(hub, dest);
  return detour <= MAX_DETOUR_FACTOR * direct;
}

/** True when leg two boards at the origin itself or at a twin station within
 *  the origin's city cluster: Gorakhpur -> Domingarh and then boarding again
 *  at Gorakhpur is not a split journey, the traveller just boards the second
 *  train directly. Missing coordinates skip the cluster test, never reject
 *  on their own. */
function isOriginLoop(
  origin: string,
  leg2From: string,
  originCoord: [number, number] | undefined,
  leg2Coord: [number, number] | undefined,
): boolean {
  if (origin === leg2From) return true;
  if (!originCoord || !leg2Coord) return false;
  return haversineKm(originCoord, leg2Coord) <= ORIGIN_CLUSTER_KM;
}

/** Fill split slots in ranked order, but no single change station takes more
 *  than maxPerHub of them: once a station reaches the cap, its remaining
 *  splits are skipped and the fill continues with other stations. */
/**
 * Twin-station de-duplication: two splits that use the same leg-1 train,
 * the same leg-2 train and the same total fare are the same pair of
 * tickets reached through twin stations of one city. Keep one: the
 * same-station change when one exists, else the higher-ranked (the list is
 * sorted, so the first seen stays unless a same-station twin appears later).
 */
function dedupeByTrains(options: SplitOption[]): SplitOption[] {
  const keyOf = (o: SplitOption) =>
    `${o.legs[0]!.trainNumber}|${o.legs[1]!.trainNumber}|${o.totalFare}`;
  const keyed = new Map<string, SplitOption>();
  for (const o of options) {
    if (o.type !== 'split') continue;
    const kept = keyed.get(keyOf(o));
    if (!kept) {
      keyed.set(keyOf(o), o);
      continue;
    }
    const keptSame = kept.legs[0]!.to === kept.legs[1]!.from;
    if (!keptSame && o.legs[0]!.to === o.legs[1]!.from) keyed.set(keyOf(o), o);
  }
  return options.filter((o) => o.type !== 'split' || keyed.get(keyOf(o)) === o);
}

function fillWithHubDiversity(
  ranked: SplitOption[],
  maxSplits: number,
  maxPerHub: number,
): SplitOption[] {
  const perHub = new Map<string, number>();
  const picked: SplitOption[] = [];
  for (const o of ranked) {
    if (picked.length >= maxSplits) break;
    const hub = o.hub ?? '';
    const taken = perHub.get(hub) ?? 0;
    if (taken >= maxPerHub) continue;
    perHub.set(hub, taken + 1);
    picked.push(o);
  }
  return picked;
}

/** Runs async jobs with bounded concurrency. */
async function pMap<T>(items: T[], fn: (item: T) => Promise<void>, limit: number): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next;
      if (i >= items.length) return;
      next = i + 1;
      await fn(items[i]!);
    }
  });
  await Promise.all(workers);
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
    // A raw TypeError is a network failure. Providers should convert it, but the
    // engine defends too: the leg simply has no fare.
    if (e instanceof TypeError) return null;
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
    // A raw TypeError is a network failure. Providers should convert it, but the
    // engine defends too: the seats count as unchecked, not fatal.
    if (e instanceof TypeError) return null;
    throw e;
  }
}

/** A seat status a ticket can actually be booked in today. */
function isBookable(a: Availability): boolean {
  return a.state === 'AVAILABLE' || a.state === 'RAC';
}

/** Every class the data layer knows, in CLASS_LABELS order. */
const ALL_CLASSES = Object.keys(CLASS_LABELS) as TrainClass[];
const NO_SEATS: Availability = { state: 'NOT_AVAILABLE', count: 0 };

/**
 * Any-class mode headline pick: the cheapest class with a bookable status
 * (Available or RAC). When every class is waitlisted or unavailable, the
 * cheapest class fare is the headline and the stamps say so honestly.
 */
function pickHeadline(perClass: LegClassOption[]): LegClassOption | null {
  if (perClass.length === 0) return null;
  const bookable = perClass.filter((e) => isBookable(e.availability));
  const pool = bookable.length > 0 ? bookable : perClass;
  return pool.reduce((min, e) => (e.fare < min.fare ? e : min), pool[0]!);
}

/** Rebuilds a leg around one class: that class's fare and seat status. The
 *  per-class list stays the shared source, so sibling options that picked a
 *  different class for the same leg keep seeing the same data. */
function withPick(leg: SplitLeg, cls: TrainClass): SplitLeg {
  const entry = leg.perClass?.find((e) => e.cls === cls);
  if (!entry) return leg;
  return { ...leg, cls, fare: entry.fare, availability: entry.availability };
}

/** Any mode, a direct: the cached leg cloned around its headline class. */
function pickAnyLeg(leg: SplitLeg): SplitLeg {
  const head = pickHeadline(leg.perClass ?? []);
  return head ? withPick(leg, head.cls) : leg;
}

/**
 * Any mode, a split: the cheapest class bookable on BOTH legs when one
 * exists; the common class is preferred even when a mixed pair of
 * single-leg picks would total less. With none bookable on both, each leg
 * takes its own cheapest bookable class: a mixed split, labelled per leg.
 */
/** Seat quality for the Any-mode split pick: Available beats RAC, RAC beats
 *  waitlist. Waitlisted and unbookable legs rank equally (0). */
const SEAT_QUALITY: Record<string, number> = { AVAILABLE: 2, RAC: 1 };

function seatQuality(a: Availability): number {
  return SEAT_QUALITY[a.state] ?? 0;
}

/**
 * Any mode, a split: rank every class combination (the same class on both
 * legs, or a mixed pair) by seat quality across both legs: both legs
 * Available beats any RAC, RAC beats waitlist, and ties break on the
 * cheapest total fare. A confirmed mixed pair therefore outranks a
 * waitlisted same-class pair, while an equally-confirmed same-class pair
 * still beats a pricier mixed one on the price tie-break.
 */
function pickSplitClasses(
  l1: SplitLeg,
  l2: SplitLeg,
): { c1: TrainClass; c2: TrainClass; mixed: boolean } | null {
  const p1 = l1.perClass;
  const p2 = l2.perClass;
  if (!p1?.length || !p2?.length) return null;
  let best: { c1: TrainClass; c2: TrainClass; fare: number; quality: number } | null = null;
  for (const e1 of p1) {
    for (const e2 of p2) {
      const quality = Math.min(seatQuality(e1.availability), seatQuality(e2.availability));
      const fare = e1.fare + e2.fare;
      if (!best || quality > best.quality || (quality === best.quality && fare < best.fare)) {
        best = { c1: e1.cls, c2: e2.cls, fare, quality };
      }
    }
  }
  if (!best) return null;
  return { c1: best.c1, c2: best.c2, mixed: best.c1 !== best.c2 };
}


/** Any mode, a split: each cached leg cloned around its picked class. */
function pickSplitLegs(l1: SplitLeg, l2: SplitLeg): [SplitLeg, SplitLeg] {
  const pick = pickSplitClasses(l1, l2);
  return pick ? [withPick(l1, pick.c1), withPick(l2, pick.c2)] : [l1, l2];
}

/** Any mode, deferred refine: seat status has landed for this option's
 *  legs; re-run its class picks, then recompute the total and the budget
 *  verdict so ranking and filtering read the picked fares. */
function rePickAny(opt: SplitOption, budget: number | undefined): void {
  if (opt.type === 'direct') {
    const leg = opt.legs[0]!;
    const head = pickHeadline(leg.perClass ?? []);
    if (!head) return;
    leg.cls = head.cls;
    leg.fare = head.fare;
    leg.availability = head.availability;
    opt.totalFare = head.fare;
    opt.explanation = `${leg.trainNumber} ${leg.trainName} direct, Rs ${leg.fare}`;
  } else {
    const [l1, l2] = opt.legs;
    if (!l1 || !l2) return;
    const pick = pickSplitClasses(l1, l2);
    if (!pick) return;
    const e1 = l1.perClass!.find((e) => e.cls === pick.c1)!;
    const e2 = l2.perClass!.find((e) => e.cls === pick.c2)!;
    l1.cls = pick.c1;
    l1.fare = e1.fare;
    l1.availability = e1.availability;
    l2.cls = pick.c2;
    l2.fare = e2.fare;
    l2.availability = e2.availability;
    opt.totalFare = l1.fare + l2.fare;
    const changePoint =
      l1.to === l2.from ? `at ${l1.to}` : `at ${l1.to} -> ${l2.from} (change stations)`;
    opt.explanation = `Via ${opt.hub}: ${l1.trainNumber} ${l1.from}-${l1.to} + ${l2.trainNumber} ${l2.from}-${l2.to}, Rs ${opt.totalFare}, ${fmtGap(opt.connectionMins ?? 0)} ${changePoint}`;
  }
  opt.withinBudget = budget === undefined ? true : opt.totalFare <= budget;
}

/**
 * Any-class mode: builds one leg carrying every class's fare and seat
 * status. Fares come from the provider's cached per-class table; when that
 * is empty the per-class fare lookups run (a live provider's first fare
 * call warms its cache, so this stays one network round trip in practice).
 * Availability comes from the provider's all-classes lookup when one is
 * requested; the deferred refine fills it in later otherwise.
 */
async function buildLegAny(
  provider: TrainDataProvider,
  t: Train,
  date: string,
  quota: Quota,
  withAvailability = true,
): Promise<SplitLeg | null> {
  let table = provider.getFareTable?.(t.number, t.from, t.to) ?? {};
  let entries: { cls: TrainClass; fare: number }[] = ALL_CLASSES.map((cls) => ({
    cls,
    fare: table[cls],
  })).filter((e): e is { cls: TrainClass; fare: number } => typeof e.fare === 'number' && e.fare > 0);
  if (entries.length === 0) {
    entries = [];
    for (const cls of ALL_CLASSES) {
      const fare = await safeFare(provider, t.number, t.from, t.to, cls, quota);
      if (fare !== null && fare > 0) entries.push({ cls, fare });
    }
  }
  if (entries.length === 0) return null;
  entries.sort((a, b) => a.fare - b.fare);
  const perClass: LegClassOption[] = entries.map((e) => ({
    cls: e.cls,
    fare: e.fare,
    availability: { ...NO_SEATS },
  }));
  if (withAvailability) {
    const all = await safeAvailabilityAll(provider, t.number, date);
    if (all) {
      for (const e of perClass) {
        const a = all[e.cls];
        if (a) e.availability = a;
      }
    }
  }
  const head = pickHeadline(perClass)!;
  return {
    trainNumber: t.number,
    trainName: t.name,
    from: t.from,
    to: t.to,
    date,
    depTime: t.depTime,
    arrTime: t.arrTime,
    fare: head.fare,
    availability: head.availability,
    cls: head.cls,
    perClass,
  };
}

/** Every class's seat status for one train+date, or null when the provider
 *  has no all-classes lookup or it fails: the leg then stays unchecked. */
async function safeAvailabilityAll(
  provider: TrainDataProvider,
  trainNo: string,
  date: string,
): Promise<Partial<Record<string, Availability>> | null> {
  if (typeof provider.getAvailabilityAll !== 'function') return null;
  try {
    return await provider.getAvailabilityAll(trainNo, date);
  } catch (e) {
    if (e instanceof ProviderError) return null;
    if (e instanceof TypeError) return null;
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
  // A split that changes stations mid-journey ranks below one that waits at a
  // single station: walking between stations is a real cost.
  if (a.type === 'split' && b.type === 'split') {
    const aChange = a.legs[0]!.to !== a.legs[1]!.from;
    const bChange = b.legs[0]!.to !== b.legs[1]!.from;
    if (aChange !== bChange) return aChange ? 1 : -1;
  }
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
  const legacyMax = query.maxResults;
  const maxDirects = query.maxDirects ?? DEFAULT_MAX_DIRECTS;
  const maxSplits = query.maxSplits ?? DEFAULT_MAX_SPLITS;
  const availabilityMode = query.availabilityMode ?? 'eager';
  const withAvailability = availabilityMode !== 'deferred';
  const anyMode = query.cls === 'ANY';
  // The REQUESTED class is validated once here: an unknown code (a stale
  // bundle, a bad URL) must fail loudly, never silently zero the search —
  // every leg build would return null and findOptions would return [].
  // Per-train and per-leg data problems keep the existing isolation: one
  // bad leg or hub never kills the search.
  if (query.cls && !anyMode && !CLASS_LABELS[query.cls as TrainClass]) {
    throw new Error(`Unknown train class "${query.cls}".`);
  }
  const nowIst = istNow(Date.now());
  const alreadyLeft = (date: string, depTime: string): boolean =>
    query.excludeDeparted === true &&
    date === nowIst.date &&
    depMinutesOf(depTime) <= nowIst.mins;

  const options: SplitOption[] = [];

  // One leg, one fetch: the same train+date+segment appears in several split
  // options (one arrival leg paired with many onward trains). Build it once
  // and share the object, so every card renders the same availability figure
  // and no provider call is duplicated.
  const legCache = new Map<string, Promise<SplitLeg | null>>();
  const legFor = (t: Train, date: string): Promise<SplitLeg | null> => {
    const key = `${t.number}|${date}|${t.from}|${t.to}`;
    let p = legCache.get(key);
    if (!p) {
      p = anyMode
        ? buildLegAny(provider, t, date, quota, withAvailability)
        : buildLeg(provider, t, date, query.cls as TrainClass, quota, withAvailability);
      legCache.set(key, p);
    }
    return p;
  };

  // Direct trains first.
  const directTrains = (await provider.searchTrains(query.from, query.to, query.date))
    .filter((t) => !alreadyLeft(query.date, t.depTime));
  for (const t of directTrains) {
    const srcLeg = await legFor(t, query.date);
    if (!srcLeg) continue;
    const leg = anyMode ? pickAnyLeg(srcLeg) : srcLeg;
    const opt = makeOption([leg], t.durationMins, undefined, undefined);
    recomputeOptionVerdicts(opt);
    opt.explanation = `${t.number} ${t.name} direct, Rs ${leg.fare}`;
    options.push(opt);
  }

  // Splits via hubs. A provider that knows its best vias supplies them; otherwise
  // every known station is a candidate (mock seed scale).
  const stationCoord = await loadStationCoords();
  const originCoord = stationCoord?.(query.from);
  const destCoord = stationCoord?.(query.to);
  let hubs = query.hubs;
  if (!hubs) {
    let suggested: string[] | null = null;
    let suggestFailed = false;
    if (typeof provider.suggestHubs === 'function') {
      try {
        suggested = await provider.suggestHubs(query.from, query.to);
      } catch {
        suggestFailed = true;
      }
    }
    if (Array.isArray(suggested) && suggested.length > 0) {
      hubs = suggested.filter((c) => c !== query.from && c !== query.to).slice(0, 8);
    } else if (suggestFailed) {
      // Hub suggestions are an enhancement. When they fail, run direct trains
      // plus any geo-forward extra hubs rather than enumerating every known
      // station as a hub.
      hubs = [];
    } else {
      const stations = (await provider.listStations()) ?? [];
      hubs = [...new Set(stations.map((s) => s.code))].filter(
        (c) => c !== query.from && c !== query.to,
      );
    }
    if (originCoord && destCoord) {
      // Direction and detour tests: a hub behind the origin, beyond the
      // destination, or blowing the crow-flies distance up is never worth a
      // ticket. Stations without coordinates stay: unknown means keep.
      hubs = hubs.filter(
        (c) => hubKeepsDirection(originCoord, destCoord, stationCoord?.(c)) !== false,
      );
      // Via suggestions miss nearby forward hubs: Siddharthnagar to Gaya
      // suggested Kanpur, 9h in the wrong direction, and never Gorakhpur,
      // 65 km towards Gaya. Add up to 3 known stations near the origin that
      // point the right way, nearest first; the combined list stays capped.
      const directory = (await provider.listStations().catch(() => [])) ?? [];
      const base = new Set(hubs);
      const extras: { code: string; km: number }[] = [];
      const directKm = haversineKm(originCoord, destCoord);
      for (const s of directory) {
        if (s.code === query.from || s.code === query.to || base.has(s.code)) continue;
        const h = stationCoord?.(s.code);
        if (!h) continue;
        const km = haversineKm(originCoord, h);
        if (km > FORWARD_HUB_RADIUS_KM) continue;
        const proj = axisProjection(originCoord, destCoord, h);
        if (proj < 0 || proj > FORWARD_HUB_PROJECTION_MAX) continue;
        if (km + haversineKm(h, destCoord) > MAX_DETOUR_FACTOR * directKm) continue;
        extras.push({ code: s.code, km });
      }
      extras.sort((a, b) => a.km - b.km);
      hubs = [
        ...hubs.slice(0, HUB_LIST_CAP - FORWARD_HUB_EXTRA_COUNT),
        ...extras.slice(0, FORWARD_HUB_EXTRA_COUNT).map((e) => e.code),
      ].slice(0, HUB_LIST_CAP);
    }
  } else if (originCoord && destCoord) {
    // Explicit hubs respect the same direction and detour tests.
    hubs = hubs.filter(
      (c) => hubKeepsDirection(originCoord, destCoord, stationCoord?.(c)) !== false,
    );
  }
  for (const hub of hubs) {
    // One hub failing (its searches, fares or seat checks) must not affect
    // other hubs or the direct results: skip it and carry on.
    try {
      const leg1Trains = (await provider.searchTrains(query.from, hub, query.date))
        .filter((t) => !alreadyLeft(query.date, t.depTime));
      for (let shift = 0; shift <= 1; shift += 1) {
        const date2 = addDaysISO(query.date, shift);
        const leg2Trains = (await provider.searchTrains(hub, query.to, date2))
          .filter((t) => !alreadyLeft(date2, t.depTime));
        for (const t1 of leg1Trains) {
          for (const t2 of leg2Trains) {
            // Splitting one train's own journey into two tickets adds a fee and nothing else.
            if (t1.number === t2.number) continue;
            // No origin loops: a second leg boarding at the origin or a twin
            // station in its city cluster is not a split journey.
            if (isOriginLoop(query.from, t2.from, originCoord, stationCoord?.(t2.from))) continue;
            const dep2 = shift * 1440 + departureAbs(t2);
            const conn = dep2 - arrivalAbs(t1);
            if (conn < minConn || conn > maxConn) continue;
            const src1 = await legFor(t1, query.date);
            if (!src1) continue;
            const src2 = await legFor(t2, date2);
            if (!src2) continue;
            const [leg1, leg2] = anyMode ? pickSplitLegs(src1, src2) : [src1, src2];
            const opt = makeOption([leg1, leg2], dep2 + t2.durationMins - departureAbs(t1), hub, conn);
            recomputeOptionVerdicts(opt);
            const changePoint =
              t1.to === t2.from
                ? `at ${t1.to}`
                : `at ${t1.to} -> ${t2.from} (change stations)`;
            opt.explanation = `Via ${hub}: ${t1.number} ${query.from}-${hub} + ${t2.number} ${hub}-${query.to}, Rs ${opt.totalFare}, ${fmtGap(conn)} ${changePoint}`;
            options.push(opt);
          }
        }
      }

    } catch {
      continue;
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
    const refineCount = Math.min(
      deduped.length,
      Math.max(legacyMax !== undefined ? legacyMax * 2 : maxDirects + maxSplits, DEFERRED_REFINE_MIN),
    );
    const slice = deduped.slice(0, refineCount);
    // One availability lookup per unique train+date: split options share legs,
    // and the provider caches per train+date, so dedupe before the fan-out.
    const unique = new Map<string, SplitLeg>();
    for (const opt of slice) {
      for (const leg of opt.legs) {
        const key = `${leg.trainNumber}|${leg.date}|${leg.from}|${leg.to}`;
        if (!unique.has(key)) unique.set(key, leg);
      }
    }
    const jobs = [...unique.values()];
    let done = 0;
    query.onProgress?.('checking_seats', 0, jobs.length);
    await pMap(jobs, async (leg) => {
      if (leg.perClass) {
        // Any mode: one lookup brings every class's seats. Write into the
        // shared per-class list; each option then re-picks its own class
        // below, since sibling options sharing the leg may pick differently.
        const all = await safeAvailabilityAll(provider, leg.trainNumber, leg.date);
        if (all) {
          for (const e of leg.perClass) {
            const a = all[e.cls];
            if (a) e.availability = a;
          }
        }
      } else {
        const avail = await safeAvailability(
          provider, leg.trainNumber, leg.from, leg.to, leg.date, query.cls as TrainClass, quota,
        );
        if (avail) leg.availability = avail;
      }
      done += 1;
      query.onProgress?.('checking_seats', done, jobs.length);
    }, 4);
    for (const opt of slice) {
      if (anyMode) rePickAny(opt, budget);
      recomputeOptionVerdicts(opt);
    }
    deduped.sort(compareOptions);
  }

  // Twin-station duplicates go before the hub-diversity fill, so slots they
  // free go to genuinely different options.
  const pairDeduped = dedupeByTrains(deduped);
  // Any mode makes the budget a hard filter: options above it are not shown.
  // The hidden count is traveller-level only and is taken here, after
  // de-duplication and before the hub slot caps: a direct counts when its
  // headline price exceeds the budget, a split when its total does. Per-class
  // combinations, per-leg evaluations and hub attempts never reach this list,
  // so none of them can enter the count.
  const hardBudget = anyMode || query.onlyWithinBudget === true;
  const filtered = hardBudget ? pairDeduped.filter((o) => o.withinBudget) : pairDeduped;
  if (anyMode && query.hiddenByBudget) {
    query.hiddenByBudget.count = pairDeduped.filter((o) => !o.withinBudget).length;
  }
  if (legacyMax !== undefined) {
    return filtered.slice(0, legacyMax);
  }
  const directs = filtered.filter((o) => o.type === 'direct').slice(0, maxDirects);
  const splitCandidates = filtered.filter((o) => o.type === 'split');
  // Hub diversity: with more candidates than slots, no single change station
  // takes more than four of them, so busy hubs cannot crowd out other routes.
  const splits =
    splitCandidates.length <= maxSplits
      ? splitCandidates
      : fillWithHubDiversity(splitCandidates, maxSplits, MAX_SPLITS_PER_HUB);
  return [...directs, ...splits];
}
