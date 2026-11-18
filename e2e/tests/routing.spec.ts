import { expect, test } from '@playwright/test';

import { installApiStubs } from './theme-fixtures';

/** Tomorrow's date, so the deep-linked search always lands in the bookable future. */
function tomorrow(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

test('submitting a class-free search runs all classes and renders cards', async ({ page }) => {
  test.setTimeout(120_000);
  await installApiStubs(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });

  await page.getByRole('button', { name: 'Gorakhpur → New Delhi' }).click();

  await expect(page).toHaveURL(/\/results\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get('from')).toBe('GKP');
  expect(url.searchParams.get('to')).toBe('NDLS');
  // Class-free: the submit URL carries no cls; every search runs all classes.
  expect(url.searchParams.get('cls')).toBeNull();
  expect(url.searchParams.get('quota')).toBe('GN');
  expect(url.searchParams.get('date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(url.searchParams.get('budget')).toBeNull();

  // Cards render as soon as options arrive, well before class details finish.
  await expect(page.locator('h2')).toContainText(/options/, { timeout: 90_000 });
  await expect(page.locator('rv-option-card').first()).toBeVisible();
  // The summary bar names the all-classes search.
  await expect(page.locator('.rv-card p[role="status"]').first()).toContainText('All classes');
  // B5: the API's city cluster widens the search; the header says which city.
  await expect(page.getByText('Searched all Gorakhpur and Delhi stations')).toBeVisible();
});

test('Back returns to the search form with the fields filled', async ({ page }) => {
  test.setTimeout(120_000);
  await installApiStubs(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });

  await page.getByRole('button', { name: 'Gorakhpur → New Delhi' }).click();
  await expect(page).toHaveURL(/\/results\?/);
  await expect(page.locator('h2')).toContainText(/options/, { timeout: 90_000 });

  await page.goBack();
  await expect(page).not.toHaveURL(/\/results/);
  await expect(page.locator('input#from')).toHaveValue('Gorakhpur');
  await expect(page.locator('input#to')).toHaveValue('New Delhi');
  await expect(page.locator('input#from ~ span')).toHaveText('GKP');
  await expect(page.locator('input#to ~ span')).toHaveText('NDLS');
});

test('a pasted /results URL loads results on its own', async ({ page }) => {
  test.setTimeout(120_000);
  await installApiStubs(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  // cls here is deliberate: an old saved link still works, treated as all classes.
  await page.goto(`/results?from=GKP&to=NDLS&date=${tomorrow()}&cls=SL&quota=GN`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(page.locator('h2')).toContainText(/options/, { timeout: 90_000 });
  await expect(page.locator('.rv-stamp').first()).toBeVisible();
});

test('a rate-limited search shows the 429 message with Retry', async ({ page }) => {
  await installApiStubs(page, { searchStatus: 429 });
  await page.goto(`/results?from=GKP&to=NDLS&date=${tomorrow()}&quota=GN`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('.rv-error')).toContainText(
    'Too many searches right now. Wait a few seconds and try again.',
  );
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('a partly failed search keeps the partial note', async ({ page }) => {
  await installApiStubs(page, { partial: true });
  await page.goto(`/results?from=GKP&to=NDLS&date=${tomorrow()}&quota=GN`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('h2')).toContainText(/options/, { timeout: 30_000 });
  await expect(page.getByText('Some options could not be checked.')).toBeVisible();
});
