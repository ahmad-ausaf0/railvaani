import { Injectable } from '@angular/core';

import { ErailProvider, Station, TrainClass } from '@railvaani/train-core';
import { findOptions, SplitOption } from '@railvaani/split-engine';

/** Talks to the live all-India data source (erail's public endpoints, no key). */
@Injectable({ providedIn: 'root' })
export class RailService {
  private readonly provider = new ErailProvider({ minIntervalMs: 200 });

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
