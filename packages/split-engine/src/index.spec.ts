import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Availability,
  MockTrainProvider,
  ProviderError,
  SearchClass,
  Station,
  Stop,
  Train,
  TrainDataProvider,
  TrainClass,
} from '@railvaani/train-core';
import { stationCoord } from '@railvaani/train-core/station-coordinates';

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

/** A train shape the geo fixtures build legs from. `serves` models a provider
 *  that answers a hub query with a train boarding at a twin station. */
interface FakeTrain {
  number: string;
  from: string;
  to: string;
  depTime: string;
  durationMins: number;
  serves?: [string, string];
  /** Any-class mode fixtures: per-class fares and per-class seat status. */
  fares?: Partial<Record<TrainClass, number>>;
  availAll?: Partial<Record<string, Availability>>;
}

/** Provider over a fixed train list with call counters, for geo and
 *  shared-leg tests the seed cannot express. */
function makeGeoProvider(
  trains: FakeTrain[],
  opts: { hubs?: string[]; stations?: string[] } = {},
): { provider: TrainDataProvider; fareCalls: Map<string, number>; availCalls: Map<string, number> } {
  const ALL = [1, 2, 3, 4, 5, 6, 7];
  const toMins = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const hhmm = (mins: number): string =>
    `${String(Math.floor((mins % 1440) / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  const fareCalls = new Map<string, number>();
  const availCalls = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string): void => m.set(k, (m.get(k) ?? 0) + 1);
  const provider: TrainDataProvider = {
    async searchTrains(from: string, to: string): Promise<Train[]> {
      return trains
        .filter((t) => {
          const [servesFrom, servesTo] = t.serves ?? [t.from, t.to];
          return servesFrom === from && servesTo === to;
        })
        .map((t) => ({
          number: t.number,
          name: `Train ${t.number}`,
          runsOn: ALL,
          from: t.from,
          to: t.to,
          depTime: t.depTime,
          arrTime: hhmm(toMins(t.depTime) + t.durationMins),
          durationMins: t.durationMins,
        }))
        .sort((a, b) => toMins(a.depTime) - toMins(b.depTime));
    },
    async getAvailability(trainNo: string, from: string, to: string): Promise<Availability> {
      bump(availCalls, `${trainNo}|${from}|${to}`);
      return { state: 'AVAILABLE', count: 10 };
    },
    async getFare(trainNo: string, from: string, to: string): Promise<number> {
      bump(fareCalls, `${trainNo}|${from}|${to}`);
      return 450;
    },
    getFareTable(trainNo: string, from: string, to: string): Partial<Record<string, number>> {
      const t = trains.find((x) => {
        const [sf, st] = x.serves ?? [x.from, x.to];
        return x.number === trainNo && sf === from && st === to;
      });
      return t?.fares ?? {};
    },
    async getAvailabilityAll(trainNo: string): Promise<Partial<Record<string, Availability>>> {
      const t = trains.find((x) => x.number === trainNo);
      if (!t?.availAll) throw new ProviderError('no_seats', `no per-class data for ${trainNo}`);
      return t.availAll;
    },
    async getRoute(): Promise<Stop[]> {
      return [];
    },
    async searchStations(): Promise<Station[]> {
      return [];
    },
    async listStations(): Promise<Station[]> {
      return (opts.stations ?? []).map((c) => ({ code: c, name: `Stn ${c}`, zone: '', isJunction: true }));
    },
    ...(opts.hubs ? { suggestHubs: async (): Promise<string[]> => opts.hubs! } : {}),
  };
  return { provider, fareCalls, availCalls };
}

test('geo: backwards and over-detour hubs rejected, a forward extra hub added', async () => {
  // Siddharthnagar to Gaya has no direct trains. erail-style suggestions list
  // Kanpur (backwards, 9h) and a lateral detour station; both must be dropped
  // while Gorakhpur, 65 km towards Gaya, must be tried as a forward extra hub.
  assert.ok(stationCoord('SDDN') && stationCoord('GAYA'), 'fixture route has coordinates');
  const { provider } = makeGeoProvider(
    [
      { number: 'CNB1', from: 'SDDN', to: 'CNB', depTime: '06:00', durationMins: 560 },
      { number: 'CNB2', from: 'CNB', to: 'GAYA', depTime: '17:00', durationMins: 420 },
      { number: 'BRE1', from: 'SDDN', to: 'BRE', depTime: '06:30', durationMins: 300 },
      { number: 'BRE2', from: 'BRE', to: 'GAYA', depTime: '14:00', durationMins: 360 },
      { number: 'GKP1', from: 'SDDN', to: 'GKP', depTime: '07:00', durationMins: 150 },
      { number: 'GKP2', from: 'GKP', to: 'GAYA', depTime: '12:00', durationMins: 300 },
    ],
    { hubs: ['CNB', 'BRE'], stations: ['SDDN', 'GAYA', 'CNB', 'BRE', 'GKP'] },
  );
  const opts = await findOptions(provider, { from: 'SDDN', to: 'GAYA', date: DATE, cls: 'SL' });
  const splits = opts.filter((o) => o.type === 'split');
  assert.equal(splits.length, 1, 'only the Gorakhpur split survives the geo tests');
  assert.equal(splits[0]!.hub, 'GKP');
  assert.equal(splits[0]!.legs[0]!.trainNumber, 'GKP1');
  assert.equal(splits[0]!.legs[1]!.trainNumber, 'GKP2');
  assert.equal(splits[0]!.connectionMins, 150);
});

test('geo: a hub without coordinates is kept, never rejected blind', async () => {
  const { provider } = makeGeoProvider(
    [
      { number: 'ZZ1', from: 'SDDN', to: 'ZZZZ', depTime: '07:00', durationMins: 120 },
      { number: 'ZZ2', from: 'ZZZZ', to: 'GAYA', depTime: '11:00', durationMins: 240 },
    ],
    { hubs: ['ZZZZ'] },
  );
  const opts = await findOptions(provider, {
    from: 'SDDN',
    to: 'GAYA',
    date: DATE,
    cls: 'SL',
    hubs: ['ZZZZ'],
  });
  const splits = opts.filter((o) => o.type === 'split');
  assert.equal(splits.length, 1, 'no coordinates means no geo rejection');
  assert.equal(splits[0]!.hub, 'ZZZZ');
});

test('one leg, one availability: shared legs are built once and shared', async () => {
  const { provider, fareCalls, availCalls } = makeGeoProvider(
    [
      { number: 'T1', from: 'AAA', to: 'HUB', depTime: '06:00', durationMins: 240 },
      { number: 'T2', from: 'HUB', to: 'BBB', depTime: '11:30', durationMins: 240 },
      { number: 'T3', from: 'HUB', to: 'BBB', depTime: '13:00', durationMins: 240 },
    ],
    { hubs: ['HUB'] },
  );
  const opts = await findOptions(provider, {
    from: 'AAA',
    to: 'BBB',
    date: DATE,
    cls: 'SL',
    hubs: ['HUB'],
  });
  const splits = opts.filter((o) => o.type === 'split');
  assert.equal(splits.length, 2);
  assert.ok(splits[0]!.legs[0] === splits[1]!.legs[0], 'both options share the same leg object');
  assert.equal(splits[0]!.legs[0]!.availability.state, 'AVAILABLE');
  assert.equal(availCalls.get('T1|AAA|HUB'), 1, 'leg one seat check ran once');
  assert.equal(fareCalls.get('T1|AAA|HUB'), 1, 'leg one fare ran once');
});

test('a split that changes stations ranks below a same-station split', async () => {
  const { provider } = makeGeoProvider(
    [
      { number: 'T1', from: 'AAA', to: 'HUB', depTime: '06:00', durationMins: 240 },
      { number: 'T2', from: 'HUB', to: 'BBB', depTime: '14:00', durationMins: 300 },
      { number: 'T3', from: 'HUB2', to: 'BBB', depTime: '12:30', durationMins: 240, serves: ['HUB', 'BBB'] },
    ],
    { hubs: ['HUB'] },
  );
  const opts = await findOptions(provider, {
    from: 'AAA',
    to: 'BBB',
    date: DATE,
    cls: 'SL',
    hubs: ['HUB'],
  });
  const splits = opts.filter((o) => o.type === 'split');
  assert.equal(splits.length, 2);
  // T2 is slower than T3 (780 vs 630 mins) but waits at one station; it must
  // still rank first now that station changes carry a rank cost.
  assert.equal(splits[0]!.legs[1]!.from, 'HUB');
  assert.equal(splits[1]!.legs[1]!.from, 'HUB2');
});

test('hub diversity: no change station takes more than four split slots', async () => {
  const viaA: FakeTrain[] = [
    ['A1', '11:30'],
    ['A2', '12:00'],
    ['A3', '12:30'],
    ['A4', '13:00'],
    ['A5', '13:30'],
    ['A6', '14:00'],
  ].map(([number, depTime]) => ({ number, from: 'AAA1', to: 'ZZZ', depTime, durationMins: 240 }));
  const viaB: FakeTrain[] = [
    ['B1', '11:30'],
    ['B2', '12:00'],
    ['B3', '12:30'],
    ['B4', '13:00'],
  ].map(([number, depTime]) => ({ number, from: 'BBB2', to: 'ZZZ', depTime, durationMins: 240 }));
  const { provider } = makeGeoProvider(
    [
      { number: 'IN-A', from: 'OOO', to: 'AAA1', depTime: '06:00', durationMins: 240 },
      { number: 'IN-B', from: 'OOO', to: 'BBB2', depTime: '06:00', durationMins: 240 },
      ...viaA,
      ...viaB,
    ],
    { hubs: ['AAA1', 'BBB2'] },
  );
  const opts = await findOptions(provider, {
    from: 'OOO',
    to: 'ZZZ',
    date: DATE,
    cls: 'SL',
    hubs: ['AAA1', 'BBB2'],
  });
  const splits = opts.filter((o) => o.type === 'split');
  assert.equal(splits.length, 8, 'ten candidates fill eight slots');
  assert.equal(splits.filter((o) => o.hub === 'AAA1').length, 4, 'station A capped at four');
  assert.equal(splits.filter((o) => o.hub === 'BBB2').length, 4, 'station B takes the rest');
  const durations = splits.map((o) => o.totalDurationMins);
  assert.deepEqual(
    [...durations].sort((a, b) => a - b),
    durations,
    'picked splits keep the ranked order',
  );
  // Fewer candidates than slots: everything shows, the cap does not bite.
  const scarce = await findOptions(provider, {
    from: 'OOO',
    to: 'ZZZ',
    date: DATE,
    cls: 'SL',
    hubs: ['AAA1'],
  });
  assert.equal(
    scarce.filter((o) => o.type === 'split').length,
    6,
    'six candidates under eight slots all show',
  );
});

test('origin loops: no split boards its second leg at the origin or its city cluster', async () => {
  // Gorakhpur to Gaya. Hub Domingarh (DMG) sits 4.1 km from Gorakhpur: leg one
  // hops there, then leg two either boards back at Gorakhpur itself (clustered
  // provider data) or at Domingarh. Neither is a split journey.
  const loop = makeGeoProvider(
    [
      { number: 'L1', from: 'GKP', to: 'DMG', depTime: '07:00', durationMins: 90 },
      { number: 'L2', from: 'GKP', to: 'GAYA', depTime: '12:00', durationMins: 600, serves: ['DMG', 'GAYA'] },
      { number: 'L3', from: 'DMG', to: 'GAYA', depTime: '12:00', durationMins: 600 },
    ],
    { hubs: ['DMG'] },
  );
  const loopOpts = await findOptions(loop.provider, {
    from: 'GKP',
    to: 'GAYA',
    date: DATE,
    cls: 'SL',
    hubs: ['DMG'],
  });
  assert.equal(
    loopOpts.filter((o) => o.type === 'split').length,
    0,
    'GKP -> DMG -> (GKP or DMG) is not a split journey',
  );
  const ok = makeGeoProvider(
    [
      { number: 'T1', from: 'GKP', to: 'HUBOK', depTime: '06:00', durationMins: 240 },
      { number: 'T2', from: 'HUBOK', to: 'GAYA', depTime: '11:30', durationMins: 240 },
    ],
    { hubs: ['HUBOK'] },
  );
  const okOpts = await findOptions(ok.provider, {
    from: 'GKP',
    to: 'GAYA',
    date: DATE,
    cls: 'SL',
    hubs: ['HUBOK'],
  });
  assert.equal(okOpts.filter((o) => o.type === 'split').length, 1, 'a hub outside the origin cluster still splits');
});

test('an unknown requested class fails loudly instead of returning zero options', async () => {
  // Regression guard: a stale engine bundle once treated 'ANY' as an
  // unrecognized class, every leg build returned null, and the browser
  // search silently returned 0 options while node probes worked. Entry
  // validation now throws at once. Per-leg data isolation is untouched:
  // a leg whose data fails still just drops out of the search.
  const { provider } = makeGeoProvider([
    { number: 'L1', from: 'AAA', to: 'ZZZ', depTime: '06:00', durationMins: 240, fares: { SL: 235 } },
  ]);
  await assert.rejects(
    () => findOptions(provider, { from: 'AAA', to: 'ZZZ', date: '2026-12-01', cls: 'ZZZ' as SearchClass }),
    /Unknown train class/,
  );
});

test('any class: a confirmed mixed pair beats a same-class pair with a waitlisted leg', async () => {
  // Sleeper is confirmed on leg 1 but waitlisted on leg 2, and 3A the other
  // way round. No class is confirmed on both, while the mixed pair SL + 3A is
  // confirmed on both legs, so the mixed pair wins even though the cheaper
  // same-class Sleeper pair (480) has a waitlisted leg.
  const { provider } = makeGeoProvider([
    { number: 'L1', from: 'AAA', to: 'HUB', depTime: '06:00', durationMins: 240,
      fares: { SL: 235, '3A': 625 },
      availAll: { SL: { state: 'AVAILABLE', count: 50 }, '3A': { state: 'WL', count: 9, wlPrefix: 'GNWL9' } } },
    { number: 'L2', from: 'HUB', to: 'ZZZ', depTime: '12:00', durationMins: 240,
      fares: { SL: 245, '3A': 655 },
      availAll: { SL: { state: 'WL', count: 12, wlPrefix: 'GNWL12' }, '3A': { state: 'AVAILABLE', count: 50 } } },
  ]);
  const opts = await findOptions(provider, { from: 'AAA', to: 'ZZZ', date: '2026-12-01', cls: 'ANY', hubs: ['HUB'] });
  const split = opts.find((o) => o.type === 'split');
  assert.ok(split, 'split option exists');
  assert.equal(split.legs[0]!.cls, 'SL');
  assert.equal(split.legs[1]!.cls, '3A');
  assert.equal(split.totalFare, 890);
  assert.equal(split.bookable, true, 'both legs confirmed');
});

test('any class: with equal availability, the price tie-break picks the cheapest combination', async () => {
  // Every class is confirmed on both legs, so seat quality is equal across
  // all combinations and the cheapest total wins: the same-class Sleeper
  // pair (480) beats the pricier confirmed mixed pair (890).
  const { provider } = makeGeoProvider([
    { number: 'L1', from: 'AAA', to: 'HUB', depTime: '06:00', durationMins: 240,
      fares: { SL: 235, '3A': 625 },
      availAll: { SL: { state: 'AVAILABLE', count: 50 }, '3A': { state: 'AVAILABLE', count: 50 } } },
    { number: 'L2', from: 'HUB', to: 'ZZZ', depTime: '12:00', durationMins: 240,
      fares: { SL: 245, '3A': 655 },
      availAll: { SL: { state: 'AVAILABLE', count: 50 }, '3A': { state: 'AVAILABLE', count: 50 } } },
  ]);
  const opts = await findOptions(provider, { from: 'AAA', to: 'ZZZ', date: '2026-12-01', cls: 'ANY', hubs: ['HUB'] });
  const split = opts.find((o) => o.type === 'split');
  assert.ok(split, 'split option exists');
  assert.equal(split.legs[0]!.cls, 'SL');
  assert.equal(split.legs[1]!.cls, 'SL');
  assert.equal(split.totalFare, 480, 'cheapest combination at equal quality');
  assert.equal(split.bookable, true);
});

test('twin stations: the same two trains at the same fare collapse to one split', async () => {
  // Trains 101 and 102 run AAA -> H1 -> ZZZ. The same two numbers are also
  // enumerated through H2, a twin station of the same city, which yields a
  // second split with the same two trains and the same 900 total. Its faster
  // connection ranks it first, so without de-duplication the two slots both
  // go to the same pair of tickets and the genuinely different 201/202 route
  // via H3 is crowded out. De-duplication runs before the hub-diversity
  // fill, so the collapse frees that slot.
  const { provider } = makeGeoProvider([
    { number: '101', from: 'AAA', to: 'H1', depTime: '06:00', durationMins: 240 },
    { number: '102', from: 'H1', to: 'ZZZ', depTime: '12:00', durationMins: 240 },
    { number: '101', from: 'AAA', to: 'H1', depTime: '06:00', durationMins: 240, serves: ['AAA', 'H2'] },
    { number: '102', from: 'H1', to: 'ZZZ', depTime: '11:40', durationMins: 240, serves: ['H2', 'ZZZ'] },
    { number: '201', from: 'AAA', to: 'H3', depTime: '06:00', durationMins: 240 },
    { number: '202', from: 'H3', to: 'ZZZ', depTime: '12:00', durationMins: 240 },
  ]);
  const opts = await findOptions(provider, {
    from: 'AAA', to: 'ZZZ', date: '2026-12-01', cls: 'SL', hubs: ['H1', 'H2', 'H3'], maxSplits: 2,
  });
  const splits = opts.filter((o) => o.type === 'split');
  assert.equal(splits.length, 2, 'the twin duplicate collapsed, both real routes fit');
  const pair = splits.find((o) => o.legs[0]!.trainNumber === '101');
  assert.ok(pair, 'the 101/102 pair survives');
  assert.equal(pair.hub, 'H2', 'one instance kept: the higher-ranked twin, faster connection');
  assert.equal(pair.legs[0]!.to, pair.legs[1]!.from, 'the kept instance waits at a single station');
  assert.equal(pair.totalFare, 900, 'the duplicate key required the same total fare');
  assert.ok(
    splits.some((o) => o.legs[0]!.trainNumber === '201'),
    'the freed slot went to the genuinely different route',
  );
});

test('any class: budget is a hard filter and reports how many options it hid', async () => {
  const make = () => makeGeoProvider([
    { number: 'D1', from: 'AAA', to: 'ZZZ', depTime: '06:00', durationMins: 300,
      fares: { SL: 235 }, availAll: { SL: { state: 'AVAILABLE', count: 50 } } },
    { number: 'D2', from: 'AAA', to: 'ZZZ', depTime: '09:00', durationMins: 300,
      fares: { SL: 900 }, availAll: { SL: { state: 'AVAILABLE', count: 50 } } },
  ]);
  const hidden = { count: 0 };
  const opts = await findOptions(make().provider, {
    from: 'AAA', to: 'ZZZ', date: '2026-12-01', cls: 'ANY', budgetPerHead: 600, hiddenByBudget: hidden,
  });
  assert.deepEqual(
    opts.map((o) => o.legs[0]!.trainNumber),
    ['D1'],
    'the over-budget option is not shown',
  );
  assert.equal(hidden.count, 1, 'the header can state what the budget hid');
  const all = await findOptions(make().provider, {
    from: 'AAA', to: 'ZZZ', date: '2026-12-01', cls: 'ANY',
  });
  assert.equal(all.length, 2, 'without a budget both options show');
});

const AV50 = { state: 'AVAILABLE', count: 50 };

/** The hidden-count fixture: 2 directs and 1 split exceed a Rs 600 budget,
 *  every other option fits it. Split legs sit at different hubs so no
 *  cross-pair changes the count. */
function budgetFixture() {
  return [
    { number: 'D1', from: 'AAA', to: 'ZZZ', depTime: '05:00', durationMins: 300,
      fares: { SL: 500 }, availAll: { SL: AV50 } },
    { number: 'D2', from: 'AAA', to: 'ZZZ', depTime: '05:30', durationMins: 300,
      fares: { SL: 550 }, availAll: { SL: AV50 } },
    { number: 'D3', from: 'AAA', to: 'ZZZ', depTime: '06:00', durationMins: 300,
      fares: { SL: 700 }, availAll: { SL: AV50 } },
    { number: 'D4', from: 'AAA', to: 'ZZZ', depTime: '06:30', durationMins: 300,
      fares: { SL: 750 }, availAll: { SL: AV50 } },
    { number: 'M1', from: 'AAA', to: 'H1', depTime: '09:00', durationMins: 240,
      fares: { SL: 200, '3A': 350 }, availAll: { SL: AV50, '3A': AV50 } },
    { number: 'M2', from: 'H1', to: 'ZZZ', depTime: '14:30', durationMins: 240,
      fares: { SL: 300, '3A': 450 }, availAll: { SL: AV50, '3A': AV50 } },
    { number: 'L1', from: 'AAA', to: 'H2', depTime: '07:00', durationMins: 240,
      fares: { SL: 400, '3A': 600 }, availAll: { SL: AV50, '3A': AV50 } },
    { number: 'L2', from: 'H2', to: 'ZZZ', depTime: '12:30', durationMins: 240,
      fares: { SL: 400, '3A': 600 }, availAll: { SL: AV50, '3A': AV50 } },
  ];
}

test('hidden count: 2 directs and 1 split over budget read 3, in eager and deferred runs', async () => {
  for (const availabilityMode of ['eager', 'deferred'] as const) {
    const { provider } = makeGeoProvider(budgetFixture(), { hubs: ['H1', 'H2'] });
    const hidden = { count: -1 };
    const opts = await findOptions(provider, {
      from: 'AAA', to: 'ZZZ', date: '2026-12-01', cls: 'ANY', budgetPerHead: 600,
      hiddenByBudget: hidden, availabilityMode, maxDirects: 20, maxSplits: 8,
    });
    assert.equal(hidden.count, 3, `${availabilityMode}: D3, D4 and the L1/L2 split are the budget exclusions`);
    const shown = new Set(opts.map((o) => o.legs[0]!.trainNumber));
    assert.ok(shown.has('D1') && shown.has('D2'), 'within-budget directs show');
    assert.ok(opts.some((o) => o.type === 'split' && o.legs[0]!.trainNumber === 'M1'), 'the within-budget split shows');
    assert.ok(!shown.has('D3') && !shown.has('D4'), 'over-budget directs hide');
    assert.ok(!opts.some((o) => o.legs[0]!.trainNumber === 'L1'), 'the over-budget split hides');
  }
});

test('hidden count: a twin duplicate of the over-budget split counts once', async () => {
  // The same L1/L2 pair is also enumerated through H3, a twin station, at the
  // same 800 total: one traveller option, one hidden count.
  const trains = [
    ...budgetFixture(),
    { number: 'L1', from: 'AAA', to: 'H3', depTime: '07:00', durationMins: 240,
      fares: { SL: 400 }, availAll: { SL: AV50 } },
    { number: 'L2', from: 'H3', to: 'ZZZ', depTime: '12:30', durationMins: 240,
      fares: { SL: 400 }, availAll: { SL: AV50 } },
  ];
  const { provider } = makeGeoProvider(trains, { hubs: ['H1', 'H2', 'H3'] });
  const hidden = { count: -1 };
  await findOptions(provider, {
    from: 'AAA', to: 'ZZZ', date: '2026-12-01', cls: 'ANY', budgetPerHead: 600,
    hiddenByBudget: hidden, availabilityMode: 'deferred', maxDirects: 20, maxSplits: 8,
  });
  assert.equal(hidden.count, 3, 'the twin instance does not add to the count');
});

test('hidden count: zero with no budget and zero when nothing exceeds it', async () => {
  const noBudget = makeGeoProvider(budgetFixture(), { hubs: ['H1', 'H2'] });
  const none = { count: -1 };
  await findOptions(noBudget.provider, {
    from: 'AAA', to: 'ZZZ', date: '2026-12-01', cls: 'ANY',
    hiddenByBudget: none, availabilityMode: 'deferred', maxDirects: 20, maxSplits: 8,
  });
  assert.equal(none.count, 0, 'no budget, nothing hidden');

  const slack = makeGeoProvider(budgetFixture(), { hubs: ['H1', 'H2'] });
  const fits = { count: -1 };
  await findOptions(slack.provider, {
    from: 'AAA', to: 'ZZZ', date: '2026-12-01', cls: 'ANY', budgetPerHead: 900,
    hiddenByBudget: fits, availabilityMode: 'deferred', maxDirects: 20, maxSplits: 8,
  });
  assert.equal(fits.count, 0, 'every option fits a 900 budget');
});

test('hidden count: options beyond the deferred refine slice keep their true budget status', async () => {
  // 30 directs within budget and 2 over: the refine covers the top 28, so the
  // two within-budget directs just outside it must not be miscounted as
  // budget-hidden.
  const trains: any[] = [];
  for (let i = 1; i <= 30; i++) {
    trains.push({
      number: `W${i}`, from: 'AAA', to: 'ZZZ',
      depTime: `0${(i % 9) + 1}:${String((i * 7) % 60).padStart(2, '0')}`,
      durationMins: 300, fares: { SL: 100 + i }, availAll: { SL: AV50 },
    });
  }
  trains.push({ number: 'X1', from: 'AAA', to: 'ZZZ', depTime: '11:00', durationMins: 300,
    fares: { SL: 700 }, availAll: { SL: AV50 } });
  trains.push({ number: 'X2', from: 'AAA', to: 'ZZZ', depTime: '12:00', durationMins: 300,
    fares: { SL: 800 }, availAll: { SL: AV50 } });
  const { provider } = makeGeoProvider(trains, { hubs: [] });
  const hidden = { count: -1 };
  await findOptions(provider, {
    from: 'AAA', to: 'ZZZ', date: '2026-12-01', cls: 'ANY', budgetPerHead: 600,
    hiddenByBudget: hidden, availabilityMode: 'deferred', maxDirects: 20, maxSplits: 8,
  });
  assert.equal(hidden.count, 2, 'only the two genuinely over-budget directs count');
});

test('single-class mode keeps the over-budget badge: options rank last but still show', async () => {
  const make = () => makeGeoProvider([
    { number: 'D1', from: 'AAA', to: 'ZZZ', depTime: '06:00', durationMins: 300,
      fares: { SL: 235 }, availAll: { SL: { state: 'AVAILABLE', count: 50 } } },
    { number: 'D2', from: 'AAA', to: 'ZZZ', depTime: '09:00', durationMins: 300,
      fares: { SL: 900 }, availAll: { SL: { state: 'AVAILABLE', count: 50 } } },
  ]);
  const hidden = { count: 0 };
  const opts = await findOptions(make().provider, {
    from: 'AAA', to: 'ZZZ', date: '2026-12-01', cls: 'SL', budgetPerHead: 600, hiddenByBudget: hidden,
  });
  assert.deepEqual(
    opts.map((o) => o.legs[0]!.trainNumber),
    ['D1', 'D2'],
    'within-budget first, the over-budget option still visible',
  );
  assert.equal(hidden.count, 0, 'the hidden count is only reported in any mode');
});

test('any class: no common bookable class falls back to a labelled mixed split', async () => {
  // Sleeper is bookable only on leg 1, 3A only on leg 2. No class is bookable
  // on both, so each leg takes its own cheapest bookable class and the option
  // carries them per leg.
  const { provider } = makeGeoProvider([
    { number: 'M1', from: 'AAA', to: 'HUB', depTime: '06:00', durationMins: 240,
      fares: { SL: 235, '3A': 625 },
      availAll: { SL: { state: 'AVAILABLE', count: 50 }, '3A': { state: 'WL', count: 3, wlPrefix: 'GNWL3' } } },
    { number: 'M2', from: 'HUB', to: 'ZZZ', depTime: '12:00', durationMins: 240,
      fares: { SL: 245, '3A': 655 },
      availAll: { SL: { state: 'WL', count: 12, wlPrefix: 'GNWL12' }, '3A': { state: 'AVAILABLE', count: 50 } } },
  ]);
  const opts = await findOptions(provider, { from: 'AAA', to: 'ZZZ', date: '2026-12-01', cls: 'ANY', hubs: ['HUB'] });
  const split = opts.find((o) => o.type === 'split');
  assert.ok(split, 'split option exists');
  assert.equal(split.legs[0]!.cls, 'SL');
  assert.equal(split.legs[1]!.cls, '3A');
  assert.equal(split.legs[0]!.fare, 235);
  assert.equal(split.legs[1]!.fare, 655);
  assert.equal(split.totalFare, 890);
  assert.equal(split.bookable, true);
});

test('any class: budget applies to the picked split total and hides over-budget options', async () => {
  const make = () => makeGeoProvider([
    { number: 'M1', from: 'AAA', to: 'HUB', depTime: '06:00', durationMins: 240,
      fares: { SL: 235, '3A': 625 },
      availAll: { SL: { state: 'AVAILABLE', count: 50 }, '3A': { state: 'WL', count: 3, wlPrefix: 'GNWL3' } } },
    { number: 'M2', from: 'HUB', to: 'ZZZ', depTime: '12:00', durationMins: 240,
      fares: { SL: 245, '3A': 655 },
      availAll: { SL: { state: 'WL', count: 12, wlPrefix: 'GNWL12' }, '3A': { state: 'AVAILABLE', count: 50 } } },
  ]);
  const withinHidden = { count: 0 };
  const within = await findOptions(make().provider, {
    from: 'AAA', to: 'ZZZ', date: '2026-12-01', cls: 'ANY', hubs: ['HUB'],
    budgetPerHead: 900, hiddenByBudget: withinHidden,
  });
  assert.equal(within.find((o) => o.type === 'split')!.withinBudget, true, '890 total fits a 900 budget');
  assert.equal(withinHidden.count, 0, 'nothing hidden within budget');
  const overHidden = { count: 0 };
  const over = await findOptions(make().provider, {
    from: 'AAA', to: 'ZZZ', date: '2026-12-01', cls: 'ANY', hubs: ['HUB'],
    budgetPerHead: 800, hiddenByBudget: overHidden,
  });
  assert.equal(over.length, 0, 'an 890 total busts an 800 budget and is hidden, not ranked last');
  assert.equal(overHidden.count, 1, 'the header can state what the budget hid');
});

test('any class: direct headline is the cheapest bookable class, honestly labelled otherwise', async () => {
  const { provider } = makeGeoProvider([
    { number: 'D1', from: 'AAA', to: 'ZZZ', depTime: '06:00', durationMins: 300,
      fares: { SL: 235, '3A': 625 },
      availAll: { SL: { state: 'AVAILABLE', count: 50 }, '3A': { state: 'WL', count: 9, wlPrefix: 'GNWL9' } } },
    { number: 'D2', from: 'AAA', to: 'ZZZ', depTime: '09:00', durationMins: 300,
      fares: { SL: 235, '3A': 625 },
      availAll: { SL: { state: 'WL', count: 9, wlPrefix: 'GNWL9' }, '3A': { state: 'WL', count: 20, wlPrefix: 'GNWL20' } } },
  ]);
  const opts = await findOptions(provider, { from: 'AAA', to: 'ZZZ', date: '2026-12-01', cls: 'ANY' });
  const d1 = opts.find((o) => o.type === 'direct' && o.legs[0]!.trainNumber === 'D1');
  const d2 = opts.find((o) => o.type === 'direct' && o.legs[0]!.trainNumber === 'D2');
  assert.ok(d1 && d2, 'both directs returned');
  // D1: the headline is the cheapest bookable class (Sleeper), not a flat fare.
  assert.equal(d1.legs[0]!.cls, 'SL');
  assert.equal(d1.totalFare, 235);
  assert.equal(d1.bookable, true);
  assert.deepEqual(
    d1.legs[0]!.perClass?.map((e) => [e.cls, e.fare]),
    [['SL', 235], ['3A', 625]],
    'per-class list rides on the leg, cheapest first',
  );
  // D2: every class waitlisted, so the headline falls back to the cheapest fare
  // and the stamp says so honestly.
  assert.equal(d2.legs[0]!.cls, 'SL');
  assert.equal(d2.legs[0]!.availability.state, 'WL');
  assert.equal(d2.totalFare, 235);
  assert.equal(d2.bookable, false);
});
