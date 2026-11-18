import type { Page, Route } from '@playwright/test';

/**
 * The whole suite pretends it is 08:00 IST on the day it runs. The browser
 * clock is installed at that instant and the fixture wall times are computed
 * from the same pinned "now", so a late-evening run cannot wrap fixture
 * departures past midnight into the already-departed window (which zeroed the
 * results page at ~22:00 IST).
 */
const PINNED_SHIFTED = (() => {
  const ist = Date.now() + 19_800_000;
  return Math.floor(ist / 86_400_000) * 86_400_000 + 8 * 3_600_000;
})();

/**
 * B5: the browser no longer calls ConfirmTkt or erail; it calls the
 * RailVaani API. Every spec therefore stubs the app's own three endpoints
 * (request interception, no fixture server), so CI never needs live data.
 * Fixture train times are computed from the pinned IST clock, so the trains
 * are never already departed and the today-only notice path is reachable at
 * any hour the suite runs.
 */

/** IST is UTC+5:30 with no DST, so shifting the epoch gives IST wall time.
 *  Helpers compute against the pinned clock, never the real one. */
function istNow(): number {
  return PINNED_SHIFTED;
}

export function istDate(offsetDays = 0): string {
  return new Date(istNow() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** IST wall clock HH:MM, minutes from now. */
export function istClock(minsFromNow: number): string {
  const d = new Date(istNow() + minsFromNow * 60_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** The API's snapshot stamp; the UI shows it as each figure's snapshot time. */
const SNAPSHOT = '2026-11-17T10:05:00';

interface AvailSpec {
  state: string;
  count: number;
  wlPrefix?: string;
}

function av(a: AvailSpec) {
  return { ...a, asOf: SNAPSHOT };
}

interface LegSpec {
  no: string;
  name: string;
  from: string;
  to: string;
  dep: string;
  arr: string;
  fare: number;
  cls: string;
  availability: AvailSpec;
  classes?: Array<{ cls: string; fare: number; availability: AvailSpec }>;
}

function leg(s: LegSpec, date: string) {
  return {
    trainNumber: s.no,
    trainName: s.name,
    from: s.from,
    to: s.to,
    date,
    depTime: s.dep,
    arrTime: s.arr,
    fare: s.fare,
    availability: av(s.availability),
    cls: s.cls,
    ...(s.classes
      ? { perClass: s.classes.map((c) => ({ cls: c.cls, fare: c.fare, availability: av(c.availability) })) }
      : {}),
  };
}

/** One direct card carries all four chip tones; two leg trains make one split
 *  via LKO (leg 2 departs 105 minutes after leg 1 arrives, on the waitlist so
 *  the split-leg stamp shows the W2.1 violet). */
function searchFixture(from: string, to: string, date: string) {
  if (from !== 'GKP' || to !== 'NDLS') {
    return { options: [], fetchedAt: new Date(istNow()).toISOString() };
  }
  const direct1 = {
    type: 'direct',
    legs: [
      leg(
        {
          no: '12555', name: 'Gorakhdham Express', from: 'GKP', to: 'NDLS',
          dep: istClock(150), arr: istClock(930), fare: 235, cls: 'SL',
          availability: { state: 'AVAILABLE', count: 122 },
          classes: [
            { cls: 'SL', fare: 235, availability: { state: 'AVAILABLE', count: 122 } },
            { cls: '3A', fare: 625, availability: { state: 'WL', count: 12, wlPrefix: 'GNWL' } },
            { cls: '2A', fare: 890, availability: { state: 'RAC', count: 4 } },
            { cls: '1A', fare: 1520, availability: { state: 'REGRET', count: 0 } },
          ],
        },
        date,
      ),
    ],
    totalFare: 235,
    totalDurationMins: 780,
    withinBudget: true,
    bookable: true,
    needsWaitlist: false,
    explanation: '12555 Gorakhdham Express direct, Rs 235',
  };
  const direct2 = {
    type: 'direct',
    legs: [
      leg(
        {
          no: '12561', name: 'Gorakhpur Intercity', from: 'GKP', to: 'NDLS',
          dep: istClock(240), arr: istClock(660), fare: 255, cls: 'SL',
          availability: { state: 'AVAILABLE', count: 30 },
          classes: [{ cls: 'SL', fare: 255, availability: { state: 'AVAILABLE', count: 30 } }],
        },
        date,
      ),
    ],
    totalFare: 255,
    totalDurationMins: 420,
    withinBudget: true,
    bookable: true,
    needsWaitlist: false,
    explanation: '12561 Gorakhpur Intercity direct, Rs 255',
  };
  const direct3 = {
    type: 'direct',
    legs: [
      leg(
        {
          no: '12565', name: 'Gorakhpur Fast', from: 'GKP', to: 'NDLS',
          dep: istClock(390), arr: istClock(840), fare: 225, cls: 'SL',
          availability: { state: 'WL', count: 8, wlPrefix: 'GNWL' },
          classes: [{ cls: 'SL', fare: 225, availability: { state: 'WL', count: 8, wlPrefix: 'GNWL' } }],
        },
        date,
      ),
    ],
    totalFare: 225,
    totalDurationMins: 450,
    withinBudget: true,
    bookable: false,
    needsWaitlist: true,
    explanation: '12565 Gorakhpur Fast direct, Rs 225',
  };
  const split = {
    type: 'split',
    hub: 'LKO',
    connectionMins: 105,
    legs: [
      leg(
        {
          no: '15008', name: 'Gorakhpur Passenger', from: 'GKP', to: 'LKO',
          dep: istClock(120), arr: istClock(390), fare: 135, cls: 'SL',
          availability: { state: 'AVAILABLE', count: 40 },
          classes: [{ cls: 'SL', fare: 135, availability: { state: 'AVAILABLE', count: 40 } }],
        },
        date,
      ),
      leg(
        {
          no: '12533', name: 'Lucknow Express', from: 'LKO', to: 'NDLS',
          dep: istClock(495), arr: istClock(855), fare: 245, cls: 'SL',
          availability: { state: 'WL', count: 6, wlPrefix: 'GNWL' },
          classes: [{ cls: 'SL', fare: 245, availability: { state: 'WL', count: 6, wlPrefix: 'GNWL' } }],
        },
        date,
      ),
    ],
    totalFare: 380,
    totalDurationMins: 735,
    withinBudget: true,
    bookable: false,
    needsWaitlist: true,
    explanation: 'Via LKO: 15008 GKP-LKO + 12533 LKO-NDLS, Rs 380, 1h 45m at LKO',
  };
  return {
    options: [direct1, direct2, direct3, split],
    fetchedAt: new Date(istNow()).toISOString(),
    // The API's city cluster: the header names the searched cities.
    expandedFrom: ['GKP', 'GKC'],
    expandedTo: ['NDLS', 'DLI', 'ANVT', 'NZM', 'SSB'],
    expandedFromCity: 'Gorakhpur',
    expandedToCity: 'Delhi',
    hiddenByBudget: 0,
  };
}

/** Per-class seat status per train, the same map for every date: the strip
 *  then reads identically on all six dates, as the live search cache did. */
const AVAILABILITY: Record<string, Record<string, unknown>> = {
  '12555': {
    SL: av({ state: 'AVAILABLE', count: 122 }),
    '3A': av({ state: 'WL', count: 12, wlPrefix: 'GNWL' }),
    '2A': av({ state: 'RAC', count: 4 }),
    '1A': av({ state: 'REGRET', count: 0 }),
  },
  '12561': { SL: av({ state: 'AVAILABLE', count: 30 }) },
  '12565': { SL: av({ state: 'WL', count: 8, wlPrefix: 'GNWL' }) },
  '15008': { SL: av({ state: 'AVAILABLE', count: 40 }) },
  '12533': { SL: av({ state: 'WL', count: 6, wlPrefix: 'GNWL' }) },
};

const FARES: Record<string, Record<string, number>> = {
  '12555': { SL: 235, '3A': 625, '2A': 890, '1A': 1520 },
  '12561': { SL: 255 },
  '12565': { SL: 225 },
  '15008': { SL: 135 },
  '12533': { SL: 245 },
};

/** Overrides a spec can pass to exercise the A1 failure paths. */
export interface ApiFixtureOverrides {
  /** /api/search answers this status instead of 200 (e.g. 429). */
  searchStatus?: number;
  /** The search response flags partial results. */
  partial?: boolean;
  /** The search returns zero options. */
  empty?: boolean;
}

/** Stubs the app's own API for one page. Register before any navigation. */
export async function installApiStubs(page: Page, overrides: ApiFixtureOverrides = {}): Promise<void> {
  await page.route('**/api/search**', async (route: Route) => {
    const u = new URL(route.request().url());
    if (overrides.searchStatus) {
      await route.fulfill({
        status: overrides.searchStatus,
        json: { error: { code: 'rate_limited', message: 'Too many searches right now.' } },
      });
      return;
    }
    const body = searchFixture(
      u.searchParams.get('from') ?? '',
      u.searchParams.get('to') ?? '',
      u.searchParams.get('date') ?? istDate(),
    );
    if (overrides.empty) body.options = [];
    if (overrides.partial) body['partial'] = true;
    await route.fulfill({ json: body });
  });
  await page.route('**/api/availability**', async (route: Route) => {
    const u = new URL(route.request().url());
    const no = u.searchParams.get('trainNo') ?? '';
    await route.fulfill({
      json: { availability: AVAILABILITY[no] ?? {}, fetchedAt: SNAPSHOT },
    });
  });
  await page.route('**/api/fare-table**', async (route: Route) => {
    const u = new URL(route.request().url());
    const no = u.searchParams.get('trainNo') ?? '';
    await route.fulfill({
      json: { fares: FARES[no] ?? {}, fetchedAt: SNAPSHOT },
    });
  });
}

/** The theme guard's entry point: the pinned clock plus the API stubs. */
export async function installFixtures(page: Page): Promise<void> {
  // Pin the page's clock to the same instant the fixture times come from.
  await page.clock.install({ time: new Date(PINNED_SHIFTED - 19_800_000) });
  await installApiStubs(page);
}
