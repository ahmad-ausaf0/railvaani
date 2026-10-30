import { Injectable } from '@angular/core';

import { Availability, ConfirmTktProvider, ErailProvider, Station, TrainClass } from '@railvaani/train-core';
import { findOptions, SplitOption } from '@railvaani/split-engine';

/** Live progress the UI shows while a search runs. */
export interface SearchProgress {
  stage: 'searching' | 'checking_seats';
  done: number;
  total: number;
}

/** Talks to the live all-India data sources (ConfirmTkt + erail, no key). */
@Injectable({ providedIn: 'root' })
export class RailService {
  // Primary: ConfirmTkt's public trains API serves the train list, live seat
  // availability and quoted fares for a leg in ONE JSON call, answers with a
  // permissive access-control-allow-origin header, and needs no key, so the
  // browser calls it directly: no relays, no text scraping. It exposes no
  // route and no via-station endpoints.
  //
  // Secondary: erail's text endpoints fill those two gaps, from the browser
  // through the one working CORS relay (browsers cannot read erail.in
  // cross-origin). r.jina.ai is the only public relay that reliably echoes a
  // permissive access-control-allow-origin. Both fallback calls are cached
  // hard: one per route (hub suggestions, 24h) and one per train (route,
  // 24h), so a search pays them once and reuses them.
  private readonly erail = new ErailProvider({
    minIntervalMs: 300,
    maxConcurrency: 3,
    preferProxy: true,
    proxyFallbacks: [(u) => `https://r.jina.ai/${u}`],
  });

  private readonly provider = new ConfirmTktProvider(this.erail);

  useStations(stations: Station[]): void {
    this.erail.setStations(stations);
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
