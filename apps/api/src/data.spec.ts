import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Stop, Train, TrainDataProvider } from '@railvaani/train-core';
import { ProviderError } from '@railvaani/train-core';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { istToday } from './validate.js';

/** Fresh app + ephemeral port per test, so rate windows and caches never leak. */
async function withApp(
  provider: TrainDataProvider,
  env: Record<string, string> = { CONFIRMTKT_API_KEY: 'test-key' },
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(buildApp(loadConfig(env), { provider }));
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
