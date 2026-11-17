import cors from 'cors';
import express from 'express';

import { ErailProvider, MAJOR_STATIONS, TrainClass } from '@railvaani/train-core';
import { findOptions, SplitQuery } from '@railvaani/split-engine';
import { ProviderError } from '@railvaani/train-core';

import { ApiConfig } from './config.js';
import { ERROR_MESSAGES, sendError } from './errors.js';
import { rateLimiter } from './rate-limit.js';

/** Build the Express app. Owns CORS, rate limiting and the one error shape;
 *  exported so tests can drive it without a port. */
export function buildApp(cfg: ApiConfig): express.Express {
  const app = express();
  app.disable('x-powered-by');

  // Only origins on the allowlist get CORS headers. Other origins pass the
  // request through with none (the browser blocks the read); we never reflect
  // an arbitrary origin.
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || cfg.allowedOrigins.includes(origin)) cb(null, true);
        else cb(null, false);
      },
    }),
  );
  app.use(express.json());
  app.use('/api', rateLimiter());

  const provider = new ErailProvider({
    stationDirectory: MAJOR_STATIONS.map(([code, name]) => ({
      code,
      name,
      zone: '',
      isJunction: false,
    })),
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'railvaani-api' });
  });

  // Live all-India search: trains + split options straight from erail's public data.
  app.get('/api/search', async (req, res) => {
    const { from, to, date, cls, quota, budget } = req.query as Record<string, string>;
    if (!from || !to || !date || !cls) {
      sendError(res, 400, 'bad_request', 'from, to, date and cls are required.');
      return;
    }
    try {
      const query: SplitQuery = {
        from: String(from).toUpperCase(),
        to: String(to).toUpperCase(),
        date: String(date),
        cls: String(cls).toUpperCase() as TrainClass,
        ...(quota ? { quota: String(quota).toUpperCase() as never } : {}),
        ...(budget && Number(budget) > 0 ? { budgetPerHead: Number(budget) } : {}),
        availabilityMode: 'deferred',
        maxResults: 12,
      };
      const options = await findOptions(provider, query);
      res.json({ options });
    } catch (e) {
      if (e instanceof ProviderError) {
        sendError(res, 502, 'upstream_down', ERROR_MESSAGES.upstream_down);
      } else {
        // Unexpected failure: log with context server-side, answer generically.
        console.error(`search failed for ${from}->${to}`, e);
        sendError(res, 500, 'upstream_down', ERROR_MESSAGES.upstream_down);
      }
    }
  });

  app.get('/api/stations', async (req, res) => {
    const q = String(req.query['q'] ?? '').trim();
    try {
      const stations = q ? await provider.searchStations(q) : (await provider.listStations()).slice(0, 50);
      res.json({ stations });
    } catch (e) {
      console.error('station lookup failed', e);
      sendError(res, 502, 'upstream_down', ERROR_MESSAGES.upstream_down);
    }
  });

  // Voice privacy: the browser never uploads audio. Only the transcript text of the
  // user's sentence reaches this server, and it is never logged with any PII.

  app.use((_req, res) => {
    sendError(res, 404, 'not_found', ERROR_MESSAGES.not_found);
  });

  // Catch-all: anything an async route left unhandled lands here. Stack traces
  // never leave the server; the log carries them instead.
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(`unhandled error on ${req.method} ${req.path}`, err);
    sendError(res, 500, 'upstream_down', ERROR_MESSAGES.upstream_down);
  });

  return app;
}
