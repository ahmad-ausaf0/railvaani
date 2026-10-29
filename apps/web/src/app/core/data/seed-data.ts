import { TrainClass, Weekday } from '../models/train.models';

/** Seed stations for the GKP / LKO / CNB / NDLS corridor (plus the Varanasi branch). */
export interface SeedStation {
  code: string;
  name: string;
  nameHi?: string;
  zone: string;
  isJunction: boolean;
}

export const SEED_STATIONS: SeedStation[] = [
  { code: 'GKP', name: 'Gorakhpur Junction', nameHi: 'गोरखपुर जंक्शन', zone: 'NER', isJunction: true },
  { code: 'LKO', name: 'Lucknow Charbagh', nameHi: 'लखनऊ', zone: 'NR', isJunction: true },
  { code: 'CNB', name: 'Kanpur Central', nameHi: 'कानपुर सेंट्रल', zone: 'NCR', isJunction: true },
  { code: 'BSB', name: 'Varanasi Junction', nameHi: 'वाराणसी जंक्शन', zone: 'NR', isJunction: true },
  { code: 'ALD', name: 'Prayagraj Junction', nameHi: 'प्रयागराज जंक्शन', zone: 'NCR', isJunction: true },
  { code: 'NDLS', name: 'New Delhi', nameHi: 'नई दिल्ली', zone: 'NR', isJunction: true },
  { code: 'DLI', name: 'Old Delhi Junction', nameHi: 'पुरानी दिल्ली', zone: 'NR', isJunction: true },
];

/** A stop on a train's stored route. Endpoints carry arr = dep. */
export interface SeedStop {
  code: string;
  /** Cumulative km from the train's stored origin. */
  km: number;
  arr: string;
  dep: string;
  /** Day offset from the stored origin's departure day. */
  day: number;
}

export interface SeedTrain {
  number: string;
  name: string;
  /** Days the train departs its stored origin. */
  runsOn: Weekday[];
  classes: TrainClass[];
  stops: SeedStop[];
}

const DAILY: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/**
 * 18 corridor trains. Distances are per-train cumulative and internally consistent:
 * GKP-LKO 283, LKO-CNB 89, CNB-NDLS 403 on the main line; GKP-BSB 233, BSB-ALD 135,
 * ALD-CNB 194 on the Varanasi line, which joins the main line at Kanpur.
 */
export const SEED_TRAINS: SeedTrain[] = [
  // Direct GKP to NDLS, via Lucknow-Kanpur (775 km).
  {
    number: '12555', name: 'Gorakhpur New Delhi Express', runsOn: DAILY,
    classes: ['SL', '3A', '2A', '2S'],
    stops: [
      { code: 'GKP', km: 0, arr: '20:10', dep: '20:10', day: 0 },
      { code: 'LKO', km: 283, arr: '00:05', dep: '00:25', day: 1 },
      { code: 'CNB', km: 372, arr: '02:35', dep: '02:40', day: 1 },
      { code: 'NDLS', km: 775, arr: '10:30', dep: '10:30', day: 1 },
    ],
  },
  {
    number: '12591', name: 'Gorakhpur New Delhi Express', runsOn: DAILY,
    classes: ['SL', '3A', '3E'],
    stops: [
      { code: 'GKP', km: 0, arr: '14:55', dep: '14:55', day: 0 },
      { code: 'LKO', km: 283, arr: '18:20', dep: '18:40', day: 0 },
      { code: 'CNB', km: 372, arr: '20:30', dep: '20:35', day: 0 },
      { code: 'NDLS', km: 775, arr: '05:50', dep: '05:50', day: 1 },
    ],
  },
  {
    number: '15707', name: 'Amrapali Express', runsOn: DAILY,
    classes: ['SL', '3A', '2A'],
    stops: [
      { code: 'GKP', km: 0, arr: '09:35', dep: '09:35', day: 0 },
      { code: 'LKO', km: 283, arr: '12:45', dep: '13:05', day: 0 },
      { code: 'CNB', km: 372, arr: '15:10', dep: '15:15', day: 0 },
      { code: 'NDLS', km: 775, arr: '01:10', dep: '01:10', day: 1 },
    ],
  },
  {
    number: '12561', name: 'Swatantrata Sangram Express', runsOn: DAILY,
    classes: ['2A', '3A', 'SL'],
    stops: [
      { code: 'GKP', km: 0, arr: '23:45', dep: '23:45', day: 0 },
      { code: 'LKO', km: 283, arr: '02:55', dep: '03:15', day: 1 },
      { code: 'CNB', km: 372, arr: '05:15', dep: '05:20', day: 1 },
      { code: 'NDLS', km: 775, arr: '15:20', dep: '15:20', day: 1 },
    ],
  },
  // Direct GKP to NDLS, via the Varanasi-Prayagraj line (965 km).
  {
    number: '22423', name: 'Gorakhpur New Delhi Express', runsOn: DAILY,
    classes: ['3A', 'SL', '3E'],
    stops: [
      { code: 'GKP', km: 0, arr: '21:30', dep: '21:30', day: 0 },
      { code: 'BSB', km: 233, arr: '23:45', dep: '23:55', day: 0 },
      { code: 'ALD', km: 368, arr: '02:00', dep: '02:10', day: 1 },
      { code: 'CNB', km: 562, arr: '05:45', dep: '05:50', day: 1 },
      { code: 'NDLS', km: 965, arr: '11:45', dep: '11:45', day: 1 },
    ],
  },
  // Varanasi line toward NDLS.
  {
    number: '22436', name: 'Vande Bharat Express', runsOn: [1, 2, 3, 4, 5, 6],
    classes: ['CC'],
    stops: [
      { code: 'BSB', km: 0, arr: '06:15', dep: '06:15', day: 0 },
      { code: 'ALD', km: 135, arr: '08:36', dep: '08:38', day: 0 },
      { code: 'CNB', km: 329, arr: '10:36', dep: '10:38', day: 0 },
      { code: 'NDLS', km: 732, arr: '14:00', dep: '14:00', day: 0 },
    ],
  },
  {
    number: '22969', name: 'Banaras New Delhi Superfast Express', runsOn: DAILY,
    classes: ['2A', '3A', 'SL'],
    stops: [
      { code: 'BSB', km: 0, arr: '15:00', dep: '15:00', day: 0 },
      { code: 'ALD', km: 135, arr: '17:15', dep: '17:20', day: 0 },
      { code: 'CNB', km: 329, arr: '19:35', dep: '19:40', day: 0 },
      { code: 'NDLS', km: 732, arr: '02:30', dep: '02:30', day: 1 },
    ],
  },
  {
    number: '12801', name: 'Purushottam Express', runsOn: DAILY,
    classes: ['2A', '3A', 'SL'],
    stops: [
      { code: 'BSB', km: 0, arr: '01:35', dep: '01:35', day: 0 },
      { code: 'ALD', km: 135, arr: '03:35', dep: '03:40', day: 0 },
      { code: 'CNB', km: 329, arr: '05:05', dep: '05:10', day: 0 },
      { code: 'NDLS', km: 732, arr: '11:35', dep: '11:35', day: 0 },
    ],
  },
  // GKP to LKO shuttles.
  {
    number: '15008', name: 'Gorakhpur Lucknow Intercity', runsOn: DAILY,
    classes: ['CC', '2S'],
    stops: [
      { code: 'GKP', km: 0, arr: '05:30', dep: '05:30', day: 0 },
      { code: 'LKO', km: 283, arr: '09:35', dep: '09:35', day: 0 },
    ],
  },
  {
    number: '15010', name: 'Gorakhpur Lucknow Express', runsOn: DAILY,
    classes: ['SL', '3A', 'CC'],
    stops: [
      { code: 'GKP', km: 0, arr: '13:15', dep: '13:15', day: 0 },
      { code: 'LKO', km: 283, arr: '17:45', dep: '17:45', day: 0 },
    ],
  },
  // LKO to NDLS legs.
  {
    number: '12429', name: 'Lucknow Rajdhani Express', runsOn: DAILY,
    classes: ['2A', '3A'],
    stops: [
      { code: 'LKO', km: 0, arr: '18:40', dep: '18:40', day: 0 },
      { code: 'CNB', km: 89, arr: '20:10', dep: '20:15', day: 0 },
      { code: 'NDLS', km: 492, arr: '00:30', dep: '00:30', day: 1 },
    ],
  },
  {
    number: '12230', name: 'Lucknow Duronto Express', runsOn: [2, 3, 4, 5, 6, 7],
    classes: ['2A', '3A'],
    stops: [
      { code: 'LKO', km: 0, arr: '23:55', dep: '23:55', day: 0 },
      { code: 'NDLS', km: 492, arr: '06:45', dep: '06:45', day: 1 },
    ],
  },
  {
    number: '12004', name: 'Lucknow Shatabdi Express', runsOn: [1, 2, 3, 4, 5, 6],
    classes: ['CC'],
    stops: [
      { code: 'LKO', km: 0, arr: '08:10', dep: '08:10', day: 0 },
      { code: 'CNB', km: 89, arr: '09:45', dep: '09:50', day: 0 },
      { code: 'NDLS', km: 492, arr: '13:45', dep: '13:45', day: 0 },
    ],
  },
  {
    number: '15120', name: 'Lucknow Delhi Express', runsOn: DAILY,
    classes: ['SL', '3A', '2S'],
    stops: [
      { code: 'LKO', km: 0, arr: '21:10', dep: '21:10', day: 0 },
      { code: 'NDLS', km: 492, arr: '04:50', dep: '04:50', day: 1 },
    ],
  },
  // CNB to NDLS legs.
  {
    number: '12616', name: 'Grand Trunk Express', runsOn: DAILY,
    classes: ['SL', '3A', '2A'],
    stops: [
      { code: 'CNB', km: 0, arr: '03:45', dep: '03:45', day: 0 },
      { code: 'NDLS', km: 403, arr: '10:15', dep: '10:15', day: 0 },
    ],
  },
  {
    number: '12002', name: 'Bhopal Shatabdi Express', runsOn: DAILY,
    classes: ['CC'],
    stops: [
      { code: 'CNB', km: 0, arr: '00:45', dep: '00:45', day: 0 },
      { code: 'NDLS', km: 403, arr: '05:20', dep: '05:20', day: 0 },
    ],
  },
  // GKP to BSB legs.
  {
    number: '15046', name: 'Gorakhpur Varanasi Intercity', runsOn: DAILY,
    classes: ['CC', '2S'],
    stops: [
      { code: 'GKP', km: 0, arr: '06:00', dep: '06:00', day: 0 },
      { code: 'BSB', km: 233, arr: '10:05', dep: '10:05', day: 0 },
    ],
  },
  {
    number: '15002', name: 'Gorakhpur Varanasi Express', runsOn: DAILY,
    classes: ['SL', '3A'],
    stops: [
      { code: 'GKP', km: 0, arr: '17:30', dep: '17:30', day: 0 },
      { code: 'BSB', km: 233, arr: '22:20', dep: '22:20', day: 0 },
    ],
  },
];
