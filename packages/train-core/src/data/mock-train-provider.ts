import {
  Availability,
  AvailabilityState,
  Quota,
  Station,
  Stop,
  Train,
  TrainClass,
  Weekday,
} from '../models/train.models';
import { SEED_STATIONS, SEED_TRAINS, SeedStop, SeedTrain, SeedStation } from './seed-data';
import { ProviderError, TrainDataProvider } from './train-data-provider';

/** Deterministic per-km rates and reservation fees, tuned to realistic IRCTC levels. */
const FARE_RATE_PER_KM: Record<TrainClass, number> = {
  '2S': 0.32,
  SL: 0.56,
  CC: 1.45,
  '3E': 1.35,
  '3A': 1.48,
  '2A': 2.15,
};
const RESERVATION_FEE: Record<TrainClass, number> = {
  '2S': 15,
  SL: 20,
  CC: 40,
  '3E': 40,
  '3A': 40,
  '2A': 45,
};

export function toMins(t: string): number {
  const parts = t.split(':');
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  return h * 60 + m;
}

export function fmtTime(totalMins: number): string {
  const m = ((totalMins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Absolute minutes: day offset x 1440 + clock minutes, day 0 = stored departure day. */
function absOf(stop: SeedStop, field: 'arr' | 'dep'): number {
  return stop.day * 1440 + toMins(stop[field]);
}

export function weekdayOfDate(date: string): Weekday {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ProviderError('bad_request', `Date must be YYYY-MM-DD, got "${date}"`);
  }
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new ProviderError('bad_request', `Invalid date: ${date}`);
  }
  const dow = parsed.getUTCDay();
  return (dow === 0 ? 7 : dow) as Weekday;
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic availability: stable for the same (train, segment, class, date, quota),
 * varied across them, so demos and tests are reproducible.
 */
function seededAvailability(key: string, quota: Quota): Availability {
  const h = fnv1a(key);
  let r = h % 100;
  if (quota === 'TQ') {
    r = (r + 25) % 100;
  } else if (quota === 'SR' || quota === 'LD') {
    r = (r + 10) % 100;
  }
  const state: AvailabilityState =
    r < 50 ? 'AVAILABLE' : r < 65 ? 'RAC' : r < 85 ? 'WL' : r < 94 ? 'NOT_AVAILABLE' : 'REGRET';
  switch (state) {
    case 'AVAILABLE':
      return { state, count: 38 + (h % 45) };
    case 'RAC':
      return { state, count: 2 + (h % 22) };
    case 'WL':
      return { state, count: 1, wlPrefix: `GNWL${1 + (h % 80)}` };
    default:
      return { state, count: 0 };
  }
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n] ?? 0;
}

function normalizeLatin(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface OrientedLeg {
  depTime: string;
  arrTime: string;
  dayOffset: number;
  durationMins: number;
  reversed: boolean;
  distanceKm: number;
}

/**
 * Times and distance for one train between two of its stations, in either direction.
 * Reversed schedules are derived by mirroring the timeline (revDep = C - origArr,
 * revArr = C - origDep), so both directions always yield valid, increasing times.
 * The split engine reuses this in Milestone 2.
 */
export function orientedLeg(seed: SeedTrain, from: string, to: string): OrientedLeg | null {
  const idxA = seed.stops.findIndex((s) => s.code === from);
  const idxB = seed.stops.findIndex((s) => s.code === to);
  if (idxA < 0 || idxB < 0 || idxA === idxB) return null;
  const a = seed.stops[idxA];
  const b = seed.stops[idxB];
  const first = seed.stops[0];
  const last = seed.stops[seed.stops.length - 1];
  if (!a || !b || !first || !last) return null;
  const reversed = idxA > idxB;
  const distanceKm = Math.abs(b.km - a.km);
  if (!reversed) {
    const durationMins = absOf(b, 'arr') - absOf(a, 'dep');
    if (durationMins <= 0) return null;
    const depTime = a.dep;
    return {
      depTime,
      arrTime: b.arr,
      dayOffset: Math.floor((toMins(depTime) + durationMins) / 1440),
      durationMins,
      reversed: false,
      distanceKm,
    };
  }
  // Mirror the timeline: reversed times t' = C - t, with C chosen so the reversed
  // journey departs the old terminus at the clock time the original departs its origin.
  const mirrorC = absOf(first, 'dep') + absOf(last, 'arr');
  const durationMins = absOf(a, 'arr') - absOf(b, 'dep');
  if (durationMins <= 0) return null;
  const depTime = fmtTime(mirrorC - absOf(a, 'arr'));
  return {
    depTime,
    arrTime: fmtTime(mirrorC - absOf(b, 'dep')),
    dayOffset: Math.floor((toMins(depTime) + durationMins) / 1440),
    durationMins,
    reversed: true,
    distanceKm,
  };
}

export class MockTrainProvider implements TrainDataProvider {
  private readonly stationsByCode = new Map<string, SeedStation>(
    SEED_STATIONS.map((s) => [s.code, s]),
  );

  async searchTrains(from: string, to: string, date: string): Promise<Train[]> {
    const fromCode = this.resolveStation(from).code;
    const toCode = this.resolveStation(to).code;
    if (fromCode === toCode) {
      throw new ProviderError('bad_request', 'Origin and destination are the same station.');
    }
    const wd = weekdayOfDate(date);
    const results: Train[] = [];
    for (const seed of SEED_TRAINS) {
      const leg = orientedLeg(seed, fromCode, toCode);
      if (!leg) continue;
      if (!seed.runsOn.includes(wd)) continue;
      results.push({
        number: seed.number,
        name: seed.name,
        runsOn: seed.runsOn,
        from: fromCode,
        to: toCode,
        depTime: leg.depTime,
        arrTime: leg.arrTime,
        durationMins: leg.durationMins,
      });
    }
    return results.sort((x, y) => toMins(x.depTime) - toMins(y.depTime));
  }

  async getAvailability(
    trainNo: string,
    from: string,
    to: string,
    date: string,
    cls: TrainClass,
    quota: Quota,
  ): Promise<Availability> {
    const seed = this.requireSeed(trainNo);
    this.requireStation(from);
    this.requireStation(to);
    if (!seed.classes.includes(cls)) {
      throw new ProviderError('bad_request', `Train ${trainNo} does not carry class ${cls}.`);
    }
    weekdayOfDate(date);
    return seededAvailability(`${trainNo}:${from}:${to}:${cls}:${date}:${quota}`, quota);
  }

  async getFare(trainNo: string, from: string, to: string, cls: TrainClass, quota: Quota): Promise<number> {
    const seed = this.requireSeed(trainNo);
    if (!seed.classes.includes(cls)) {
      throw new ProviderError('bad_request', `Train ${trainNo} does not carry class ${cls}.`);
    }
    const leg = orientedLeg(seed, from, to);
    if (!leg) {
      throw new ProviderError('no_route', `Train ${trainNo} does not run ${from} to ${to}.`);
    }
    let fare = Math.round((leg.distanceKm * FARE_RATE_PER_KM[cls] + RESERVATION_FEE[cls]) / 5) * 5;
    if (quota === 'TQ') {
      fare = Math.round((fare * 1.3) / 5) * 5;
    }
    return fare;
  }

  async getRoute(trainNo: string): Promise<Stop[]> {
    const seed = this.requireSeed(trainNo);
    return seed.stops.map((s) => ({
      station: this.requireStation(s.code),
      arr: s.arr,
      dep: s.dep,
      day: s.day,
      km: s.km,
    }));
  }

  async searchStations(query: string): Promise<Station[]> {
    return this.searchStationsSync(query);
  }

  async listStations(): Promise<Station[]> {
    return SEED_STATIONS.map((st) => this.toStation(st));
  }

  private searchStationsSync(query: string): Station[] {
    const raw = query.trim();
    const q = normalizeLatin(raw);
    if (!q && !raw) return [];
    const scored = SEED_STATIONS.map((st) => {
      const code = st.code.toLowerCase();
      const name = normalizeLatin(st.name.replace(/junction$/i, ''));
      let score = 0;
      if (code === q) score = 100;
      else if (code.startsWith(q) && q.length >= 2) score = 85;
      else if (name === q) score = 95;
      else if (name.startsWith(q) && q.length >= 3) score = 80;
      else if (q.length >= 3 && name.includes(q)) score = 65;
      else if (st.nameHi && raw && st.nameHi.includes(raw)) score = 90;
      else if (q.length >= 3 && (levenshtein(q, code) <= 1 || levenshtein(q, name) <= 2)) score = 55;
      return { st, score };
    })
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, 8);
    return scored.map(({ st }) => this.toStation(st));
  }

  private toStation(st: SeedStation): Station {
    return { code: st.code, name: st.name, nameHi: st.nameHi, zone: st.zone, isJunction: st.isJunction };
  }

  private resolveStation(input: string): Station {
    const codeHit = this.stationsByCode.get(input.trim().toUpperCase());
    if (codeHit) return this.toStation(codeHit);
    const fuzzy = this.searchStationsSync(input)[0];
    if (fuzzy) return fuzzy;
    throw new ProviderError('bad_request', `Unknown station: ${input}`);
  }

  private requireStation(code: string): Station {
    const hit = this.stationsByCode.get(code.trim().toUpperCase());
    if (!hit) throw new ProviderError('bad_request', `Unknown station: ${code}`);
    return this.toStation(hit);
  }

  private requireSeed(trainNo: string): SeedTrain {
    const seed = SEED_TRAINS.find((t) => t.number === trainNo);
    if (!seed) throw new ProviderError('no_route', `Train ${trainNo} is not in the corridor data.`);
    return seed;
  }
}
