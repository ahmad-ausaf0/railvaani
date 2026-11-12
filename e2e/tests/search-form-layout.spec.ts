import { expect, test } from '@playwright/test';

test('swap button is visible and usable on mobile', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const swap = page.locator('button[aria-label="Swap origin and destination"]');
  await expect(swap).toBeVisible();

  await page.getByRole('button', { name: /Varanasi.*Lucknow/ }).click();
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

test('From and To share a row on desktop, date and class beside each other', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/', { waitUntil: 'networkidle' });
  const rows = await page.evaluate(() => {
    const y = (sel: string) => Math.round(document.querySelector(sel)?.getBoundingClientRect().top ?? -1);
    return { from: y('input#from'), to: y('input#to'), date: y('#date'), cls: y('#cls'), budget: y('#budget') };
  });
  expect(Math.abs(rows.from - rows.to)).toBeLessThanOrEqual(4);
  expect(Math.abs(rows.date - rows.cls)).toBeLessThanOrEqual(4);
  expect(rows.budget).toBeGreaterThan(rows.date);
});
