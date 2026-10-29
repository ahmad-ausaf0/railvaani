import { Availability, Quota, Station, Stop, Train, TrainClass } from '../models/train.models';

export type ProviderErrorKind = 'provider_down' | 'no_route' | 'no_seats' | 'bad_request';

/** Mapped to one of the app's four error states in the UI. */
export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Swappable data layer. Every feature and every test codes against this interface
 * only, never against a concrete provider.
 */
export interface TrainDataProvider {
  searchTrains(from: string, to: string, date: string): Promise<Train[]>;
  getAvailability(
    trainNo: string,
    from: string,
    to: string,
    date: string,
    cls: TrainClass,
    quota: Quota,
  ): Promise<Availability>;
  getFare(trainNo: string, from: string, to: string, cls: TrainClass, quota: Quota): Promise<number>;
  /** Ordered stations with arrival/departure times and distance, in the train's stored direction. */
  getRoute(trainNo: string): Promise<Stop[]>;
  /** Fuzzy match on name, code, Hindi names and common misspellings. */
  searchStations(query: string): Promise<Station[]>;
  /** All stations the provider knows, for split-journey hub enumeration. */
  listStations(): Promise<Station[]>;
}
