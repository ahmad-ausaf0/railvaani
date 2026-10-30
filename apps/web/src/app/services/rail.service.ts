import { Injectable } from '@angular/core';

import { ErailProvider, Station, TrainClass } from '@railvaani/train-core';
import { findOptions, SplitOption } from '@railvaani/split-engine';

/** Talks to the live all-India data source (erail's public endpoints, no key). */
@Injectable({ providedIn: 'root' })
export class RailService {
  // Browsers cannot read erail.in cross-origin (no CORS headers on its side), so
  // every call goes through a CORS-enabled proxy; the direct route stays the
  // server-side path.
  private readonly provider = new ErailProvider({
    minIntervalMs: 200,
    preferProxy: true,
    proxyFallbacks: [
      (u) => `https://r.jina.ai/${u}`,
      (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    ],
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
    });
  }
}
