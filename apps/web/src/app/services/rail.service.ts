import { Injectable } from '@angular/core';

import { Availability, ErailProvider, Station, TrainClass } from '@railvaani/train-core';
import { findOptions, SplitOption } from '@railvaani/split-engine';

/** Live progress the UI shows while a search runs. */
export interface SearchProgress {
  stage: 'searching' | 'checking_seats';
  done: number;
  total: number;
}

/** Talks to the live all-India data source (erail's public endpoints, no key). */
@Injectable({ providedIn: 'root' })
export class RailService {
  // Browsers cannot read erail.in cross-origin (no CORS headers on its side),
  // so every call goes through a CORS-enabled relay; the direct route stays
  // the server-side path. r.jina.ai is the only public relay that reliably
  // echoes a permissive access-control-allow-origin; the others fail outright
  // from the browser and only add failed round-trips to every call. The
  // provider keeps a small fetch pool under jina's ~20 requests/minute limit
  // and retries 429s, so a search of a dozen trains settles in well under a
  // minute instead of minutes.
  private readonly provider = new ErailProvider({
    minIntervalMs: 300,
    maxConcurrency: 3,
    preferProxy: true,
    proxyFallbacks: [(u) => `https://r.jina.ai/${u}`],
  });

  useStations(stations: Station[]): void {
    this.provider.setStations(stations);
  }

  async find(
    from: string,
    to: string,
    date: string,
    cls: TrainClass,
    budgetPerHead?: number,
    onProgress?: (p: SearchProgress) => void,
  ): Promise<SplitOption[]> {
    return findOptions(this.provider, {
      from,
      to,
      date,
      cls,
      quota: 'GN',
      budgetPerHead,
      availabilityMode: 'deferred',
      maxResults: 12,
      excludeDeparted: true,
      onProgress: onProgress
        ? (stage, done, total) => onProgress({ stage, done, total })
        : undefined,
    });
  }

  /** Every class's seat status for a train+date; served from the search's cache. */
  availabilityFor(trainNo: string, date: string): Promise<Partial<Record<string, Availability>>> {
    return this.provider.getAvailabilityAll(trainNo, date);
  }

  /** Cached per-class fares for a leg; empty when the search did not touch it. */
  fareTableFor(trainNo: string, from: string, to: string): Partial<Record<string, number>> {
    return this.provider.getFareTable(trainNo, from, to);
  }
}
