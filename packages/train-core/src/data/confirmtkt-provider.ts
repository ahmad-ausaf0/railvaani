/**
 * ConfirmTktProvider: live all-India train search, fares and seat availability
 * from ConfirmTkt's public trains API (the JSON endpoints their own web
 * frontend calls). No API key, and the API answers with a permissive CORS
 * header, so the browser can call it directly: no relay chain, no text
 * scraping. Verified live (Oct 2026): HTTP 200 JSON with
 * access-control-allow-origin: *, and non-browser user agents are refused,
 * which browsers never send.
 *
 * One `trains/search` call returns the train list together with live seat
 * availability, quoted fares and confirmation predictions per class, so a
 * leg's search, fares and availability all resolve from ONE upstream request.
 * ConfirmTkt exposes no route and no via-station endpoints, so getRoute and
 * suggestHubs delegate to the fallback provider (erail).
 *
 * Response shape (verified live):
 *   data.trainList[]: trainNumber, trainName, fromStnCode/toStnCode (the leg
 *   actually searched), departureTime/arrivalTime "HH:MM", duration in
 *   MINUTES, distance km, runningDays (7-char Monday-first mask), avlClasses[],
 *   availabilityCache: { [cls]: { availability, availabilityDisplayName, fare,
 *   predictionPercentage, quota, cacheTime } }.
 * Availability strings seen live: AVAILABLE-59, CURR_AVBL-0025, RAC 28,
 * RLWL24/WL15, GNWL45, REGRET/WL, NOT AVAILABLE, CHART PREPARED.
 * The search is date-parameterised and returns only trains running that day,
 * so no local weekday filtering is applied.
 */
import { Availability, Quota, Station, Stop, Train, TrainClass, Weekday } from '../models/train.models';
import { ProviderError, TrainDataProvider } from './train-data-provider';

export interface ConfirmTktConfig {
  baseUrl?: string;
  /** Minimum gap between upstream calls. Default 150ms. */
  minIntervalMs?: number;
  /** Max concurrent upstream fetches. */
  maxConcurrency?: number;
  /** Search + availability cache. ConfirmTkt serves its own cache upstream; default 90s. */
  searchTtlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface CtAvailabilityEntry {
  availability?: string;
  availabilityDisplayName?: string;
  fare?: string | number;
  predictionPercentage?: number | string;
  quota?: string;
  cacheTime?: string;
}

interface CtTrain {
  trainNumber?: string;
  trainName?: string;
  fromStnCode?: string;
  toStnCode?: string;
  departureTime?: string;
  arrivalTime?: string;
  duration?: number | string;
  distance?: number | string;
  runningDays?: string;
  avlClasses?: string[];
  availabilityCache?: Record<string, CtAvailabilityEntry>;
}

interface CtEnvelope {
  data?: { trainList?: CtTrain[] };
  error?: { message?: string; code?: string | number };
  errorMessage?: string | null;
  errorCode?: number;
}

interface LegEntry {
  from: string;
  to: string;
  date: string;
  expiresAt: number;
  classes: Partial<Record<string, CtAvailabilityEntry>>;
}

const ALL_DAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function normaliseClock(raw: string | undefined): string {
  const m = String(raw ?? '').trim().match(/^(\d{1,2})[:.](\d{2})/);
  if (!m) return '00:00';
  return `${m[1]!.padStart(2, '0')}:${m[2]}`;
}

function clockMinutes(clock: string): number {
  const [h, m] = clock.split(':');
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

function parseRuns(mask: string | undefined): Weekday[] {
  if (!mask || mask.length < 7) return [...ALL_DAYS];
  const out: Weekday[] = [];
  for (let i = 0; i < 7; i++) if (mask[i] === '1' || mask[i] === 'Y') out.push((i + 1) as Weekday);
  return out.length > 0 ? out : [...ALL_DAYS];
}

/**
 * Maps one ConfirmTkt availability entry onto the app's Availability. Order
 * matters: "REGRET/WL" and "NOT AVAILABLE" also contain WL and AVAILABLE.
 */
function mapAvailabilityRaw(entry: CtAvailabilityEntry): Availability {
  const rawAv = (entry.availability ?? '').trim();
  const text = `${rawAv} ${entry.availabilityDisplayName ?? ''}`.toUpperCase();
  const count = (pattern: RegExp): number => {
    const m = pattern.exec(text);
    return m?.[1] ? Number(m[1]) : 0;
  };
  if (/REGRET|NOT AVAILABLE|NOT AVAILABLE/.test(text)) {
    return { state: 'NOT_AVAILABLE', count: 0 };
  }
  if (/\bRAC\b/.test(text)) {
    return { state: 'RAC', count: count(/\bRAC[- /]*(\d+)/) };
  }
  if (/WL/.test(text)) {
    // "RLWL24/WL15": the figure after the last WL is the live position.
    const positions = [...text.matchAll(/WL[- /]*(\d+)/g)];
    let wlPrefix: string | undefined;
    const lastSlash = rawAv.lastIndexOf('/');
    if (lastSlash > 0) wlPrefix = rawAv.slice(0, lastSlash).toUpperCase();
    else {
      const pm = /^([A-Z]{2,6})\d*/.exec(rawAv);
      if (pm) wlPrefix = pm[1]!.toUpperCase();
    }
    return {
      state: 'WL',
      count: positions.length > 0 ? Number(positions[positions.length - 1]![1]) : 0,
      ...(wlPrefix ? { wlPrefix } : {}),
    };
  }
  if (/\bAVAILABLE\b|CURR_AVBL/.test(text)) {
    return { state: 'AVAILABLE', count: count(/(?:AVAILABLE|CURR_AVBL)[- ]*(\d+)/) };
  }
  if (/CHART|DEPARTED/.test(text)) {
    return { state: 'NOT_AVAILABLE', count: 0 };
  }
  return { state: 'NOT_AVAILABLE', count: 0 };
}

/** Maps one entry, stamping the upstream snapshot time (ConfirmTkt cacheTime,
 * its own IST wall clock) onto the result so the UI can show data freshness. */
function mapAvailability(entry: CtAvailabilityEntry): Availability {
  const base = mapAvailabilityRaw(entry);
  const ct = (entry.cacheTime ?? '').trim();
  return ct ? { ...base, asOf: ct } : base;
}

export class ConfirmTktProvider implements TrainDataProvider {
  private readonly base: string;
  private readonly minIntervalMs: number;
  private readonly maxConcurrency: number;
  private readonly searchTtlMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly fallback: TrainDataProvider;

  private readonly cache = new Map<string, { value: unknown; expiresAt: number }>();
  /** trainNo -> legKey (FROM|TO|DATE) -> cached classes for that leg. */
  private readonly legs = new Map<string, Map<string, LegEntry>>();
  private inFlight = 0;
  private lastStart = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(fallback: TrainDataProvider, config: ConfirmTktConfig = {}) {
    this.fallback = fallback;
    this.base = (config.baseUrl ?? 'https://cttrainsapi.confirmtkt.com').replace(/\/$/, '');
    this.minIntervalMs = config.minIntervalMs ?? 150;
    this.maxConcurrency = config.maxConcurrency ?? 4;
    this.searchTtlMs = config.searchTtlMs ?? 90_000;
    this.fetchImpl = config.fetchImpl ?? ((u, i) => fetch(u, i));
    this.now = config.now ?? Date.now;
  }

  /**
   * Public constants ConfirmTkt's own web bundle sends on every call: a client
   * identifier, not a per-user secret, and no account is involved.
   */
  private headers(): Record<string, string> {
    return {
      Accept: 'application/json',
      clientid: 'ct-web',
      apikey: 'ct-web!2$',
      deviceid: 'railvaani-0000-0000-0000-000000000000',
    };
  }

  async searchTrains(from: string, to: string, date: string): Promise<Train[]> {
    const fc = from.trim().toUpperCase();
    const tc = to.trim().toUpperCase();
    if (!fc || !tc) throw new ProviderError('bad_request', 'Both stations are required.');
    if (fc === tc) throw new ProviderError('bad_request', 'Origin and destination are the same station.');
    const key = `search:${fc}:${tc}:${date}`;
    this.lastDate = date;
    const json = await this.getJson(
      `${this.base}/api/v1/trains/search?sourceStationCode=${encodeURIComponent(fc)}&destinationStationCode=${encodeURIComponent(tc)}&dateOfJourney=${encodeURIComponent(this.ddmmyyyy(date))}`,
      key,
      'ConfirmTkt',
    );
    const out: Train[] = [];
    const list = json.data?.trainList ?? [];
    for (const t of list) {
      const number = (t.trainNumber ?? '').trim();
      if (!/^\d{4,5}$/.test(number)) continue;
      const depTime = normaliseClock(t.departureTime);
      const arrTime = normaliseClock(t.arrivalTime);
      let durationMins = Number(t.duration);
      if (!Number.isFinite(durationMins) || durationMins <= 0) {
        durationMins = clockMinutes(arrTime) - clockMinutes(depTime);
        if (durationMins < 0) durationMins += 1440;
      }
      const legFrom = (t.fromStnCode ?? fc).toUpperCase();
      const legTo = (t.toStnCode ?? tc).toUpperCase();
      this.rememberLeg(number, legFrom, legTo, date, t.availabilityCache);
      out.push({
        number,
        name: t.trainName ?? number,
        runsOn: parseRuns(t.runningDays),
        from: legFrom,
        to: legTo,
        depTime,
        arrTime,
        durationMins,
      });
    }
    return out;
  }

  async getAvailability(
    trainNo: string,
    from: string,
    to: string,
    date: string,
    cls: TrainClass,
    _quota: Quota,
  ): Promise<Availability> {
    const entry = await this.classEntry(trainNo, from.toUpperCase(), to.toUpperCase(), date, cls);
    return mapAvailability(entry);
  }

  async getFare(
    trainNo: string,
    from: string,
    to: string,
    cls: TrainClass,
    _quota: Quota,
  ): Promise<number> {
    const number = trainNo.trim();
    const prefix = `${from.toUpperCase()}|${to.toUpperCase()}`;
    let leg = this.findLeg(number, prefix, this.lastDate);
    if (!leg) {
      // The engine always searches a leg before pricing it, so this cold path
      // is rare; the date comes from the most recent search.
      if (this.lastDate) await this.searchTrains(from, to, this.lastDate);
      leg = this.findLeg(number, prefix, this.lastDate);
    }
    const fare = Number(leg?.classes[cls]?.fare);
    if (!Number.isFinite(fare) || fare <= 0) {
      throw new ProviderError('no_seats', `Train ${trainNo} offers no ${cls} on this leg.`);
    }
    return fare;
  }

  /** Every class's status for a train+date from the search cache; no extra call. */
  async getAvailabilityAll(trainNo: string, date: string): Promise<Partial<Record<string, Availability>>> {
    const entry = this.latestLeg(trainNo, date);
    if (!entry) {
      throw new ProviderError('provider_down', `No cached availability for train ${trainNo}; search its route first.`);
    }
    const out: Partial<Record<string, Availability>> = {};
    for (const [cls, ce] of Object.entries(entry.classes)) {
      if (ce) out[cls] = mapAvailability(ce);
    }
    if (Object.keys(out).length === 0) {
      throw new ProviderError('no_seats', `No availability data for train ${trainNo}.`);
    }
    return out;
  }

  /** Cached per-class fares for a leg; no network call. Empty when uncached. */
  getFareTable(trainNo: string, from: string, to: string): Partial<Record<string, number>> {
    const leg = this.findLeg(trainNo.trim(), `${from.toUpperCase()}|${to.toUpperCase()}`, this.lastDate);
    if (!leg) return {};
    const out: Partial<Record<string, number>> = {};
    for (const [cls, ce] of Object.entries(leg.classes)) {
      const fare = Number(ce?.fare);
      if (ce && Number.isFinite(fare) && fare > 0) out[cls] = fare;
    }
    return out;
  }

  /** ConfirmTkt has no route endpoint; the fallback (erail) serves this. */
  getRoute(trainNo: string): Promise<Stop[]> {
    return this.fallback.getRoute(trainNo);
  }

  searchStations(query: string): Promise<Station[]> {
    return this.fallback.searchStations(query);
  }

  listStations(): Promise<Station[]> {
    return this.fallback.listStations();
  }

  /** ConfirmTkt has no via-station endpoint; the fallback (erail) serves this. */
  suggestHubs(from: string, to: string): Promise<string[]> {
    return this.fallback.suggestHubs!(from, to);
  }

  /** The freshest cached leg for a train on a from|to pair, preferring the date. */
  private findLeg(trainNo: string, prefix: string, date?: string): LegEntry | undefined {
    const byLeg = this.legs.get(trainNo);
    if (!byLeg) return undefined;
    const fresh = [...byLeg.values()].filter(
      (l) => l.expiresAt > this.now() && `${l.from}|${l.to}` === prefix,
    );
    return fresh.find((l) => l.date === date) ?? fresh[0];
  }

  /**
   * Warms the per-date caches for a route: one upstream search per date (each
   * returns every train on the route that day), throttled and cached. Call
   * before dateWise; failures on individual dates are ignored.
   */
  async warmDates(from: string, to: string, dates: string[]): Promise<void> {
    for (const date of dates) {
      try {
        await this.searchTrains(from, to, date);
      } catch {
        // Best effort: dateWise simply omits dates it has no data for.
      }
    }
  }

  /** Cached per-date seat status for one train+class on a leg; call warmDates first. */
  dateWise(
    trainNo: string,
    from: string,
    to: string,
    cls: TrainClass,
    dates: string[],
  ): Partial<Record<string, Availability>> {
    const out: Partial<Record<string, Availability>> = {};
    const byLeg = this.legs.get(trainNo.trim());
    if (!byLeg) return out;
    for (const date of dates) {
      const leg = byLeg.get(`${from.toUpperCase()}|${to.toUpperCase()}|${date}`);
      if (!leg || leg.expiresAt <= this.now()) continue;
      const ce = leg.classes[cls];
      if (ce) out[date] = mapAvailability(ce);
    }
    return out;
  }

  // ---------------------------------------------------------------- internals

  /** Date of the most recent search; getFare has no date parameter. */
  private lastDate: string | undefined;

  /** Cached one class's entry, searching the leg first when cold. */
  private async classEntry(
    trainNo: string,
    from: string,
    to: string,
    date: string,
    cls: string,
  ): Promise<CtAvailabilityEntry> {
    const number = trainNo.trim();
    const prefix = `${from.toUpperCase()}|${to.toUpperCase()}`;
    let leg = this.findLeg(number, prefix, date);
    if (!leg) {
      await this.searchTrains(from, to, date);
      leg = this.findLeg(number, prefix, date);
    }
    const entry = leg?.classes[cls];
    if (!entry) throw new ProviderError('no_seats', `Train ${trainNo} offers no ${cls} on this leg.`);
    return entry;
  }

  private rememberLeg(
    trainNo: string,
    from: string,
    to: string,
    date: string,
    classes: Record<string, CtAvailabilityEntry> | undefined,
  ): void {
    if (!classes) return;
    let byLeg = this.legs.get(trainNo);
    if (!byLeg) {
      byLeg = new Map();
      this.legs.set(trainNo, byLeg);
    }
    byLeg.set(`${from}|${to}|${date}`, {
      from,
      to,
      date,
      expiresAt: this.now() + this.searchTtlMs,
      classes: { ...classes },
    });
  }

  /** The freshest cached leg for a train, preferring the requested date. */
  private latestLeg(trainNo: string, date: string): LegEntry | undefined {
    const byLeg = this.legs.get(trainNo.trim());
    if (!byLeg) return undefined;
    const fresh = [...byLeg.values()].filter((l) => l.expiresAt > this.now());
    return fresh.find((l) => l.date === date) ?? fresh[0];
  }

  private ddmmyyyy(date: string): string {
    const [y, m, d] = date.split('-');
    return `${d}-${m}-${y}`;
  }

  /** GET with TTL cache, inflight dedupe, throttling and one 429/5xx retry. */
  private async getJson(url: string, cacheKey: string, label: string): Promise<CtEnvelope> {
    const hit = this.cache.get(cacheKey) as { value: CtEnvelope; expiresAt: number } | undefined;
    if (hit && hit.expiresAt > this.now()) return hit.value;
    const inflight = this.cache.get(`__inflight:${cacheKey}`) as
      | { value: Promise<CtEnvelope>; expiresAt: number }
      | undefined;
    if (inflight && inflight.expiresAt > this.now()) return inflight.value;
    const load = this.fetchJson(url, label).then((json) => {
      this.cache.set(cacheKey, { value: json, expiresAt: this.now() + this.searchTtlMs });
      return json;
    });
    this.cache.set(`__inflight:${cacheKey}`, { value: load, expiresAt: this.now() + 30_000 });
    try {
      return await load;
    } finally {
      this.cache.delete(`__inflight:${cacheKey}`);
    }
  }

  private async fetchJson(url: string, label: string): Promise<CtEnvelope> {
    let lastErr: unknown = new ProviderError('provider_down', `${label}: no attempt made.`);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.acquire();
      const start = Math.max(this.lastStart + this.minIntervalMs, this.now());
      this.lastStart = start;
      try {
        await sleep(Math.max(0, start - this.now()));
        const res = await this.fetchImpl(url, { headers: this.headers() });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new ProviderError('provider_down', `${label} returned HTTP ${res.status}.`);
          await sleep(1500);
          continue;
        }
        if (!res.ok) throw new ProviderError('provider_down', `${label} returned HTTP ${res.status}.`);
        const json = (await res.json()) as CtEnvelope;
        const errMsg = json.error?.message ?? (json.errorCode ? json.errorMessage : null);
        if (errMsg) throw new ProviderError('provider_down', `${label}: ${errMsg}`);
        return json;
      } catch (e) {
        if (e instanceof ProviderError && e.kind !== 'provider_down') throw e;
        lastErr = e;
        if (attempt === 1) break;
        await sleep(1500);
      } finally {
        this.release();
      }
    }
    throw lastErr;
  }

  private acquire(): Promise<void> {
    if (this.inFlight < this.maxConcurrency) {
      this.inFlight += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.inFlight -= 1;
  }
}
