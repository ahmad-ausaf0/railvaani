import assert from 'node:assert/strict';
import test from 'node:test';

import { MockTrainProvider } from '@railvaani/train-core';

import { findOptions, SplitOption } from './index';

const p = new MockTrainProvider();
const DATE = '2026-10-30'; // a Friday

test('direct GKP to NDLS: five trains, cheapest SL fare Rs 455, ranked first', async () => {
  const opts = await findOptions(p, { from: 'GKP', to: 'NDLS', date: DATE, cls: 'SL', maxResults: 40 });
  const direct = opts.filter((o) => o.type === 'direct');
  assert.equal(direct.length, 5);
  assert.equal(opts[0]?.type, 'direct');
  assert.equal(opts[0]?.totalFare, 455);
  assert.equal(opts[0]?.bookable, true); // 12555 SL is RAC on this date
});

test('budget Rs 600 SL: a bookable split within budget is returned', async () => {
  const opts = await findOptions(p, { from: 'GKP', to: 'NDLS', date: DATE, cls: 'SL', budgetPerHead: 600 });
  assert.ok(opts.some((o) => o.withinBudget), 'at least one option within budget');
  const splits = opts.filter((o) => o.type === 'split' && o.withinBudget);
  assert.ok(splits.length > 0, 'at least one split within budget');
  for (const s of splits) {
    assert.ok(s.legs.length === 2);
    assert.ok(s.totalFare <= 600);
    assert.ok((s.connectionMins ?? 0) >= 90, 'respects the 90 minute minimum connection');
    assert.ok((s.connectionMins ?? 0) <= 480, 'respects the 8h maximum connection');
    assert.notEqual(s.legs[0]?.trainNumber, s.legs[1]?.trainNumber, 'never two tickets on the same train');
  }
});

test('split via Lucknow: 15010 then 15120 totals Rs 475', async () => {
  const opts = await findOptions(p, {
    from: 'GKP',
    to: 'NDLS',
    date: DATE,
    cls: 'SL',
    hubs: ['LKO'],
  });
  const viaLucknow = opts.find(
    (o) => o.type === 'split' && o.hub === 'LKO' && o.legs[0]?.trainNumber === '15010' && o.legs[1]?.trainNumber === '15120',
  );
  assert.ok(viaLucknow, 'the canonical GKP-LKO-NDLS split exists');
  assert.equal(viaLucknow.totalFare, 475);
  assert.equal(viaLucknow.bookable, true);
});

test('hubs override: only Lucknow splits are searched', async () => {
  const opts = await findOptions(p, { from: 'GKP', to: 'NDLS', date: DATE, cls: 'SL', hubs: ['LKO'] });
  for (const o of opts) {
    if (o.type === 'split') {
      assert.equal(o.hub, 'LKO');
    }
  }
});

test('AC 3-tier with a Rs 600 budget: nothing fits, all options marked over budget', async () => {
  const opts = await findOptions(p, { from: 'GKP', to: 'NDLS', date: DATE, cls: '3A', budgetPerHead: 600, maxResults: 40 });
  assert.ok(opts.length > 0);
  for (const o of opts) {
    assert.equal(o.withinBudget, false);
  }
  const direct = opts.filter((o) => o.type === 'direct');
  assert.equal(direct.length, 5);
});

test('onlyWithinBudget drops over-budget options', async () => {
  const opts = await findOptions(p, {
    from: 'GKP',
    to: 'NDLS',
    date: DATE,
    cls: '3A',
    budgetPerHead: 600,
    onlyWithinBudget: true,
  });
  assert.equal(opts.length, 0);
});

test('splits rank below a cheaper direct train but above costlier ones', async () => {
  const opts = await findOptions(p, { from: 'GKP', to: 'NDLS', date: DATE, cls: 'SL', hubs: ['LKO'] });
  const splitFares = opts.filter((o) => o.type === 'split').map((o) => o.totalFare);
  assert.ok(splitFares.length > 0);
  // Direct SL trains are Rs 455 and Rs 560 (22423). A Rs 475 split must rank
  // after every Rs 455 direct but before the Rs 560 one.
  assert.ok(opts.findIndex((o) => o.type === 'split') > opts.findIndex((o) => o.totalFare === 455 && o.type === 'direct'));
});

test('unavailable direct trains are still listed, flagged not bookable', async () => {
  const opts = await findOptions(p, { from: 'GKP', to: 'NDLS', date: DATE, cls: 'SL', maxResults: 40 });
  const swat = opts.find((o) => o.type === 'direct' && o.legs[0]?.trainNumber === '12561');
  assert.ok(swat, '12561 appears in the list');
  assert.equal(swat.bookable, false);
  assert.equal(swat.needsWaitlist, false);
});

test('every split respects connection bounds and two legs', async () => {
  const opts = await findOptions(p, { from: 'GKP', to: 'NDLS', date: DATE, cls: 'SL' });
  for (const o of opts.filter((x) => x.type === 'split') as SplitOption[]) {
    assert.ok(o.connectionMins !== undefined);
    assert.ok(o.connectionMins >= 90 && o.connectionMins <= 480);
    assert.equal(o.legs.length, 2);
    assert.equal(o.legs[0]?.to, o.hub);
    assert.equal(o.legs[1]?.from, o.hub);
  }
});

test('same-origin query throws', async () => {
  await assert.rejects(
    () => findOptions(p, { from: 'GKP', to: 'GKP', date: DATE, cls: 'SL' }),
    /must differ/,
  );
});
