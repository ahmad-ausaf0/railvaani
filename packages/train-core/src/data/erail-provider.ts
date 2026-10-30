import { Availability, Quota, Station, Stop, Train, TrainClass, Weekday } from '../models/train.models';
import { ProviderError, TrainDataProvider } from './train-data-provider';

export interface ErailProviderConfig {
  baseUrl?: string;
  /** Minimum gap between upstream calls. Default 250ms. */
  minIntervalMs?: number;
  /** Trains-between-stations response cache. Default 30 minutes. */
  betweenTtlMs?: number;
  /** Per-train availability cache (date-keyed). Default 90 seconds. */
  trainInfoTtlMs?: number;
  /** Route cache. Default 24 hours. */
  routeTtlMs?: number;
  /** Via-station suggestion cache. Default 24 hours. */
  hubTtlMs?: number;
  /** Stations for autocomplete and name resolution. Set after load via setStations. */
  stationDirectory?: Station[];
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Fixed fare-table group order in erail's responses. */
const FARE_GROUP_ORDER: string[] = ['1A', '2A', '3A', 'CC', 'EC', 'SL', 'FC', '3E', '2S'];

interface CacheEntry<T> { value: T; expiresAt: number }

/** Leg-scoped data parsed from a between-stations search. */
interface LegInfo {
  fares: Partial<Record<string, number>>;
  routeId: string;
  distanceKm: number;
  depClock: string;
  arrClock: string;
  durationMins: number;
  runsOn: Weekday[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function dotClock(v: string): string | null {
  const m = /^(\d{1,2})\.(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || min > 59 || h > 47) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function dotDuration(v: string): number | null {
  const m = /^(\d{1,3})\.(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || min > 59) return null;
  return h * 60 + min;
}

/** Mon-first 7-char run mask -> ISO weekdays. */
function parseMask(v: string): Weekday[] {
  if (!/^[01]{7}$/.test(v)) return [];
  const out: Weekday[] = [];
  for (let i = 0; i < 7; i++) if (v[i] === '1') out.push((i + 1) as Weekday);
  return out;
}

function weekdayOf(date: string): Weekday {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new ProviderError('bad_request', `Invalid date: ${date}`);
  return (((d.getUTCDay() + 6) % 7) + 1) as Weekday;
}

export class ErailProvider implements TrainDataProvider {
  private readonly base: string;
  private readonly minIntervalMs: number;
  private readonly betweenTtlMs: number;
  private readonly trainInfoTtlMs: number;
  private readonly routeTtlMs: number;
  private readonly hubTtlMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  private stations: Station[];
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly legInfo = new Map<string, { info: LegInfo; expiresAt: number }>();
  private queue: Promise<void> = Promise.resolve();

  constructor(config: ErailProviderConfig = {}) {
    this.base = (config.baseUrl ?? 'https://erail.in').replace(/\/$/, '');
    this.minIntervalMs = config.minIntervalMs ?? 250;
    this.betweenTtlMs = config.betweenTtlMs ?? 30 * 60_000;
    this.trainInfoTtlMs = config.trainInfoTtlMs ?? 90_000;
    this.routeTtlMs = config.routeTtlMs ?? 24 * 60 * 60_000;
    this.hubTtlMs = config.hubTtlMs ?? 24 * 60 * 60_000;
    this.fetchImpl = config.fetchImpl ?? ((u, i) => fetch(u, i));
    this.now = config.now ?? Date.now;
    this.stations = [...(config.stationDirectory ?? [])];
  }

  /** Swap in the full station directory once it loads (async asset). */
  setStations(list: Station[]): void {
    this.stations = [...list];
  }

  /** erail's own via-station suggestions: the split engine's hub candidates. */
  async suggestHubs(from: string, to: string): Promise<string[]> {
    const key = `hubs:${from}:${to}`;
    const cached = this.cache.get(key) as CacheEntry<string[]> | undefined;
    if (cached && cached.expiresAt > this.now()) return cached.value;
    const date = new Date(this.now());
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mon = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    const url = `${this.base}/data.aspx?Action=Alternate&Data1=${encodeURIComponent(from)}&Data2=${encodeURIComponent(to)}&Data3=${dd}-${mon}-${date.getUTCFullYear()}`;
    const text = await this.getText(url, this.hubTtlMs, key);
    const hubs: string[] = [];
    for (const item of text.split('~')) {
      if (!item) continue;
      const f = item.split('^');
      if (f.length >= 3 && f[2] && /^[A-Z0-9]{2,5}$/.test(f[2])) hubs.push(f[2].toUpperCase());
    }
    return hubs;
  }

  async searchTrains(from: string, to: string, date: string): Promise<Train[]> {
    const fc = this.resolveCode(from);
    const tc = this.resolveCode(to);
    if (!fc || !tc) {
      throw new ProviderError('bad_request', `Unknown station: ${!fc ? from : to}`);
    }
    if (fc === tc) throw new ProviderError('bad_request', 'Origin and destination are the same station.');
    const weekday = weekdayOf(date);
    const text = await this.getBetween(fc, tc);
    const out: Train[] = [];
    for (const f of text.split('^').slice(1).map((r) => r.split('~'))) {
      if (!/^\d{5}$/.test((f[0] ?? '').trim())) continue; // header or malformed segment
      if ((f[7] ?? '').toUpperCase() !== fc || (f[9] ?? '').toUpperCase() !== tc) continue;
      const parsed = this.parseLegRecord(f, fc, tc);
      if (!parsed) continue;
      const [leg, train] = parsed;
      if (!train.runsOn.includes(weekday)) continue;
      this.legInfo.set(`${train.number}|${fc}|${tc}`, { info: leg, expiresAt: this.now() + this.betweenTtlMs });
      out.push(train);
    }
    return out;
  }

  /** Leg fare from the cached search response; never fetches. */
  async getFare(trainNo: string, from: string, to: string, cls: TrainClass, _quota: Quota): Promise<number> {
    const hit = this.legInfo.get(`${trainNo}|${from.toUpperCase()}|${to.toUpperCase()}`);
    if (!hit || hit.expiresAt <= this.now()) {
      throw new ProviderError('provider_down', `No cached fare data for train ${trainNo}.`);
    }
    const fare = hit.info.fares[cls];
    if (!fare || fare <= 0) throw new ProviderError('no_seats', `Train ${trainNo} offers no ${cls} on this leg.`);
    return fare;
  }

  async getAvailability(
    trainNo: string,
    _from: string,
    _to: string,
    date: string,
    cls: TrainClass,
    _quota: Quota,
  ): Promise<Availability> {
    const key = `avail:${trainNo}:${date}`;
    const body = await this.getText(
      `${this.base}/rail/getTrains.aspx?TrainNo=${encodeURIComponent(trainNo)}&DataSource=0&Language=0&Cache=true&DateOfJourney=${encodeURIComponent(this.ddmmyyyy(date))}`,
      this.trainInfoTtlMs,
      key,
    );
    const rec = body.split('^').slice(1).find((r) => r.split('~')[0]?.trim() === trainNo.trim());
    if (!rec) throw new ProviderError('no_route', `Train ${trainNo} not found.`);
    const availField = rec.split('~').find((v) => /^[0-9A-Z]{1,3}:.*\|/.test(v));
    if (!availField) throw new ProviderError('no_seats', `No availability data for train ${trainNo}.`);
    for (const entry of availField.split('|')) {
      const p = entry.split(':');
      if (p[0]?.trim() !== cls) continue;
      const available = Number(p[2]) || 0;
      const rac = Number(p[3]) || 0;
      const wl = Number(p[4]) || 0;
      if (available > 0) return { state: 'AVAILABLE', count: available };
      if (rac > 0) return { state: 'RAC', count: rac };
      if (wl > 0) return { state: 'WL', count: wl, wlPrefix: `GNWL${wl}` };
      return { state: 'NOT_AVAILABLE', count: 0 };
    }
    throw new ProviderError('no_seats', `Train ${trainNo} offers no ${cls}.`);
  }

  async getRoute(trainNo: string): Promise<Stop[]> {
    let routeId = '';
    for (const [key, hit] of this.legInfo) {
      if (key.startsWith(`${trainNo}|`) && hit.expiresAt > this.now()) { routeId = hit.info.routeId; break; }
    }
    if (!routeId) {
      const body = await this.getText(
        `${this.base}/rail/getTrains.aspx?TrainNo=${encodeURIComponent(trainNo)}&DataSource=0&Language=0&Cache=true`,
        this.routeTtlMs,
        `train:${trainNo}`,
      );
      const rec = body.split('^').slice(1).find((r) => r.split('~')[0]?.trim() === trainNo.trim());
      routeId = rec?.split('~')[33]?.trim() ?? '';
    }
    if (!/^\d+$/.test(routeId)) throw new ProviderError('no_route', `No route id for train ${trainNo}.`);
    const body = await this.getText(
      `${this.base}/data.aspx?Action=TRAINROUTE&Password=2012&Data1=${encodeURIComponent(routeId)}&Data2=0&Cache=true`,
      this.routeTtlMs,
      `route:${trainNo}`,
    );
    const recs = body.split('^').slice(1).map((r) => r.split('~'));
    if (recs.length < 2) throw new ProviderError('no_route', `No route for train ${trainNo}.`);
    return recs.map((f) => {
      const arr = f[3]?.trim();
      const dep = f[4]?.trim();
      const day = Number(f[7]) || 1;
      const km = Number(f[6]) || 0;
      return {
        station: { code: (f[1] ?? '').toUpperCase(), name: f[2] ?? '', zone: '', isJunction: false },
        ...(arr && arr !== 'First' ? { arr: dotClock(arr) ?? undefined } : {}),
        ...(dep && dep !== 'Last' ? { dep: dotClock(dep) ?? undefined } : {}),
        day,
        km,
      } as Stop;
    });
  }

  async searchStations(query: string): Promise<Station[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const byCode: Station[] = [];
    const byName: Station[] = [];
    for (const s of this.stations) {
      if (s.code.toLowerCase().startsWith(q)) byCode.push(s);
      else if (s.name.toLowerCase().includes(q)) byName.push(s);
      if (byCode.length >= 8 && byName.length >= 8) break;
    }
    return [...byCode, ...byName].slice(0, 12);
  }

  async listStations(): Promise<Station[]> {
    return this.stations;
  }

  // ---------------------------------------------------------------- internals

  private async getBetween(from: string, to: string): Promise<string> {
    const key = `between:${from}:${to}`;
    return this.getText(
      `${this.base}/rail/getTrains.aspx?Station_From=${encodeURIComponent(from)}&Station_To=${encodeURIComponent(to)}&DataSource=0&Language=0&Cache=true`,
      this.betweenTtlMs,
      key,
    );
  }

  /** GET with TTL cache, inflight dedupe, sentinel checks and throttling. */
  private async getText(url: string, ttlMs: number, cacheKey: string): Promise<string> {
    const hit = this.cache.get(cacheKey) as CacheEntry<string> | undefined;
    if (hit && hit.expiresAt > this.now()) return hit.value;
    const inflight = (this.cache.get(`__inflight:${cacheKey}`) as CacheEntry<Promise<string>> | undefined);
    if (inflight && inflight.expiresAt > this.now()) return inflight.value;
    const load = this.throttledFetch(url).then((text) => {
      this.cache.set(cacheKey, { value: text, expiresAt: this.now() + ttlMs });
      return text;
    });
    this.cache.set(`__inflight:${cacheKey}`, { value: load, expiresAt: this.now() + 30_000 });
    try {
      return await load;
    } finally {
      this.cache.delete(`__inflight:${cacheKey}`);
    }
  }

  private async throttledFetch(url: string): Promise<string> {
    const run = this.queue.then(async () => {
      await sleep(this.minIntervalMs);
      const res = await this.fetchImpl(url, {
        headers: { 'User-Agent': 'RailVaani/0.3 (train schedule demo)' } as Record<string, string>,
      });
      if (!res.ok) throw new ProviderError('provider_down', `Upstream returned HTTP ${res.status}.`);
      const text = (await res.text()).trim();
      if (text.startsWith('<')) {
        throw new ProviderError('provider_down', 'Upstream returned an HTML error page.');
      }
      return text;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private ddmmyyyy(date: string): string {
    const [y, m, d] = date.split('-');
    return `${d}-${m}-${y}`;
  }

  /** Parses one between-stations record. Returns null for malformed segments. */
  private parseLegRecord(f: string[], fc: string, tc: string): [LegInfo, Train] | null {
    const number = (f[0] ?? '').trim();
    const name = (f[1] ?? '').trim();
    const depClock = dotClock(f[10] ?? '');
    const arrClock = dotClock(f[11] ?? '');
    const durationMins = dotDuration(f[12] ?? '');
    const runsOn = parseMask(f[13] ?? '');
    if (!/^\d{5}$/.test(number) || !name || !depClock || !arrClock || !durationMins || durationMins <= 0) return null;
    const fares = this.parseFareField(f);
    const routeId = (f[33] ?? '').trim();
    const distanceKm = Number(f[39]) || 0;
    const leg: LegInfo = {
      fares,
      routeId,
      distanceKm,
      depClock,
      arrClock,
      durationMins,
      runsOn,
    };
    const train: Train = {
      number,
      name,
      runsOn: runsOn.length ? runsOn : [],
      from: fc,
      to: tc,
      depTime: depClock,
      arrTime: arrClock,
      durationMins,
    };
    return [leg, train];
  }

  private parseFareField(f: string[]): Partial<Record<string, number>> {
    const field = f.find((v) => /^[A-Z_]{2,15}:\d{2,5}:/.test(v));
    if (!field) return {};
    const groups = field.split(':');
    const fares: Partial<Record<string, number>> = {};
    for (let i = 0; i < FARE_GROUP_ORDER.length; i++) {
      const group = groups[2 + i];
      const cls = FARE_GROUP_ORDER[i];
      if (!group || !cls) break;
      const first = group.split(',')[0];
      const fare = Number(first);
      if (Number.isFinite(fare) && fare > 0) fares[cls] = fare;
    }
    return fares;
  }

  private resolveCode(input: string): string | null {
    const v = input.trim();
    if (!v) return null;
    const upper = v.toUpperCase();
    if (/^[A-Z0-9]{2,5}$/.test(upper) && this.stations.some((s) => s.code.toUpperCase() === upper)) return upper;
    const q = v.toLowerCase();
    const hit = this.stations.find((s) => s.name.toLowerCase() === q)
      ?? this.stations.find((s) => s.name.toLowerCase().includes(q));
    return hit ? hit.code : (/^[A-Z0-9]{2,5}$/.test(upper) ? upper : null);
  }
}
