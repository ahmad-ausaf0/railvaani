import assert from 'node:assert/strict';
import test from 'node:test';

import { SplitOption } from '@railvaani/split-engine';

import { isStationChange, shortPlaceName, splitWaitLabel, stationChangeNote } from './split-notes';

const NAMES: Record<string, string> = {
  CNB: 'Kanpur Central',
  GOY: 'Govindpuri',
  GTNR: 'Gomti Nagar',
  LKO: 'Lucknow Junction',
};
const name = (c: string): string => NAMES[c] ?? c;

function splitOption(
  legs: [string, string][],
  hub: string,
  connectionMins = 150,
): SplitOption {
  return {
    type: 'split',
    legs: legs.map(([from, to]) => ({
      trainNumber: 'T',
      trainName: 'T',
      from,
      to,
      date: '2026-11-20',
      depTime: '06:00',
      arrTime: '10:00',
      fare: 450,
      availability: { state: 'AVAILABLE', count: 10 },
    })),
    hub,
    connectionMins,
    totalFare: 900,
    totalDurationMins: 600,
    withinBudget: true,
    bookable: true,
    needsWaitlist: false,
    explanation: '',
  };
}

test('same-station split: wait names the real station, no change note', () => {
  const o = splitOption([['AAA', 'CNB'], ['CNB', 'BBB']], 'CNB');
  assert.equal(isStationChange(o), false);
  assert.equal(stationChangeNote(o, 'Kanpur Central', name), null);
  assert.equal(splitWaitLabel(o, 'Kanpur Central', name, (m) => `${m}m`), '150m wait at Kanpur Central');
});

test('cross-station split: plain change note, wait never names a station', () => {
  const o = splitOption([['AAA', 'CNB'], ['GOY', 'BBB']], 'CNB');
  assert.equal(isStationChange(o), true);
  assert.equal(stationChangeNote(o, 'Kanpur Central', name), 'Change stations in Kanpur: Kanpur Central → Govindpuri');
  assert.equal(splitWaitLabel(o, 'Kanpur Central', name, (m) => `${m}m`), '150m wait');
});

test('change note works without a hub name, from the arrival station', () => {
  const o = splitOption([['AAA', 'CNB'], ['GOY', 'BBB']], 'CNB');
  assert.equal(stationChangeNote(o, '', name), 'Change stations in Kanpur: Kanpur Central → Govindpuri');
});

test('railway suffixes strip for the place name, ordinary names stand', () => {
  assert.equal(shortPlaceName('Kanpur Central'), 'Kanpur');
  assert.equal(shortPlaceName('Lucknow Junction'), 'Lucknow');
  assert.equal(shortPlaceName('Agra Cantt'), 'Agra');
  assert.equal(shortPlaceName('Gonda Jn'), 'Gonda');
  assert.equal(shortPlaceName('Govindpuri'), 'Govindpuri');
  assert.equal(shortPlaceName('Bhusaval'), 'Bhusaval');
});

test('no wait, or not a split: no labels at all', () => {
  const o = splitOption([['AAA', 'CNB'], ['CNB', 'BBB']], 'CNB', 0);
  assert.equal(splitWaitLabel(o, 'Kanpur', name, (m) => `${m}m`), '');
  const direct: SplitOption = {
    ...splitOption([['AAA', 'CNB']], 'CNB'),
    type: 'direct',
    hub: undefined,
  };
  assert.equal(isStationChange(direct), false);
  assert.equal(stationChangeNote(direct, 'Kanpur', name), null);
});
