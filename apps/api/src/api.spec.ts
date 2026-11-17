import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';

/** Start one fresh app per test so rate-limit windows and CORS config never
 *  leak between cases. The server binds an ephemeral port and is closed after. */
async function withApp(
  cfg: ReturnType<typeof loadConfig>,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(buildApp(cfg));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fn(base);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('loadConfig applies defaults and parses the allowlist', () => {
  const cfg = loadConfig({});
  assert.deepEqual(
    cfg,
    { port: 3000, allowedOrigins: ['http://localhost:4200'] },
  );
});

test('loadConfig reads PORT, the comma-separated allowlist and keys', () => {
  const cfg = loadConfig({
    PORT: '4100',
    ALLOWED_ORIGINS: ' https://a.example , https://b.example ,',
    CONFIRMTKT_API_KEY: 'k1',
    IRCTC_DEV_API_KEY: 'k2',
  });
  assert.equal(cfg.port, 4100);
  assert.deepEqual(cfg.allowedOrigins, ['https://a.example', 'https://b.example']);
  assert.equal(cfg.confirmtktApiKey, 'k1');
  assert.equal(cfg.irctcDevApiKey, 'k2');
});

test('health reports only ok and service, no provider details', async () => {
  await withApp(loadConfig({}), async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, service: 'railvaani-api' });
  });
});

test('CORS echoes an allowlisted origin and withholds any other', async () => {
  await withApp(loadConfig({}), async (base) => {
    const allowed = await fetch(`${base}/health`, { headers: { Origin: 'http://localhost:4200' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:4200');
    const other = await fetch(`${base}/health`, { headers: { Origin: 'https://elsewhere.example' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
  });
});

test('a bad request to /api/search answers in the standard error shape', async () => {
  await withApp(loadConfig({}), async (base) => {
    const res = await fetch(`${base}/api/search`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'bad_request');
    assert.equal(typeof body.error.message, 'string');
    assert.equal(Object.keys(body).length, 1);
  });
});

test('request 61 in a minute gets 429 rate_limited in the same shape', async () => {
  await withApp(loadConfig({}), async (base) => {
    for (let i = 0; i < 60; i += 1) {
      const res = await fetch(`${base}/api/search`);
      assert.equal(res.status, 400); // cheap rejection, still counts against the window
    }
    const res = await fetch(`${base}/api/search`);
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('retry-after')) > 0);
    const body = await res.json();
    assert.equal(body.error.code, 'rate_limited');
    assert.equal(typeof body.error.message, 'string');
  });
});

test('unknown paths answer 404 in the standard error shape', async () => {
  await withApp(loadConfig({}), async (base) => {
    const res = await fetch(`${base}/api/nothing`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'not_found');
  });
});
