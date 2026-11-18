import { expect, test } from '@playwright/test';

import { installApiStubs } from './theme-fixtures';

test('swap button is visible and usable on mobile', async ({ page }) => {
  await installApiStubs(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  const swap = page.locator('button[aria-label="Swap origin and destination"]');
  await expect(swap).toBeVisible();

  // The chip submits and lands on /results; Back restores the filled form.
  await page.getByRole('button', { name: /Varanasi.*Lucknow/ }).click();
  await expect(page).toHaveURL(/\/results\?/);
  await page.goBack();
  const from = page.locator('input#from');
  const to = page.locator('input#to');
  await expect(from).toHaveValue('Varanasi City');
  await expect(to).toHaveValue('Lucknow');
  await swap.click();
  await expect(from).toHaveValue('Lucknow');
  await expect(to).toHaveValue('Varanasi City');

  const [scrollW, innerW] = await page.evaluate(() =>
    [document.documentElement.scrollWidth, window.innerWidth] as const);
  expect(scrollW).toBeLessThanOrEqual(innerW + 1);
});

test('From and To share a row on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/', { waitUntil: 'networkidle' });
  const rows = await page.evaluate(() => {
    const y = (sel: string) => Math.round(document.querySelector(sel)?.getBoundingClientRect().top ?? -1);
    return { from: y('input#from'), to: y('input#to'), date: y('#date'), budget: y('#budget') };
  });
  expect(Math.abs(rows.from - rows.to)).toBeLessThanOrEqual(4);
  // Date and Budget sit side by side beneath the From/To row.
  expect(Math.abs(rows.budget - rows.date)).toBeLessThanOrEqual(4);
});

test('clean theme is applied: tokens, system font, approved gradients only', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  // Page background is the clean off-white from --bg (#FAFAF8).
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(250, 250, 248)');

  // Theme colour matches the page background; no webfont is loaded, the
  // interface renders in the system sans stack.
  expect(await page.getAttribute('meta[name="theme-color"]', 'content')).toBe('#FAFAF8');
  const font = await page.evaluate(() => getComputedStyle(document.querySelector('main') as Element).fontFamily);
  expect(font).not.toContain('Mukta');
  expect(font).not.toContain('Rozha');

  // One gradient, used only on the logo tile, the voice disc, the hero's
  // gradient line, the split-card banner bar, and the split section's
  // gradient label and underline bar (approved mockup v3, W2).
  const offenders = await page.evaluate(() =>
    Array.from(document.querySelectorAll('body, body *'))
      .filter((el) => /gradient/.test(getComputedStyle(el).backgroundImage))
      .map((el) => String(el.className))
      .filter((cls) =>
        !/rv-logo|rv-voice-disc|rv-hero-grad|rv-grad-bar|rv-grad-label|rv-grad-underline/.test(cls)),
  );
  expect(offenders).toEqual([]);
});
