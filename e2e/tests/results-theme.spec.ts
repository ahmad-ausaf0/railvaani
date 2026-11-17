import { expect, test, type Locator } from '@playwright/test';
import { installFixtures, istDate } from './theme-fixtures';

/**
 * W2/W2.1 theme guard, run against deterministic provider fixtures so the
 * presentation assertions never depend on live upstreams. Fixture times come
 * from the clock installFixtures pins (08:00 IST on the day the suite runs),
 * so every run is identical no matter what hour it executes at.
 */

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
  // W2.1: the waitlist violet reaches the stamps too. The stamp border rides
  // on currentColor, so the same violet rims it while the shape and tilt hold.
  const wlStamp = page.locator('.rv-stamp-wl').first();
  const stampStyle = await styleOf(wlStamp, ['color', 'border-bottom-color']);
  expect(stampStyle['color']).toBe('rgb(90, 63, 214)');
  expect(stampStyle['border-bottom-color']).toBe('rgb(90, 63, 214)');

  // W2.1: per-date strip WL dates go violet as well; RAC dates keep their tone.
  const wlDate = page.locator('.rv-date-wl').first();
  await expect(wlDate).toBeVisible({ timeout: 20_000 });
  const dateStyle = await styleOf(wlDate, ['color', 'border-top-color']);
  expect(dateStyle['color']).toBe('rgb(90, 63, 214)');
  expect(dateStyle['border-top-color']).toBe('rgb(90, 63, 214)');

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
