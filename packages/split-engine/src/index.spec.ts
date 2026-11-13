import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Availability,
  MockTrainProvider,
  Station,
  Stop,
  Train,
  TrainDataProvider,
} from '@railvaani/train-core';

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

/** SuggestHubs raises a raw network error, the way a failed fetch does. */
class HubSuggestionsThrow extends MockTrainProvider {
  suggestHubs(): Promise<string[]> {
    return Promise.reject(new TypeError('Failed to fetch'));
  }
}

/** getAvailability raises a raw network error, the way a failed fetch does. */
class AvailabilityThrow extends MockTrainProvider {
  async getAvailability(): Promise<Availability> {
    throw new TypeError('Failed to fetch');
  }
}

test('a provider whose hub suggestions fail still returns direct options', async () => {
  const opts = await findOptions(new HubSuggestionsThrow(), {
    from: 'GKP',
    to: 'NDLS',
    date: DATE,
    cls: 'SL',
    maxResults: 40,
  });
  const direct = opts.filter((o) => o.type === 'direct');
  assert.equal(direct.length, 5);
  assert.equal(opts.filter((o) => o.type === 'split').length, 0);
});

test('a provider whose availability check throws a network error still returns options with seats unchecked', async () => {
  const opts = await findOptions(new AvailabilityThrow(), {
    from: 'GKP',
    to: 'NDLS',
    date: DATE,
    cls: 'SL',
    maxResults: 40,
  });
  assert.ok(opts.length > 0);
  for (const o of opts) {
    for (const leg of o.legs) {
      assert.equal(leg.availability.state, 'NOT_AVAILABLE');
      assert.equal(leg.availability.count, 0);
    }
    assert.equal(o.bookable, false);
  }
});

/** Minimal provider over a fixed train list, for cap tests the seed cannot express. */
function makeCapProvider(directCount: number, hubCount: number): TrainDataProvider {
  const trains: Train[] = [];
  const hhmm = (mins: number): string =>
    `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  const toMins = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const ALL = [1, 2, 3, 4, 5, 6, 7];
  for (let i = 0; i < directCount; i += 1) {
    trains.push({
      number: `D${String(i).padStart(2, '0')}`,
      name: `Direct ${i}`,
      runsOn: ALL,
      from: 'GKP',
      to: 'NDLS',
      depTime: hhmm(300 + i * 10),
      arrTime: hhmm(300 + i * 10 + 600),
      durationMins: 600,
    });
  }
  for (let h = 0; h < hubCount; h += 1) {
    const hub = `H${h + 1}`;
    trains.push({
      number: `S${h + 1}A`,
      name: `Leg one ${h + 1}`,
      runsOn: ALL,
      from: 'GKP',
      to: hub,
      depTime: '06:00',
      arrTime: '10:00',
      durationMins: 240,
    });
    trains.push({
      number: `S${h + 1}B`,
      name: `Leg two ${h + 1}`,
      runsOn: ALL,
      from: hub,
      to: 'NDLS',
      depTime: '11:30',
      arrTime: '15:30',
      durationMins: 240,
    });
  }
  return {
    async searchTrains(from: string, to: string): Promise<Train[]> {
      return trains
        .filter((t) => t.from === from && t.to === to)
        .sort((a, b) => toMins(a.depTime) - toMins(b.depTime));
    },
    async getAvailability(): Promise<Availability> {
      return { state: 'AVAILABLE', count: 50 };
    },
    async getFare(): Promise<number> {
      return 450;
    },
    async getRoute(): Promise<Stop[]> {
      return [];
    },
    async searchStations(): Promise<Station[]> {
      return [];
    },
    async listStations(): Promise<Station[]> {
      return [];
    },
  };
}

test('per-type caps: three splits survive alongside fifteen directs', async () => {
  const p2 = makeCapProvider(15, 3);
  const opts = await findOptions(p2, {
    from: 'GKP',
    to: 'NDLS',
    date: DATE,
    cls: 'SL',
    hubs: ['H1', 'H2', 'H3'],
  });
  const directs = opts.filter((o) => o.type === 'direct');
  const splits = opts.filter((o) => o.type === 'split');
  assert.equal(directs.length, 15, 'all fifteen directs are returned');
  assert.equal(splits.length, 3, 'the splits are not crowded out by directs');
  assert.equal(opts.length, 18);
  assert.deepEqual(splits.map((o) => o.hub), ['H1', 'H2', 'H3']);
  assert.ok(opts.slice(0, 15).every((o) => o.type === 'direct'), 'directs still come first');
});

test('per-type caps: twenty-five directs return exactly twenty', async () => {
  const p2 = makeCapProvider(25, 0);
  const opts = await findOptions(p2, { from: 'GKP', to: 'NDLS', date: DATE, cls: 'SL', hubs: [] });
  assert.equal(opts.length, 20);
  assert.ok(opts.every((o) => o.type === 'direct'));
});
