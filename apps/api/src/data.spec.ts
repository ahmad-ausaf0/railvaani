import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Stop, Train, TrainDataProvider } from '@railvaani/train-core';
import { ProviderError } from '@railvaani/train-core';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { istToday } from './validate.js';
import { IrctcDevClient } from './irctcdev-client.js';

/** Fresh app + ephemeral port per test, so rate windows and caches never leak. */
async function withApp(
  provider: TrainDataProvider,
  env: Record<string, string> = { CONFIRMTKT_API_KEY: 'test-key' },
  fn: (base: string) => Promise<void>,
  irctcDev?: IrctcDevClient | null,
): Promise<void> {
  const server = http.createServer(buildApp(loadConfig(env), { provider, irctcDev }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fn(base);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function dayAfter(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const TOMORROW = dayAfter(istToday());

function makeTrain(number = '12565'): Train {
  return {
    number,
    name: 'Test Express',
    runsOn: [],
    from: 'GKP',
    to: 'NDLS',
    depTime: '20:05',
    arrTime: '08:30',
    durationMins: 745,
  };
}

const STOPS: Stop[] = [
  { station: { code: 'GKP', name: 'Gorakhpur Junction', zone: 'NER' }, dep: '20:05', day: 0 },
  { station: { code: 'NDLS', name: 'New Delhi', zone: 'NR' }, arr: '08:30', day: 1 },
];

/** Counting stub: no network. `overrides` swap in failures per test. */
function stubProvider(overrides: Partial<TrainDataProvider> = {}) {
  const calls = { search: 0, availability: 0, getFare: 0, availabilityAll: 0, route: 0 };
  const provider: TrainDataProvider = {
    searchTrains: async () => {
      calls.search += 1;
      return [makeTrain()];
    },
    getAvailability: async () => {
      calls.availability += 1;
      return { state: 'AVAILABLE', count: 42 };
    },
    getFare: async () => {
      calls.getFare += 1;
      return 555;
    },
    getRoute: async () => {
      calls.route += 1;
      return STOPS;
    },
    searchStations: async () => [],
    listStations: async () => [],
    getAvailabilityAll: async () => {
      calls.availabilityAll += 1;
      return { SL: { state: 'AVAILABLE', count: 42 } };
    },
    getFareTable: () => ({ SL: 555 }),
    suggestHubs: async () => [],
    ...overrides,
  };
  return { provider, calls };
}

test('/api/search runs the split engine with live availability and stamps fetchedAt', async () => {
  const { provider, calls } = stubProvider();
  await withApp(provider, undefined, async (base) => {
    const res = await fetch(
      `${base}/api/search?from=GKP&to=NDLS&date=${TOMORROW}&cls=SL&budget=600`,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(body.fetchedAt));
    assert.ok(Array.isArray(body.options) && body.options.length >= 1);
    const direct = body.options[0];
    assert.equal(direct.type, 'direct');
    assert.equal(typeof direct.totalFare, 'number');
    assert.equal(direct.legs[0].availability.state, 'AVAILABLE');
    // eager availability: the leg was actually checked, not deferred
    assert.ok(calls.availability >= 1);
    assert.ok(calls.getFare >= 1);
  });
});

test('/api/availability serves all-class status for one train and date', async () => {
  const { provider, calls } = stubProvider();
  await withApp(provider, undefined, async (base) => {
    const res = await fetch(`${base}/api/availability?trainNo=12565&date=${TOMORROW}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.availability.SL.state, 'AVAILABLE');
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(body.fetchedAt));
    assert.equal(calls.availabilityAll, 1);
  });
});

test('a second identical availability request skips the provider and keeps the first fetchedAt', async () => {
  const { provider, calls } = stubProvider();
  await withApp(provider, undefined, async (base) => {
    const first = await fetch(`${base}/api/availability?trainNo=12565&date=${TOMORROW}`);
    const firstBody = await first.json();
    const second = await fetch(`${base}/api/availability?trainNo=12565&date=${TOMORROW}`);
    const secondBody = await second.json();
    assert.equal(second.status, 200);
    assert.equal(calls.availabilityAll, 1); // provider hit once, not twice
    assert.equal(secondBody.fetchedAt, firstBody.fetchedAt); // snapshot stays honest
    // a different date is a different key: it must reach the provider again
    const other = await fetch(
      `${base}/api/availability?trainNo=12565&date=${dayAfter(TOMORROW)}`,
    );
    assert.equal(other.status, 200);
    assert.equal(calls.availabilityAll, 2);
  });
});

test('/api/fare-table serves the class-wise fares with fetchedAt', async () => {
  const { provider } = stubProvider();
  await withApp(provider, undefined, async (base) => {
    const res = await fetch(`${base}/api/fare-table?trainNo=12565&from=GKP&to=NDLS`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.fares.SL, 555);
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(body.fetchedAt));
  });
});

test('/api/route serves the stop list with fetchedAt', async () => {
  const { provider, calls } = stubProvider();
  await withApp(provider, undefined, async (base) => {
    const res = await fetch(`${base}/api/route?trainNo=12565`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.stops[0].station.code, 'GKP');
    assert.equal(body.stops[1].day, 1);
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(body.fetchedAt));
    assert.equal(calls.route, 1);
  });
});

test('a bad class code answers 400 in the standard shape', async () => {
  const { provider } = stubProvider();
  await withApp(provider, undefined, async (base) => {
    const res = await fetch(
      `${base}/api/search?from=GKP&to=NDLS&date=${TOMORROW}&cls=ZZ`,
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'bad_request');
    assert.equal(typeof body.error.message, 'string');
  });
});

test('an upstream failure on search answers 502 upstream_down', async () => {
  const { provider } = stubProvider({
    searchTrains: async () => {
      throw new ProviderError('provider_down', 'ConfirmTkt is not responding.');
    },
  });
  await withApp(provider, undefined, async (base) => {
    const res = await fetch(
      `${base}/api/search?from=GKP&to=NDLS&date=${TOMORROW}&cls=SL`,
    );
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error.code, 'upstream_down');
    assert.equal(typeof body.error.message, 'string');
  });
});

test('search keeps returning direct trains when the hub/split part fails', async () => {
  const { provider } = stubProvider({
    suggestHubs: async () => {
      throw new ProviderError('provider_down', 'erail is not responding.');
    },
    listStations: async () => {
      throw new ProviderError('provider_down', 'erail is not responding.');
    },
  });
  await withApp(provider, undefined, async (base) => {
    const res = await fetch(
      `${base}/api/search?from=GKP&to=NDLS&date=${TOMORROW}&cls=SL`,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.options.length >= 1);
    assert.equal(body.options[0].type, 'direct');
  });
});

test('with no CONFIRMTKT_API_KEY the data endpoints answer not_configured and health stays up', async () => {
  const { provider } = stubProvider();
  await withApp(provider, {}, async (base) => {
    const av = await fetch(`${base}/api/availability?trainNo=12565&date=${TOMORROW}`);
    assert.equal(av.status, 503);
    assert.equal((await av.json()).error.code, 'not_configured');
    const search = await fetch(
      `${base}/api/search?from=GKP&to=NDLS&date=${TOMORROW}&cls=SL`,
    );
    assert.equal(search.status, 503);
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: 'railvaani-api' });
  });
});

function makeTrainOn(number: string, from: string, to: string, dep: string): Train {
  return { ...makeTrain(number), from, to, depTime: dep };
}

test('/api/search expands clustered stations on both ends and keeps actual codes', async () => {
  // The real upstream is city-loose: a GKP -> NDLS search already returns
  // DLI arrivals, and searching (GKP, DLI) returns the same train, so the
  // merge must dedupe by train number + departure time.
  const gkpToDli = makeTrainOn('12541', 'GKP', 'DLI', '15:35');
  const legTrains: Record<string, Train[]> = {
    'GKP:NDLS': [gkpToDli, makeTrainOn('12565', 'GKP', 'NDLS', '20:05')],
    'GKP:DLI': [gkpToDli],
    'GKP:ANVT': [makeTrainOn('15707', 'GKP', 'ANVT', '16:20')],
    'GKC:NDLS': [makeTrainOn('05071', 'GKC', 'NDLS', '04:10')],
  };
  const searched: string[] = [];
  const { provider } = stubProvider({
    searchTrains: async (from: string, to: string) => {
      searched.push(`${from}:${to}`);
      return legTrains[`${from}:${to}`] ?? [];
    },
  });
  await withApp(provider, undefined, async (base) => {
    const res = await fetch(`${base}/api/search?from=GKP&to=NDLS&date=${TOMORROW}&cls=SL`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.expandedFrom, ['GKP', 'GKC']);
    assert.deepEqual(body.expandedTo, ['NDLS', 'DLI', 'ANVT', 'NZM', 'SSB']);
    for (const f of ['GKP', 'GKC']) {
      for (const t of ['NDLS', 'DLI', 'ANVT', 'NZM', 'SSB']) {
        assert.ok(searched.includes(`${f}:${t}`), `pair ${f}:${t} was not searched`);
      }
    }
    const last = <O extends { legs: Array<{ to: string }> }>(o: O) => o.legs[o.legs.length - 1].to;
    const destinations = body.options.map(last);
    assert.ok(destinations.includes('DLI'), 'no DLI arrival');
    assert.ok(destinations.includes('ANVT'), 'no ANVT arrival');
    assert.ok(destinations.includes('NDLS'), 'no NDLS arrival');
    // The duplicated 12541 appears once, not twice.
    assert.equal(
      body.options.filter(
        (o: { legs: Array<{ trainNumber: string }> }) => o.legs[0].trainNumber === '12541',
      ).length,
      1,
    );
    // Actual boarding stations survive: 05071 boards at GKC, not relabeled.
    assert.ok(
      body.options.some((o: { legs: Array<{ from: string }> }) => o.legs[0].from === 'GKC'),
      'GKC boarding lost',
    );
    // Directs come back chronological.
    const deps = body.options.map((o: { legs: Array<{ depTime: string }> }) => o.legs[0].depTime);
    assert.deepEqual(deps, [...deps].sort());
  });
});

test('/api/search leaves non-clustered stations untouched', async () => {
  const searched: string[] = [];
  const { provider } = stubProvider({
    searchTrains: async (from: string, to: string) => {
      searched.push(`${from}:${to}`);
      return [makeTrainOn('12926', 'ASR', 'JAT', '07:45')];
    },
  });
  await withApp(provider, undefined, async (base) => {
    const res = await fetch(`${base}/api/search?from=ASR&to=JAT&date=${TOMORROW}&cls=SL`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.expandedFrom, []);
    assert.deepEqual(body.expandedTo, []);
    assert.ok(searched.length >= 1, 'the search never reached the provider');
    assert.ok(
      searched.every((k) => k === 'ASR:JAT'),
      `unexpected extra searches: ${searched.join(', ')}`,
    );
    assert.equal(body.options.length, 1);
    assert.equal(body.options[0].legs[0].from, 'ASR');
    assert.equal(body.options[0].legs[0].to, 'JAT');
  });
});

function irctcStubCalls() {
  const calls: string[] = [];
  const client = {
    searchTrains: async (from: string, to: string) => {
      calls.push(`search:${from}:${to}`);
      return [];
    },
    getSchedule: async (trainNo: string) => {
      calls.push(`schedule:${trainNo}`);
      return {
        trainNo,
        trainName: 'Test Express',
        runningDays: ['Mon', 'Wed'],
        originCode: 'GKP',
        destinationCode: 'NDLS',
        stops: [
          { seq: 1, code: 'GKP', name: 'Gorakhpur Junction', arr: null, dep: '20:05', day: 0, haltMins: 0, distanceKm: 0 },
          { seq: 2, code: 'LKO', name: 'Lucknow', arr: '23:55', dep: '00:05', day: 0, haltMins: 10, distanceKm: 270 },
          { seq: 3, code: 'NDLS', name: 'New Delhi', arr: '08:30', dep: null, day: 1, haltMins: 0, distanceKm: 780 },
        ],
      };
    },
    getFare: async (trainNo: string, from: string, to: string) => {
      calls.push(`fare:${trainNo}:${from}:${to}`);
      return { SL: 505, '2A': 1500, '3A': 1250, EC: 2500 };
    },
  };
  return { calls, client: client as unknown as IrctcDevClient };
}

test('/api/schedule serves the irctc.dev schedule and caches it for a day', async () => {
  const { provider } = stubProvider();
  const { calls, client } = irctcStubCalls();
  await withApp(provider, undefined, async (base) => {
    const res = await fetch(`${base}/api/schedule?trainNo=12565`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.trainNo, '12565');
    assert.equal(body.trainName, 'Test Express');
    assert.deepEqual(body.runningDays, ['Mon', 'Wed']);
    assert.equal(body.originCode, 'GKP');
    assert.equal(body.destinationCode, 'NDLS');
    assert.equal(body.stops.length, 3);
    assert.equal(body.stops[1].code, 'LKO');
    assert.equal(body.stops[1].haltMins, 10);
    assert.equal(body.stops[2].arr, '08:30');
    assert.equal(body.stops[2].day, 1);
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(body.fetchedAt));
    assert.deepEqual(calls, ['schedule:12565']);
    // Second request is a cache hit: one upstream call, same fetchedAt.
    const res2 = await fetch(`${base}/api/schedule?trainNo=12565`);
    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(calls.length, 1);
    assert.equal(body2.fetchedAt, body.fetchedAt);
    // A bad train number is rejected before anything is called.
    const bad = await fetch(`${base}/api/schedule?trainNo=abc`);
    assert.equal(bad.status, 400);
    assert.equal(calls.length, 1);
  }, client);
});

test('/api/schedule without IRCTC_DEV_API_KEY returns not_configured and calls nothing', async () => {
  const { provider } = stubProvider();
  const { calls, client } = irctcStubCalls();
  await withApp(provider, { CONFIRMTKT_API_KEY: 'test-key' }, async (base) => {
    const res = await fetch(`${base}/api/schedule?trainNo=12565`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'not_configured');
    assert.deepEqual(calls, []);
  }, null);
});

test('/api/fare-table prefers ConfirmTkt, fills gaps from irctc.dev, warns past 10 rupees', async () => {
  const { provider } = stubProvider();
  const { calls, client } = irctcStubCalls();
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (msg: unknown) => {
    warnings.push(String(msg));
  };
  try {
    await withApp(provider, undefined, async (base) => {
      const res = await fetch(`${base}/api/fare-table?trainNo=12565&from=GKP&to=NDLS`);
      assert.equal(res.status, 200);
      const body = await res.json();
      // ConfirmTkt stub answers { SL: 555 }: it wins, irctc.dev fills 2A/3A.
      assert.equal(body.fares.SL, 555);
      assert.equal(body.fares['2A'], 1500);
      assert.equal(body.fares['3A'], 1250);
      // 'EC' is not a TrainClass in this app and never reaches the response.
      assert.equal(body.fares.EC, undefined);
      assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(body.fetchedAt));
      // 555 vs 505 is 50 rupees apart: exactly one server-side warning.
      assert.equal(warnings.length, 1);
      assert.ok(warnings[0].includes('555') && warnings[0].includes('505'));
      assert.equal(Object.keys(body.fares).length, 3);
      assert.deepEqual(calls, ['fare:12565:GKP:NDLS']);
    }, client);
  } finally {
    console.warn = originalWarn;
  }
});

test('/api/fare-table without IRCTC_DEV_API_KEY serves ConfirmTkt only', async () => {
  const { provider } = stubProvider();
  const { calls, client } = irctcStubCalls();
  await withApp(provider, { CONFIRMTKT_API_KEY: 'test-key' }, async (base) => {
    const res = await fetch(`${base}/api/fare-table?trainNo=12565&from=GKP&to=NDLS`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.fares, { SL: 555 });
    assert.deepEqual(calls, []);
  }, null);
});

test('/api/availability never touches the irctc.dev client', async () => {
  const { provider } = stubProvider();
  const { calls, client } = irctcStubCalls();
  await withApp(provider, undefined, async (base) => {
    const res = await fetch(`${base}/api/availability?trainNo=12565&date=${TOMORROW}`);
    assert.equal(res.status, 200);
    assert.deepEqual(calls, []);
  }, client);
});

test('the irctc.dev client exposes no availability method, structurally', () => {
  const proto = Object.getOwnPropertyNames(IrctcDevClient.prototype);
  assert.ok(
    proto.every((n) => !/avail/i.test(n)),
    `availability leaked into the irctc.dev client: ${proto.join(', ')}`,
  );
  const client = new IrctcDevClient({ apiKey: 'unused' });
  const own = Object.getOwnPropertyNames(client);
  assert.ok(own.every((n) => !/avail/i.test(n)), `availability on the instance: ${own.join(', ')}`);
});

test('/api/search treats cls=ANY as the Any-class search', async () => {
  const { provider, calls } = stubProvider();
  await withApp(provider, undefined, async (base) => {
    const res = await fetch(
      `${base}/api/search?from=GKP&to=NDLS&date=${TOMORROW}&cls=ANY`,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.options) && body.options.length >= 1);
    // Any mode: each leg names the class the engine picked for it.
    assert.equal(body.options[0].legs[0].cls, 'SL');
    assert.equal(body.hiddenByBudget, 0);
    assert.equal(body.partial, undefined);
    assert.ok(calls.search >= 1);
  });
});

test('/api/search treats a missing cls the same as cls=ANY, sharing one cache entry', async () => {
  const { provider, calls } = stubProvider();
  await withApp(provider, undefined, async (base) => {
    const first = await fetch(`${base}/api/search?from=GKP&to=NDLS&date=${TOMORROW}`);
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.ok(body.options.length >= 1);
    assert.equal(body.options[0].legs[0].cls, 'SL');
    // The city cluster fans out to ten station pairs, one provider search
    // each; the cls=ANY repeat must hit the normalized cache key and call
    // the provider no further.
    assert.equal(calls.search, 10);
    const second = await fetch(
      `${base}/api/search?from=GKP&to=NDLS&date=${TOMORROW}&cls=ANY`,
    );
    assert.equal(second.status, 200);
    const body2 = await second.json();
    assert.equal(body2.fetchedAt, body.fetchedAt);
    assert.equal(calls.search, 10);
  });
});

test('the merged cluster search is re-capped to 20 directs and 8 splits', async () => {
  // GKP expands to [GKP, GKC] and NDLS to five Delhi stations. Only the GKP
  // pairs answer: 13 distinct directs and 4 splits each, so the merged,
  // deduped list lands far over both caps and only the re-cap bounds it.
  const toStations = ['NDLS', 'DLI', 'ANVT', 'NZM', 'SSB'];
  const pad = (n: number): string => String(n).padStart(2, '0');
  /** A leg train whose arrival actually follows its departure. */
  const makeLegTrain = (number: string, from: string, to: string, dep: string, durMins: number): Train => {
    const d = new Date(`${TOMORROW}T${dep}:00Z`);
    d.setUTCMinutes(d.getUTCMinutes() + durMins);
    return {
      number,
      name: 'Test Express',
      runsOn: [],
      from,
      to,
      depTime: dep,
      arrTime: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
      durationMins: durMins,
    };
  };
  const directs: Record<string, Train[]> = {};
  const leg2: Record<string, Train[]> = {};
  toStations.forEach((t, ti) => {
    directs[`GKP:${t}`] = Array.from({ length: 13 }, (_, i) =>
      makeTrainOn(`200${ti}${pad(i)}`, 'GKP', t, `06:${pad(i * 4)}`),
    );
    leg2[`CNB:${t}`] = Array.from({ length: 4 }, (_, j) =>
      makeLegTrain(`300${ti}${pad(j)}`, 'CNB', t, `13:${pad(j * 20)}`, 240),
    );
  });
  const leg1 = Array.from({ length: 4 }, (_, i) =>
    makeLegTrain(`400${pad(i)}`, 'GKP', 'CNB', `06:${pad(i * 20)}`, 240),
  );
  const { provider } = stubProvider({
    searchTrains: async (from: string, to: string) =>
      directs[`${from}:${to}`] ?? leg2[`${from}:${to}`] ?? (from === 'GKP' && to === 'CNB' ? leg1 : []),
    suggestHubs: async () => ['CNB'],
  });
  await withApp(provider, undefined, async (base) => {
    const res = await fetch(
      `${base}/api/search?from=GKP&to=NDLS&date=${TOMORROW}&cls=ANY`,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    const list: Array<{ type: string; legs: Array<{ depTime: string }> }> = body.options;
    const optionDirects = list.filter((o) => o.type === 'direct');
    const optionSplits = list.filter((o) => o.type === 'split');
    assert.equal(optionDirects.length, 20);
    assert.equal(optionSplits.length, 8);
    // Order survives the cap: directs first, then splits, each chronological.
    assert.equal(list[0].type, 'direct');
    assert.equal(list[27].type, 'split');
    for (const [group, label] of [[optionDirects, 'directs'], [optionSplits, 'splits']] as const) {
      const deps = group.map((o) => o.legs[0].depTime);
      assert.deepEqual(deps, [...deps].sort(), `${label} out of order`);
    }
    // No pair failed, so no partial flag; no budget, so nothing hidden.
    assert.equal(body.partial, undefined);
    assert.equal(body.hiddenByBudget, 0);
  });
});
