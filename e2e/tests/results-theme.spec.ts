import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

/**
 * W2 theme guard, run against deterministic provider fixtures so the
 * presentation assertions never depend on live upstreams. The search runs in
 * the browser against ConfirmTkt (JSON) and erail (text, via a relay); both
 * are intercepted here. Fixture train times are computed from the current IST
 * clock, so the trains are never already departed and the today-only notice
 * path is reachable at any hour the suite runs.
 */

/** IST is UTC+5:30 with no DST, so shifting the epoch gives IST wall time. */
function istNow(): number {
  return Date.now() + 19_800_000;
}

function istDate(offsetDays = 0): string {
  return new Date(istNow() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** IST wall clock HH:MM, minutes from now. */
function istClock(minsFromNow: number): string {
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
 *  via LKO (leg 2 departs 105 minutes after leg 1 arrives). */
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
            SL: cls('AVAILABLE 12', 225),
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
            SL: cls('AVAILABLE 80', 245),
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

async function installFixtures(page: Page): Promise<void> {
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

const GRAD_ALLOWLIST =
  /rv-logo|rv-voice-disc|rv-hero-grad|rv-grad-bar|rv-grad-label|rv-grad-underline/;

test('results theme: summary card, notice, chip pairs, split banner, motion', async ({ page }) => {
  test.setTimeout(60_000);
  await installFixtures(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/results?from=GKP&to=NDLS&date=${istDate()}&quota=GN`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.locator('h2')).toContainText(/options/, { timeout: 30_000 });

  // 1. Summary card: route line on top, the meta line beneath, Edit search right.
  await expect(page.locator('.rv-summary-route')).toHaveText('Gorakhpur \u2192 New Delhi');
  await expect(page.locator('.rv-card p[role="status"]').first()).toContainText('All classes');
  await expect(page.getByRole('button', { name: 'Edit search' })).toBeVisible();

  // 2. Departed notice, today only: amber pair and the bold lead-in.
  const notice = page.locator('.rv-departed');
  await expect(notice).toContainText('Already departed:');
  await expect(notice).toContainText('are not shown.');
  const noticeStyle = await styleOf(notice, ['background-color', 'border-top-color', 'color']);
  expect(noticeStyle['background-color']).toBe('rgb(251, 240, 218)');
  expect(noticeStyle['border-top-color']).toBe('rgb(240, 223, 174)');
  expect(noticeStyle['color']).toBe('rgb(138, 90, 8)');

  // 3. Chip pairs: violet waitlist, green available unchanged.
  const wl = page.locator('.rv-class-chip.rv-avail-wl').first();
  const wlStyle = await styleOf(wl, ['background-color', 'color']);
  expect(wlStyle['background-color']).toBe('rgb(237, 233, 253)');
  expect(wlStyle['color']).toBe('rgb(90, 63, 214)');
  const okChip = page.locator('.rv-class-chip.rv-avail-ok').first();
  const okStyle = await styleOf(okChip, ['background-color', 'color']);
  expect(okStyle['background-color']).toBe('rgb(229, 244, 235)');
  expect(okStyle['color']).toBe('rgb(14, 122, 61)');

  // 6a. Split banner: solid ink, white text, the gradient bar directly beneath.
  const banner = page.locator('.rv-banner').first();
  const bannerStyle = await styleOf(banner, ['background-color', 'color']);
  expect(bannerStyle['background-color']).toBe('rgb(16, 20, 24)');
  expect(bannerStyle['color']).toBe('rgb(255, 255, 255)');
  expect(
    await page.evaluate(() => {
      const b = document.querySelector('.rv-banner');
      return Boolean(b && b.nextElementSibling && b.nextElementSibling.classList.contains('rv-grad-bar'));
    }),
  ).toBe(true);

  // 6b. Gradient label above the split section title, underline bar beneath it.
  await expect(page.locator('.rv-grad-label')).toContainText('RailVaani speciality');
  expect(
    await page.evaluate(() => {
      const bar = document.querySelector('.rv-grad-underline');
      if (!bar) return false;
      const cs = getComputedStyle(bar);
      return cs.width === '64px' && cs.height === '3px';
    }),
  ).toBe(true);

  // 6c. Split cards carry the deeper lift shadow by default.
  const splitShadow = await page.evaluate(
    () => getComputedStyle(document.querySelector('.rv-ticket-split') as Element).boxShadow,
  );
  expect(splitShadow).toContain('0.14');

  // 5. Float motion on rendered cards, staggered so no two share a phase.
  const delays = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.rv-ticket, .rv-ticket-split')).map(
      (el) => getComputedStyle(el).animationDelay,
    ),
  );
  expect(delays.length).toBeGreaterThanOrEqual(2);
  expect(new Set(delays).size).toBe(delays.length);
  const floatName = await page.evaluate(
    () => getComputedStyle(document.querySelector('.rv-ticket') as Element).animationName,
  );
  expect(floatName).toBe('rv-float');

  // Gradient discipline holds on the results page too.
  const offenders = await page.evaluate(
    (re) =>
      Array.from(document.querySelectorAll('body, body *'))
        .filter((el) => /gradient/.test(getComputedStyle(el).backgroundImage))
        .map((el) => String(el.className))
        .filter((c) => !re.test(c)),
    GRAD_ALLOWLIST,
  );
  expect(offenders).toEqual([]);
});

test('departed notice is hidden for a future date', async ({ page }) => {
  test.setTimeout(60_000);
  await installFixtures(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/results?from=GKP&to=NDLS&date=${istDate(1)}&quota=GN`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('h2')).toContainText(/options/, { timeout: 30_000 });
  await expect(page.locator('.rv-departed')).toHaveCount(0);
});

test('reduced motion turns the float off entirely', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installFixtures(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/results?from=GKP&to=NDLS&date=${istDate()}&quota=GN`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('h2')).toContainText(/options/, { timeout: 30_000 });
  const name = await page.evaluate(
    () => getComputedStyle(document.querySelector('.rv-ticket') as Element).animationName,
  );
  expect(name).toBe('none');
});
