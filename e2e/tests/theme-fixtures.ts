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
 * W2 theme guard, run against deterministic provider fixtures so the
 * presentation assertions never depend on live upstreams. The search runs in
 * the browser against ConfirmTkt (JSON) and erail (text, via a relay); both
 * are intercepted here. Fixture train times are computed from the current IST
 * clock, so the trains are never already departed and the today-only notice
 * path is reachable at any hour the suite runs.
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

interface CtClass {
  availability: string;
  fare: number;
  cacheTime: string;
}

/** ConfirmTkt's own cache stamp; the UI shows it as the snapshot time. */
const SNAPSHOT = '2026-11-17T10:05:00';

function cls(availability: string, fare: number): CtClass {
  return { availability, fare, cacheTime: SNAPSHOT };
}

function ctTrain(
  no: string,
  name: string,
  from: string,
  to: string,
  dep: string,
  arr: string,
  duration: number,
  classes: Record<string, CtClass>,
) {
  return {
    trainNumber: no,
    trainName: name,
    fromStnCode: from,
    toStnCode: to,
    departureTime: dep,
    arrivalTime: arr,
    duration,
    runningDays: '1111111',
    avlClasses: Object.keys(classes),
    availabilityCache: classes,
  };
}

/** One direct card carries all four chip tones; two leg trains make one split
 *  via LKO (leg 2 departs 105 minutes after leg 1 arrives, on the waitlist so
 *  the split-leg stamp shows the W2.1 violet). */
function trainListFixture(from: string, to: string): unknown {
  const key = `${from}|${to}`;
  if (key === 'GKP|NDLS') {
    return {
      data: {
        trainList: [
          ctTrain('12555', 'Gorakhdham Express', 'GKP', 'NDLS', istClock(150), istClock(930), 780, {
            SL: cls('AVAILABLE 122', 235),
            '3A': cls('GNWL12', 625),
            '2A': cls('RAC 4', 890),
            '1A': cls('REGRET', 1520),
          }),
          ctTrain('12561', 'Gorakhpur Intercity', 'GKP', 'NDLS', istClock(240), istClock(660), 420, {
            SL: cls('AVAILABLE 30', 255),
          }),
          ctTrain('12565', 'Gorakhpur Fast', 'GKP', 'NDLS', istClock(390), istClock(840), 450, {
            SL: cls('GNWL8', 225),
          }),
        ],
      },
    };
  }
  if (key === 'GKP|LKO') {
    return {
      data: {
        trainList: [
          ctTrain('15008', 'Gorakhpur Passenger', 'GKP', 'LKO', istClock(120), istClock(390), 270, {
            SL: cls('AVAILABLE 40', 135),
          }),
        ],
      },
    };
  }
  if (key === 'LKO|NDLS') {
    return {
      data: {
        trainList: [
          ctTrain('12533', 'Lucknow Express', 'LKO', 'NDLS', istClock(495), istClock(855), 360, {
            SL: cls('GNWL6', 245),
          }),
        ],
      },
    };
  }
  return { data: { trainList: [] } };
}

/** erail's Alternate (via suggestions) answer: Lucknow as the only hub. */
const HUB_BODY = 'header~a^Lucknow^LKO';

/** erail's TRAINROUTE answer, dot-clock times as the provider expects. */
const ROUTE_BODY = [
  'header',
  'j~GKP~Gorakhpur~First~09.00~j~0~1',
  'j~LKO~Lucknow~13.30~13.40~j~270~1',
  'j~NDLS~New Delhi~21.30~Last~j~760~1',
].join('^');

/** erail's train-number lookup: the route id sits at field 33. */
function routeIdBody(trainNo: string): string {
  const fields: string[] = [trainNo, ...Array<string>(32).fill('j'), '12345'];
  return `header~${fields.join('~')}`;
}

export async function installFixtures(page: Page): Promise<void> {
  // Pin the page's clock to the same instant the fixture times come from.
  await page.clock.install({ time: new Date(PINNED_SHIFTED - 19_800_000) });
  await page.route('**/api/v1/trains/search*', async (route: Route) => {
    const u = new URL(route.request().url());
    const body = trainListFixture(
      u.searchParams.get('sourceStationCode') ?? '',
      u.searchParams.get('destinationStationCode') ?? '',
    );
    await route.fulfill({ json: body });
  });
  await page.route('**/data.aspx*', async (route: Route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.get('Action') === 'Alternate') {
      await route.fulfill({ contentType: 'text/plain', body: HUB_BODY });
    } else if (u.searchParams.get('Action') === 'TRAINROUTE') {
      await route.fulfill({ contentType: 'text/plain', body: ROUTE_BODY });
    } else {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
    }
  });
  await page.route('**/getTrains.aspx*', async (route: Route) => {
    const u = new URL(route.request().url());
    const no = (u.searchParams.get('TrainNo') ?? '').trim();
    if (no) {
      await route.fulfill({ contentType: 'text/plain', body: routeIdBody(no) });
    } else {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
    }
  });
}

/** Computed styles of one element, read with getPropertyValue. */
async function styleOf(locator: Locator, props: string[]): Promise<Record<string, string>> {
  return locator.evaluate((el, ps) => {
    const cs = getComputedStyle(el);
    const out: Record<string, string> = {};
    for (const p of ps) out[p] = String(cs.getPropertyValue(p));
    return out;
  }, props);
}

