import cors from 'cors';
import express from 'express';

import { ProviderError, Quota, TrainClass, TrainDataProvider } from '@railvaani/train-core';
import { findOptions, SplitQuery } from '@railvaani/split-engine';

import { ApiConfig } from './config.js';
import { Cache } from './cache.js';
import { ERROR_MESSAGES, sendError } from './errors.js';
import { rateLimiter } from './rate-limit.js';
import { buildProvider } from './providers.js';
import {
  isQuota,
  isStationCode,
  isTrainClass,
  isTrainNo,
  isValidDate,
  parseBudget,
} from './validate.js';

// Snapshot freshness: how long each cached answer stays servable. A cache hit
// re-serves the ORIGINAL fetchedAt, so the UI's snapshot label stays honest.
const SEARCH_TTL_MS = 60_000;
const AVAILABILITY_TTL_MS = 120_000;
const DAY_TTL_MS = 24 * 60 * 60 * 1000;

export interface AppDeps {
  /** Inject a provider in tests; production builds the composite provider. */
  provider?: TrainDataProvider;
}

/** Build the Express app: CORS allowlist, rate limiting, the one error shape,
 *  and the live data endpoints backed by the composite provider. */
export function buildApp(cfg: ApiConfig, deps: AppDeps = {}): express.Express {
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

  // Built once at startup: ConfirmTkt over erail, the same composite the web
  // app uses today. Tests inject their own provider here.
  const provider = deps.provider ?? buildProvider(cfg);
  const cache = new Cache<unknown>();

  /** One query string value, only when it arrived as a plain string. */
  const q = (req: express.Request, name: string): string | undefined => {
    const v = req.query[name];
    return typeof v === 'string' ? v : undefined;
  };

  /** The data endpoints need the ConfirmTkt key; without it they are not
   *  configured, and say so. /health stays up regardless. */
  const dataGate = (res: express.Response): boolean => {
    if (!cfg.confirmtktApiKey) {
      sendError(res, 503, 'not_configured', ERROR_MESSAGES.not_configured);
      return false;
    }
    return true;
  };

  /** Map a thrown error onto the standard shape. Provider-curated bad-request
   *  messages pass through; everything else is a plain-language failure and
   *  the detail stays in the server log. */
  const mapUpstreamError = (e: unknown, res: express.Response, what: string): void => {
    if (e instanceof ProviderError && e.kind === 'bad_request') {
      sendError(res, 400, 'bad_request', e.message);
      return;
    }
    if (e instanceof ProviderError) {
      sendError(res, 502, 'upstream_down', ERROR_MESSAGES.upstream_down);
      return;
    }
    console.error(`${what} failed`, e);
    sendError(res, 500, 'upstream_down', ERROR_MESSAGES.upstream_down);
  };

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'railvaani-api' });
  });

  // Live all-India search: trains + split options with LIVE availability,
  // server-side, exactly the data the results page renders.
  app.get('/api/search', async (req, res) => {
    const from = q(req, 'from')?.trim().toUpperCase() ?? '';
    const to = q(req, 'to')?.trim().toUpperCase() ?? '';
    const date = q(req, 'date') ?? '';
    const clsRaw = q(req, 'cls') ?? '';
    const quotaRaw = q(req, 'quota');
    const budget = parseBudget(q(req, 'budget'));

    const bad: string[] = [];
    if (!isStationCode(from)) bad.push('from must be a 2 to 5 letter station code.');
    if (!isStationCode(to)) bad.push('to must be a 2 to 5 letter station code.');
    if (isStationCode(from) && isStationCode(to) && from === to) {
      bad.push('from and to must be different stations.');
    }
    if (!isValidDate(date)) bad.push('date must be a YYYY-MM-DD date, today or later.');
    if (!isTrainClass(clsRaw)) bad.push('cls must be a known train class.');
    if (quotaRaw !== undefined && !isQuota(quotaRaw)) bad.push('quota must be one of GN, TQ, SR, LD, HP.');
    if (budget === null) bad.push('budget must be a positive number of rupees.');
    if (bad.length > 0) {
      sendError(res, 400, 'bad_request', bad[0] ?? 'The request is invalid.');
      return;
    }
    if (!dataGate(res)) return;

    const cls = clsRaw as TrainClass;
    const quota = (quotaRaw ?? 'GN') as Quota;
    const key = `search:${from}:${to}:${date}:${cls}:${quota}:${budget ?? 'none'}`;
    const cached = cache.get(key);
    if (cached) {
      res.json(cached);
      return;
    }
    const query: SplitQuery = {
      from,
      to,
      date,
      cls,
      quota,
      budgetPerHead: budget ?? undefined,
      availabilityMode: 'eager',
      maxDirects: 20,
      maxSplits: 8,
      excludeDeparted: true,
    };
    try {
      const options = await findOptions(provider, query);
      const body = { options, fetchedAt: new Date().toISOString() };
      cache.set(key, body, SEARCH_TTL_MS);
      res.json(body);
    } catch (e) {
      mapUpstreamError(e, res, `search ${from}-${to}`);
    }
  });

  // Every class's seat status for one train on one date: the per-date strip
  // and class table behind the option card.
  app.get('/api/availability', async (req, res) => {
    const trainNo = q(req, 'trainNo') ?? '';
    const date = q(req, 'date') ?? '';
    if (!isTrainNo(trainNo) || !isValidDate(date)) {
      sendError(res, 400, 'bad_request', 'trainNo must be a train number and date must be a YYYY-MM-DD date, today or later.');
      return;
    }
    if (!dataGate(res)) return;

    const key = `availability:${trainNo}:${date}`;
    const cached = cache.get(key);
    if (cached) {
      res.json(cached);
      return;
    }
    if (typeof provider.getAvailabilityAll !== 'function') {
      sendError(res, 502, 'upstream_down', ERROR_MESSAGES.upstream_down);
      return;
    }
    try {
      const availability = await provider.getAvailabilityAll(trainNo, date);
      const body = { availability, fetchedAt: new Date().toISOString() };
      cache.set(key, body, AVAILABILITY_TTL_MS);
      res.json(body);
    } catch (e) {
      mapUpstreamError(e, res, `availability ${trainNo}`);
    }
  });

  // Class-wise fares for one train over one leg; the provider serves these
  // from what a search already cached upstream.
  app.get('/api/fare-table', async (req, res) => {
    const trainNo = q(req, 'trainNo') ?? '';
    const from = q(req, 'from')?.trim().toUpperCase() ?? '';
    const to = q(req, 'to')?.trim().toUpperCase() ?? '';
    if (!isTrainNo(trainNo) || !isStationCode(from) || !isStationCode(to)) {
      sendError(res, 400, 'bad_request', 'trainNo, from and to are required: a train number and two station codes.');
      return;
    }
    if (!dataGate(res)) return;

    const key = `fare:${trainNo}:${from}:${to}`;
    const cached = cache.get(key);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      if (typeof provider.getFareTable !== 'function') {
        sendError(res, 502, 'upstream_down', ERROR_MESSAGES.upstream_down);
        return;
      }
      const fares = provider.getFareTable(trainNo, from, to);
      const body = { fares, fetchedAt: new Date().toISOString() };
      cache.set(key, body, DAY_TTL_MS);
      res.json(body);
    } catch (e) {
      mapUpstreamError(e, res, `fare table ${trainNo}`);
    }
  });

  // Ordered stop list for one train.
  app.get('/api/route', async (req, res) => {
    const trainNo = q(req, 'trainNo') ?? '';
    if (!isTrainNo(trainNo)) {
      sendError(res, 400, 'bad_request', 'trainNo must be a train number.');
      return;
    }
    if (!dataGate(res)) return;

    const key = `route:${trainNo}`;
    const cached = cache.get(key);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const stops = await provider.getRoute(trainNo);
      const body = { stops, fetchedAt: new Date().toISOString() };
      cache.set(key, body, DAY_TTL_MS);
      res.json(body);
    } catch (e) {
      mapUpstreamError(e, res, `route ${trainNo}`);
    }
  });

  app.get('/api/stations', async (req, res) => {
    const query = q(req, 'q')?.trim() ?? '';
    try {
      const stations = query ? await provider.searchStations(query) : (await provider.listStations()).slice(0, 50);
      res.json({ stations });
    } catch (e) {
      mapUpstreamError(e, res, 'station lookup');
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
