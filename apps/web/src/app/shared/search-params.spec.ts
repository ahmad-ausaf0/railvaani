import { test } from 'node:test';
import assert from 'node:assert/strict';

import { istToday, parseSearchParams } from './search-params';
import { isSelectableClass } from './train-classes';

const today = '2026-11-13';

test('parses a full valid search', () => {
  assert.deepEqual(parseSearchParams(
    { from: 'GKP', to: 'NDLS', date: '2026-11-14', cls: 'SL', quota: 'GN', budget: '600' },
    today,
  ), { from: 'GKP', to: 'NDLS', date: '2026-11-14', cls: 'SL', quota: 'GN', budget: 600 });
});

test('normalises lowercase codes', () => {
  const p = parseSearchParams({ from: 'gkp', to: 'ndls', date: '2026-11-14', cls: 'sl' }, today);
  assert.equal(p?.from, 'GKP');
  assert.equal(p?.to, 'NDLS');
  assert.equal(p?.cls, 'SL');
});

test('defaults the quota to GN when missing', () => {
  const p = parseSearchParams({ from: 'GKP', to: 'NDLS', date: '2026-11-14', cls: '3A' }, today);
  assert.equal(p?.quota, 'GN');
  assert.equal(p?.budget, undefined);
});

test('treats an empty budget as unset', () => {
  const p = parseSearchParams(
    { from: 'GKP', to: 'NDLS', date: '2026-11-14', cls: 'SL', budget: '' },
    today,
  );
  assert.equal(p?.budget, undefined);
});

test('rejects a missing From', () => {
  assert.equal(parseSearchParams({ to: 'NDLS', date: '2026-11-14', cls: 'SL' }, today), null);
});

test('rejects identical endpoints', () => {
  assert.equal(parseSearchParams(
    { from: 'NDLS', to: 'NDLS', date: '2026-11-14', cls: 'SL' },
    today,
  ), null);
});

test('rejects a malformed date', () => {
  assert.equal(parseSearchParams(
    { from: 'GKP', to: 'NDLS', date: '14/11/2026', cls: 'SL' },
    today,
  ), null);
});

test('rejects a past date', () => {
  assert.equal(parseSearchParams(
    { from: 'GKP', to: 'NDLS', date: '2026-11-12', cls: 'SL' },
    today,
  ), null);
});

test('accepts today (same-day journeys are allowed), rejects yesterday', () => {
  assert.ok(parseSearchParams(
    { from: 'GKP', to: 'NDLS', date: today, cls: 'SL' },
    today,
  ));
  assert.equal(parseSearchParams(
    { from: 'GKP', to: 'NDLS', date: '2026-11-12', cls: 'SL' },
    today,
  ), null);
});

test('rejects an unknown class', () => {
  assert.equal(parseSearchParams(
    { from: 'GKP', to: 'NDLS', date: '2026-11-14', cls: 'XX' },
    today,
  ), null);
});

test('rejects a non-numeric budget', () => {
  assert.equal(parseSearchParams(
    { from: 'GKP', to: 'NDLS', date: '2026-11-14', cls: 'SL', budget: 'lots' },
    today,
  ), null);
});

test('istToday returns a YYYY-MM-DD date', () => {
  assert.match(istToday(), /^\d{4}-\d{2}-\d{2}$/);
});

test('accepts cls=ANY for Any-class searches', () => {
  const p = parseSearchParams({ from: 'NDLS', to: 'CNB', date: '2026-12-01', cls: 'ANY' }, today);
  assert.ok(p);
  assert.equal(p!.cls, 'ANY');
});

test('Any class round-trips through the URL and Edit search', () => {
  assert.equal(isSelectableClass('ANY'), true);
  const p = parseSearchParams({ from: 'NDLS', to: 'CNB', date: '2026-12-01', cls: 'ANY' }, today);
  assert.ok(p);
  assert.equal(isSelectableClass(p!.cls), true, 'the parsed class re-validates for the form and the URL');
  assert.equal(isSelectableClass('XL'), false, 'unknown classes still rejected');
});
