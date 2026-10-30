/** Core domain models for RailVaani. Pure types only: no framework imports. */

/** ISO weekday number, 1 = Monday ... 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Station {
  /** e.g. 'GKP' */
  code: string;
  /** e.g. 'Gorakhpur Junction' */
  name: string;
  /** Hindi display name, e.g. 'गोरखपुर जंक्शन' */
  nameHi?: string;
  /** Railway zone, e.g. 'NER' */
  zone: string;
  isJunction: boolean;
}

export type TrainClass = 'SL' | '3A' | '3E' | '2A' | '1A' | 'CC' | '2S';
export type Quota = 'GN' | 'TQ' | 'SR' | 'LD' | 'HP';

export type AvailabilityState =
  | 'AVAILABLE'
  | 'RAC'
  | 'WL'
  | 'NOT_AVAILABLE'
  | 'REGRET';

export interface Availability {
  state: AvailabilityState;
  /** Seats, RAC berths, or waitlist position depending on state. */
  count: number;
  /** e.g. 'GNWL12' when state is WL. */
  wlPrefix?: string;
  /** Upstream snapshot time (ISO, the provider's own zone) when the source stamps one. */
  asOf?: string;
}

export interface Train {
  number: string;
  name: string;
  /** Departure days from the origin of this direction of travel. */
  runsOn: Weekday[];
  from: string;
  to: string;
  /** 'HH:MM' clock time at origin. */
  depTime: string;
  /** 'HH:MM' clock time at destination; may cross midnight. */
  arrTime: string;
  durationMins: number;
}

export interface Stop {
  station: Station;
  arr?: string;
  dep?: string;
  /** Day offset from the origin departure of this direction of travel. */
  day: number;
  /** Cumulative km from the origin along the train's route. */
  km: number;
}

/** One leg of an itinerary between two stations on one train. */
export interface Segment {
  train: Train;
  fromCode: string;
  toCode: string;
  depTime: string;
  arrTime: string;
  /** Arrival day offset from the leg's departure. */
  dayOffset: number;
  distanceKm: number;
}

export interface Leg {
  segment: Segment;
  cls: TrainClass;
  quota: Quota;
  fare: number;
  availability: Availability;
}

export interface Itinerary {
  legs: Leg[];
  /** legs.length - 1 */
  transfers: number;
  totalFare: number;
  /** Departure of leg 1 to arrival of the last leg, in minutes. */
  totalTimeMins: number;
  layoverMins: number[];
  viaCodes: string[];
  /** True when the transfer happens at one station (no cross-station walk). */
  sameStationTransfers: boolean[];
  /** 0 (lowest risk) to 100. */
  riskScore: number;
  /** Plain-language summary, e.g. 'Two trains via Lucknow, total Rs 540, 1 change, 2h 10m wait.' */
  explanation: string;
}

/** Spoken and visible labels: availability is never shown by colour alone. */
export const AVAILABILITY_LABELS: Record<AvailabilityState, { en: string; hi: string; icon: string }> = {
  AVAILABLE: { en: 'Available', hi: 'उपलब्ध', icon: '\u2713' },
  RAC: { en: 'RAC: side berth shared, usually confirmed', hi: 'आरएसी', icon: '\u25D0' },
  WL: { en: 'Waiting list: seat not confirmed yet', hi: 'वेटिंग लिस्ट', icon: '\u2715' },
  NOT_AVAILABLE: { en: 'Not available for this date', hi: 'उपलब्ध नहीं', icon: '\u2715' },
  REGRET: { en: 'Regret: booking closed, waitlist too long', hi: 'रिग्रेट', icon: '\u2715' },
};

export const CLASS_LABELS: Record<TrainClass, string> = {
  SL: 'Sleeper',
  '3A': 'AC 3 Tier',
  '3E': 'AC 3 Economy',
  '2A': 'AC 2 Tier',
  '1A': 'AC First',
  CC: 'Chair Car',
  '2S': 'Second Sitting',
};

export const QUOTA_LABELS: Record<Quota, string> = {
  GN: 'General',
  TQ: 'Tatkal',
  SR: 'Senior citizen',
  LD: 'Ladies',
  HP: 'Divyangjan',
};

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
};
