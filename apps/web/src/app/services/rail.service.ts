import { Injectable, signal } from '@angular/core';

import { Availability, Station, TrainClass } from '@railvaani/train-core';
import { SplitOption } from '@railvaani/split-engine';

import { apiBaseUrl } from '../core/api-config';

/** Live progress the UI shows while a search runs. */
export interface SearchProgress {
  stage: 'searching' | 'checking_seats';
  done: number;
  total: number;
}

type PerClassAvailability = Partial<Record<string, Availability>>;
type PerClassFares = Partial<Record<string, number>>;

/** The RailVaani API's search response. Option shapes are the engine's own,
 *  so components consume them unchanged. */
interface ApiSearchResponse {
  options: SplitOption[];
  fetchedAt?: string;
  expandedFrom?: string[];
  expandedTo?: string[];
  expandedFromCity?: string;
  expandedToCity?: string;
  hiddenByBudget?: number;
  partial?: boolean;
}

class RateLimitError extends Error {}

/** The A1 pacing, kept for the app's own API: 8s cap per call, one quiet
 *  retry on a timeout or a 5xx, never on a 4xx or a 429. */
const FETCH_TIMEOUT_MS = 8_000;
/** At most this many API calls in flight (AGENTS.md parallel cap). */
const PREFETCH_CONCURRENCY = 3;

async function fetchJson<T>(url: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (res.status === 429) throw new RateLimitError();
      if (!res.ok) {
        const e = new Error(`API answered ${res.status}`);
        (e as { status?: number }).status = res.status;
        throw e;
      }
      return (await res.json()) as T;
    } catch (e) {
      lastError = e;
      const status = (e as { status?: number }).status;
      const retryable = !(e instanceof RateLimitError) && (status === undefined || status >= 500);
      if (!retryable || attempt === 1) throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/** Runs jobs with at most `limit` in flight; failures belong to the caller. */
async function runBounded<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}

/** Talks to the RailVaani API: the browser stops calling data providers
 *  directly. Every provider key, the upstream pacing and the caches live on
 *  the server now; this service keeps the exact surface components already
 *  consume, so the pages do not change. */
@Injectable({ providedIn: 'root' })
export class RailService {
  /** Options the Any-class budget filter hid in the last search, for the header. */
  readonly budgetHidden = signal(0);

  /** Cities whose full station set the last search covered (the API's cluster
   *  expansion), for the results header note. */
  readonly expandedCities = signal<string[]>([]);

  /** Whether the last search's response flagged partial results. */
  private lastSearchPartial = false;

  /** Whether the last failed search hit the API's rate limit. */
  private lastFailureWasRateLimit = false;

  /** The message for the results page's failure banner: a 429 gets its own
   *  plain line, everything else keeps the A1 wording. */
  failureMessage(): string {
    return this.lastFailureWasRateLimit
      ? 'Too many searches right now. Wait a few seconds and try again.'
      : 'Train data could not be reached. Check your connection and try again.';
  }

  partialResults(): boolean {
    return this.lastSearchPartial;
  }

  /** Direct legs of the last search, for warmDates' date-strip fan-out. */
  private directLegs: Array<{ trainNumber: string; from: string; to: string }> = [];

  /** Per-class availability per train+date: filled by availability calls and
   *  by warmDates' strip fan-out, read synchronously by dateWiseFor. */
  private readonly availByTrainDate = new Map<string, Map<string, PerClassAvailability>>();

  /** Per-class fares per train+leg, prefetched with each search so the
   *  page's synchronous fareTableFor reads are warm when the cards render. */
  private readonly fareCache = new Map<string, PerClassFares>();

  /** Kept for the components' call: the station directory was only needed by
   *  the in-browser erail provider, which the API replaced. */
  useStations(_stations: Station[]): void {}

  async find(
    from: string,
    to: string,
    date: string,
    budgetPerHead?: number,
    onProgress?: (p: SearchProgress) => void,
  ): Promise<SplitOption[]> {
    this.lastFailureWasRateLimit = false;
    onProgress?.({ stage: 'searching', done: 0, total: 0 });
    const params = new URLSearchParams({ from, to, date, cls: 'ANY', quota: 'GN' });
    if (budgetPerHead !== undefined) params.set('budget', String(budgetPerHead));
    let body: ApiSearchResponse;
    try {
      body = await fetchJson<ApiSearchResponse>(
        `${apiBaseUrl}/api/search?${params.toString()}`,
      );
    } catch (e) {
      if (e instanceof RateLimitError) this.lastFailureWasRateLimit = true;
      throw e;
    }
    this.lastSearchPartial = body.partial === true;
    this.budgetHidden.set(body.hiddenByBudget ?? 0);
    const cities = [body.expandedFromCity, body.expandedToCity].filter((c): c is string => !!c);
    this.expandedCities.set([...new Set(cities)]);
    this.directLegs = body.options
      .filter((o) => o.type === 'direct')
      .map((o) => o.legs[0])
      .filter((l) => !!l)
      .map((l) => ({ trainNumber: l.trainNumber, from: l.from, to: l.to }));

    // Fares are not part of the search response: prefetch one fare table per
    // direct train so fareTableFor (a synchronous read) is warm the moment
    // the cards render. A failed table simply leaves that card's fares to
    // the "book on IRCTC" fallback, as an unchecked fare always has.
    const unique = new Map<string, { trainNumber: string; from: string; to: string }>();
    for (const l of this.directLegs) unique.set(l.trainNumber, l);
    const jobs = [...unique.values()];
    let done = 0;
    onProgress?.({ stage: 'searching', done: 0, total: jobs.length });
    await runBounded(jobs, PREFETCH_CONCURRENCY, async (job) => {
      const fares = await this.fetchFareTable(job.trainNumber, job.from, job.to).catch(
        () => undefined,
      );
      if (fares) this.fareCache.set(`${job.trainNumber}:${job.from}:${job.to}`, fares);
      done += 1;
      onProgress?.({ stage: 'searching', done, total: jobs.length });
    });
    return body.options;
  }

  /** Every class's seat status for a train+date; the API caches server-side,
   *  this service caches per session. */
  async availabilityFor(trainNo: string, date: string): Promise<PerClassAvailability> {
    const cached = this.availByTrainDate.get(trainNo)?.get(date);
    if (cached) return cached;
    const body = await fetchJson<{ availability: PerClassAvailability; fetchedAt?: string }>(
      `${apiBaseUrl}/api/availability?trainNo=${encodeURIComponent(trainNo)}&date=${encodeURIComponent(date)}`,
    );
    const availability = body.availability ?? {};
    this.rememberAvailability(trainNo, date, availability);
    return availability;
  }

  /** Cached per-class fares for a leg; empty when the search's prefetch did
   *  not land one. */
  fareTableFor(trainNo: string, from: string, to: string): PerClassFares {
    return this.fareCache.get(`${trainNo}:${from}:${to}`) ?? {};
  }

  /** Warms per-date caches for the date strip: one availability call per
   *  train and date not already cached. The API keys availability by
   *  train+date, not by route, so every direct train of the last search
   *  warms from the same fan-out, whichever cluster stations its legs use. */
  async warmDates(_from: string, _to: string, dates: string[]): Promise<void> {
    if (this.directLegs.length === 0) return;
    const jobs: Array<{ trainNumber: string; date: string }> = [];
    for (const leg of this.directLegs) {
      for (const date of dates) {
        if (!this.availByTrainDate.get(leg.trainNumber)?.has(date)) {
          jobs.push({ trainNumber: leg.trainNumber, date });
        }
      }
    }
    await runBounded(jobs, PREFETCH_CONCURRENCY, async (job) => {
      await this.availabilityFor(job.trainNumber, job.date).catch(() => undefined);
    });
  }

  /** Cached per-date seat status for one train+class; call warmDates first. */
  dateWiseFor(
    trainNo: string,
    _from: string,
    _to: string,
    cls: TrainClass,
    dates: string[],
  ): Partial<Record<string, Availability>> {
    const out: Partial<Record<string, Availability>> = {};
    const byDate = this.availByTrainDate.get(trainNo);
    if (!byDate) return out;
    for (const date of dates) {
      const per = byDate.get(date)?.[cls];
      if (per) out[date] = per;
    }
    return out;
  }

  private rememberAvailability(trainNo: string, date: string, availability: PerClassAvailability): void {
    let byDate = this.availByTrainDate.get(trainNo);
    if (!byDate) {
      byDate = new Map();
      this.availByTrainDate.set(trainNo, byDate);
    }
    byDate.set(date, availability);
  }

  private async fetchFareTable(
    trainNo: string,
    from: string,
    to: string,
  ): Promise<PerClassFares> {
    const body = await fetchJson<{ fares: PerClassFares; fetchedAt?: string }>(
      `${apiBaseUrl}/api/fare-table?trainNo=${encodeURIComponent(trainNo)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    return body.fares ?? {};
  }
}
