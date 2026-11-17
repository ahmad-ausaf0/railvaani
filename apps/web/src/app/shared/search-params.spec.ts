import { test } from 'node:test';
import assert from 'node:assert/strict';

import { istToday, parseSearchParams } from './search-params';

const today = '2026-11-13';

test('parses a full valid search', () => {
  assert.deepEqual(parseSearchParams(
    { from: 'GKP', to: 'NDLS', date: '2026-11-14', quota: 'GN', budget: '600' },
    today,
  ), { from: 'GKP', to: 'NDLS', date: '2026-11-14', quota: 'GN', budget: 600 });
});

test('normalises lowercase codes', () => {
  const p = parseSearchParams({ from: 'gkp', to: 'ndls', date: '2026-11-14' }, today);
  assert.equal(p?.from, 'GKP');
  assert.equal(p?.to, 'NDLS');
});

test('defaults the quota to GN when missing', () => {
  const p = parseSearchParams({ from: 'GKP', to: 'NDLS', date: '2026-11-14' }, today);
  assert.equal(p?.quota, 'GN');
  assert.equal(p?.budget, undefined);
});

test('treats an empty budget as unset', () => {
  assert.equal(parseSearchParams(
    { from: 'GKP', to: 'NDLS', date: '2026-11-14', budget: '' },
    today,
  )?.budget, undefined);
});

test('rejects a missing From', () => {
  assert.equal(parseSearchParams({ to: 'NDLS', date: '2026-11-14' }, today), null);
});

test('rejects identical endpoints', () => {
  assert.equal(parseSearchParams({ from: 'NDLS', to: 'NDLS', date: '2026-11-14' }, today), null);
});

test('rejects a malformed date', () => {
  assert.equal(parseSearchParams({ from: 'GKP', to: 'NDLS', date: '14/11/2026' }, today), null);
});

test('rejects a past date', () => {
  assert.equal(parseSearchParams({ from: 'GKP', to: 'NDLS', date: '2026-11-12' }, today), null);
});

test('accepts today (same-day journeys are allowed), rejects yesterday', () => {
  assert.ok(parseSearchParams({ from: 'GKP', to: 'NDLS', date: today }, today));
  assert.equal(parseSearchParams({ from: 'GKP', to: 'NDLS', date: '2026-11-12' }, today), null);
});

test('rejects a non-numeric budget', () => {
  assert.equal(parseSearchParams(
    { from: 'GKP', to: 'NDLS', date: '2026-11-14', budget: 'lots' },
    today,
  ), null);
});

test('ignores a cls parameter left over in an old saved link', () => {
  // Class-free search: every search runs all classes. A cls param from an
  // old link must neither invalidate the search nor come back out.
  const p = parseSearchParams(
    { from: 'GKP', to: 'NDLS', date: '2026-11-14', cls: '3A' },
    today,
  );
  assert.ok(p);
  assert.equal('cls' in p, false);
});

test('an unknown cls in an old link does not invalidate the search either', () => {
  assert.ok(parseSearchParams(
    { from: 'GKP', to: 'NDLS', date: '2026-11-14', cls: 'XX' },
    today,
  ));
});

test('istToday returns a YYYY-MM-DD date', () => {
  assert.match(istToday(), /^\d{4}-\d{2}-\d{2}$/);
});
