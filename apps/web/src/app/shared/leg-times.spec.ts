import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addDaysISO,
  arrDayDelta,
  fmtDuration,
  fmtShortDate,
  legDurationMins,
  splitTotalMins,
} from './leg-times';

test('overnight leg renders the next day and its duration', () => {
  // Dep Sat 22:40, arr 06:15 the next morning.
  assert.equal(arrDayDelta('22:40', '06:15'), 1);
  assert.equal(fmtShortDate(addDaysISO('2026-11-14', arrDayDelta('22:40', '06:15'))), 'Sun 15 Nov');
  assert.equal(legDurationMins('22:40', '06:15'), 455);
  assert.equal(fmtDuration(455), '7h 35m');
});

test('same-day leg renders the same date twice', () => {
  assert.equal(arrDayDelta('07:25', '18:30'), 0);
  assert.equal(fmtShortDate('2026-11-14'), 'Sat 14 Nov');
  assert.equal(fmtShortDate(addDaysISO('2026-11-14', arrDayDelta('07:25', '18:30'))), 'Sat 14 Nov');
});

test('split total equals leg durations plus the wait (two legs)', () => {
  // Leg 1 GKP to MB 15:35 to 04:07 (+1 day), 2h 18m wait at MB,
  // leg 2 MB to DELHI 06:25 to 10:33.
  const legs = [
    { depTime: '15:35', arrTime: '04:07' },
    { depTime: '06:25', arrTime: '10:33' },
  ];
  const wait = 2 * 60 + 18;
  const leg1 = legDurationMins('15:35', '04:07');
  const leg2 = legDurationMins('06:25', '10:33');
  assert.equal(leg1, 752);
  assert.equal(leg2, 248);
  assert.equal(splitTotalMins(legs, wait), leg1 + wait + leg2);
  assert.equal(splitTotalMins(legs, wait), 1138);
  assert.equal(fmtDuration(1138), '18h 58m');
});

test('durations format with padded minutes and bare minutes under an hour', () => {
  assert.equal(fmtDuration(665), '11h 05m');
  assert.equal(fmtDuration(45), '45m');
  assert.equal(fmtDuration(180), '3h');
  assert.equal(fmtDuration(0), '0m');
});

test('dates format across a month boundary and reject junk', () => {
  assert.equal(fmtShortDate(addDaysISO('2026-11-30', 1)), 'Tue 1 Dec');
  assert.equal(fmtShortDate('not-a-date'), '');
  assert.equal(addDaysISO('not-a-date', 1), '');
});
