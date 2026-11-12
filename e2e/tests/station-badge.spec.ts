import { expect, test } from '@playwright/test';

/** Mirror of StationsService.resolve over the stations.json rows. */
function resolve(rows: [string, string][], input: string): [string, string] | null {
  const upper = input.trim().toUpperCase();
  const lower = input.trim().toLowerCase();
  return (
    rows.find(([code]) => code.toUpperCase() === upper) ??
    rows.find(([, name]) => name.toLowerCase() === lower) ??
    rows.find(([, name]) => name.toLowerCase().includes(lower)) ??
    null
  );
}

test('example chip sets matching badges and swap moves them with the fields', async ({ page }) => {
  // The swap button is desktop-only; widen the viewport so it is clickable.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const rows = (await (await page.request.get('/stations.json')).json()) as [string, string][];
  const from = resolve(rows, 'Varanasi');
  const to = resolve(rows, 'Lucknow');
  expect(from).toBeTruthy();
  expect(to).toBeTruthy();
  const [fromCode, fromName] = from as [string, string];
  const [toCode, toName] = to as [string, string];

  await page.getByRole('button', { name: /Varanasi.*Lucknow/ }).click();

  const fromBox = page.locator('input#from');
  const toBox = page.locator('input#to');
  await expect(fromBox).toHaveValue(fromName);
  await expect(toBox).toHaveValue(toName);

  // The code badge is the span sibling of each field's input.
  const fromBadge = page.locator('input#from ~ span');
  const toBadge = page.locator('input#to ~ span');
  await expect(fromBadge).toHaveText(fromCode);
  await expect(toBadge).toHaveText(toCode);

  await page.getByRole('button', { name: 'Swap origin and destination' }).click();
  await expect(fromBox).toHaveValue(toName);
  await expect(toBox).toHaveValue(fromName);
  await expect(fromBadge).toHaveText(toCode);
  await expect(toBadge).toHaveText(fromCode);

  // Editing the text after a pick clears the badge with the code model.
  await fromBox.fill('Random place');
  await expect(fromBadge).toHaveCount(0);
});
