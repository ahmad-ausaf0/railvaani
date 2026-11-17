/** Small in-memory cache for B2 and beyond: per-entry TTL, the fetch
 *  timestamp stored with each value, and a size cap with oldest-fetched-first
 *  eviction. Time is injectable so tests can step the clock. */
export interface CacheEntry<V> {
  value: V;
  /** When the value was fetched, used for eviction order. */
  fetchedAt: number;
  /** Absolute expiry; entries at or after this instant are stale. */
  expiresAt: number;
}

export class Cache<V> {
  private readonly map = new Map<string, CacheEntry<V>>();

  constructor(
    readonly cap = 500,
    private readonly now: () => number = Date.now,
  ) {}

  /** The stored value, or undefined when absent or expired (stale entries are
   *  dropped on read). */
  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Store a value with a TTL; overwriting re-stamps the fetch time. Past the
   *  cap the entry with the oldest fetch time is evicted first. */
  set(key: string, value: V, ttlMs: number): void {
    const t = this.now();
    this.map.delete(key); // so an overwrite lands at the end of the order
    this.map.set(key, { value, fetchedAt: t, expiresAt: t + ttlMs });
    while (this.map.size > this.cap) {
      let oldestKey: string | undefined;
      let oldestAt = Infinity;
      for (const [k, e] of this.map) {
        if (e.fetchedAt < oldestAt) {
          oldestAt = e.fetchedAt;
          oldestKey = k;
        }
      }
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
    }
  }

  get size(): number {
    return this.map.size;
  }
}
