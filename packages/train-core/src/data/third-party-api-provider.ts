import { Availability, Quota, Station, Stop, Train, TrainClass } from '../models/train.models';
import { ProviderError, TrainDataProvider } from './train-data-provider';

export interface ThirdPartyProviderConfig {
  baseUrl: string;
  /** Name of the env var holding the API key, e.g. 'TRAIN_API_KEY'. Never the key itself. */
  apiKeyEnvVar: string;
  /** Default 90 seconds. */
  availabilityTtlMs?: number;
  /** Default 7 days. */
  routeTtlMs?: number;
  /** Default 60 requests/minute. */
  rateLimitPerMinute?: number;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/**
 * Skeleton for a real third-party data provider. Wire the real vendor endpoints where
 * the TODO marker is; until then every call reports provider_down so the UI falls back
 * cleanly instead of pretending data exists. The API key is read from the environment
 * at request time and is never logged or serialized.
 */
export class ThirdPartyApiProvider implements TrainDataProvider {
  private readonly availabilityTtlMs: number;
  private readonly routeTtlMs: number;
  private readonly ratePerMinute: number;
  private readonly cache = new Map<string, CacheEntry>();
  private tokens: number;
  private lastRefill = Date.now();

  constructor(private readonly config: ThirdPartyProviderConfig) {
    if (!config.baseUrl) {
      throw new ProviderError('bad_request', 'ThirdPartyApiProvider needs a baseUrl.');
    }
    this.availabilityTtlMs = config.availabilityTtlMs ?? 90_000;
    this.routeTtlMs = config.routeTtlMs ?? 7 * 24 * 60 * 60_000;
    this.ratePerMinute = config.rateLimitPerMinute ?? 60;
    this.tokens = this.ratePerMinute;
  }

  async searchTrains(from: string, to: string, date: string): Promise<Train[]> {
    return this.cached(`trains:${from}:${to}:${date}`, 60_000, () =>
      this.request<Train[]>(`/trains?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&date=${date}`),
    );
  }

  async getAvailability(
    trainNo: string,
    from: string,
    to: string,
    date: string,
    cls: TrainClass,
    quota: Quota,
  ): Promise<Availability> {
    const key = `avail:${trainNo}:${from}:${to}:${date}:${cls}:${quota}`;
    return this.cached(key, this.availabilityTtlMs, () =>
      this.request<Availability>(`/availability?train=${trainNo}&from=${from}&to=${to}&date=${date}&class=${cls}&quota=${quota}`),
    );
  }

  async getFare(trainNo: string, from: string, to: string, cls: TrainClass, quota: Quota): Promise<number> {
    return this.request<number>(`/fare?train=${trainNo}&from=${from}&to=${to}&class=${cls}&quota=${quota}`);
  }

  async getRoute(trainNo: string): Promise<Stop[]> {
    return this.cached(`route:${trainNo}`, this.routeTtlMs, () =>
      this.request<Stop[]>(`/route/${encodeURIComponent(trainNo)}`),
    );
  }

  async searchStations(query: string): Promise<Station[]> {
    return this.request<Station[]>(`/stations?q=${encodeURIComponent(query)}`);
  }

  async listStations(): Promise<Station[]> {
    // TODO: wire the real vendor's station table here.
    throw new ProviderError('provider_down', 'Station table is not wired for the third-party provider yet.');
  }

  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) return hit.value as T;
    const value = await load();
    this.cache.set(key, { value, expiresAt: now + ttlMs });
    return value;
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRefill >= 60_000) {
      this.tokens = this.ratePerMinute;
      this.lastRefill = now;
    }
    if (this.tokens <= 0) {
      throw new ProviderError('provider_down', 'Rate limit reached; retry shortly.');
    }
    this.tokens -= 1;
  }

  // TODO: wire the real vendor endpoints here, with a mapper from their DTOs to our
  // domain models. Map HTTP failures to ProviderError kinds so the UI shows one of
  // its four error states (provider_down, no_route, no_seats, bad_request).
  private async request<T>(_path: string): Promise<T> {
    await this.throttle();
    throw new ProviderError(
      'provider_down',
      'Third-party provider is not configured. RailVaani is running on MockTrainProvider.',
    );
  }
}
