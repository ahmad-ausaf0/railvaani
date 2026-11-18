import cors from 'cors';
import express from 'express';

import {
  ProviderError,
  Quota,
  SearchClass,
  TrainClass,
  TrainDataProvider,
  clusterCodesFor,
  clusterOf,
} from '@railvaani/train-core';
import { findOptions, SplitOption, SplitQuery } from '@railvaani/split-engine';

import { ApiConfig } from './config.js';
import { IrctcDevClient } from './irctcdev-client.js';
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
/** Fare disagreement above this many rupees between ConfirmTkt and irctc.dev
 *  gets a server-side warning. The disagreement itself never reaches a caller. */
const FARE_MISMATCH_RUPEES = 10;
/** Output caps for /api/search, re-applied after cluster merging so a burst
 *  of city pairs cannot flood the caller. */
const SEARCH_MAX_DIRECTS = 20;
const SEARCH_MAX_SPLITS = 8;

export interface AppDeps {
  /** Inject a provider in tests; production builds the composite provider. */
  provider?: TrainDataProvider;
  /** Inject an irctc.dev client in tests (null = none). Production builds
   *  one when IRCTC_DEV_API_KEY is set, and nothing otherwise. */
  irctcDev?: IrctcDevClient | null;
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
  // irctc.dev: schedules and fares only. Its availability is segment-blind
  // and is never read here; the client exposes no availability method.
  const irctcDev =
    deps.irctcDev ?? (cfg.irctcDevApiKey ? new IrctcDevClient({ apiKey: cfg.irctcDevApiKey }) : null);

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
    // The web app is class-free: an absent cls and the literal ANY both
    // mean the Any-class search (each option picks its cheapest bookable
    // class). Only an unknown non-ANY class is a bad request.
    if (clsRaw !== '' && clsRaw !== 'ANY' && !isTrainClass(clsRaw)) {
      bad.push('cls must be a known train class.');
    }
    if (quotaRaw !== undefined && !isQuota(quotaRaw)) bad.push('quota must be one of GN, TQ, SR, LD, HP.');
    if (budget === null) bad.push('budget must be a positive number of rupees.');
    if (bad.length > 0) {
      sendError(res, 400, 'bad_request', bad[0] ?? 'The request is invalid.');
      return;
    }
    if (!dataGate(res)) return;

    const cls: SearchClass = clsRaw === '' || clsRaw === 'ANY' ? 'ANY' : (clsRaw as TrainClass);
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
      maxDirects: SEARCH_MAX_DIRECTS,
      maxSplits: SEARCH_MAX_SPLITS,
      excludeDeparted: true,
    };
    // City clusters (AGENTS.md, DATA CORRECTNESS): a clustered station
    // expands to every station serving its city, on both ends. Each pair is
    // searched independently (at most 4 in parallel; one failing pair never
    // kills the rest), results merge and dedupe by train number + departure
    // time, and every option keeps its ACTUAL boarding/alighting stations.
    const fromCodes = clusterCodesFor(from);
    const toCodes = clusterCodesFor(to);
    const expandedFrom = fromCodes.length > 1 ? [...fromCodes] : [];
    const expandedTo = toCodes.length > 1 ? [...toCodes] : [];
    const pairs: Array<readonly [string, string]> = [];
    for (const f of fromCodes) {
      for (const t of toCodes) {
        if (f !== t) pairs.push([f, t]);
      }
    }
    let hiddenTotal = 0;
    let partial = false;
    try {
      let options: SplitOption[];
      if (pairs.length === 1) {
        // No cluster involved: the engine's own output, unchanged.
        const only: readonly [string, string] = pairs[0] ?? [from, to];
        const hidden = { count: 0 };
        options = await findOptions(provider, {
          ...query,
          from: only[0],
          to: only[1],
          hiddenByBudget: hidden,
        });
        hiddenTotal = hidden.count;
      } else {
        const perPair: Array<SplitOption[] | undefined> = new Array(pairs.length);
        let failed = 0;
        let lastError: unknown;
        let next = 0;
        const worker = async (): Promise<void> => {
          while (next < pairs.length) {
            const i = next++;
            const pair = pairs[i];
            if (!pair) continue;
            try {
              const hidden = { count: 0 };
              perPair[i] = await findOptions(provider, {
                ...query,
                from: pair[0],
                to: pair[1],
                hiddenByBudget: hidden,
              });
              hiddenTotal += hidden.count;
            } catch (e) {
              failed += 1;
              lastError = e;
              perPair[i] = [];
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(4, pairs.length) }, () => worker()));
        if (failed === pairs.length) throw lastError;
        partial = failed > 0;
        // Dedupe by train number + departure time per leg, keeping the first
        // sighting. Directs first, then splits, each group chronological.
        const seen = new Set<string>();
        const directs: SplitOption[] = [];
        const splits: SplitOption[] = [];
        for (const group of perPair) {
          for (const option of group ?? []) {
            const legKey = option.legs
              .map((l) => `${l.trainNumber}@${l.from}:${l.depTime}`)
              .join('|');
            if (seen.has(legKey)) continue;
            seen.add(legKey);
            (option.type === 'direct' ? directs : splits).push(option);
          }
        }
        const byDep = (a: SplitOption, b: SplitOption): number =>
          (a.legs[0]?.depTime ?? '').localeCompare(b.legs[0]?.depTime ?? '');
        directs.sort(byDep);
        splits.sort(byDep);
        // The engine caps each pair's own output; the merge does not, so
        // the same caps are re-applied over the merged, deduped list.
        options = [...directs.slice(0, SEARCH_MAX_DIRECTS), ...splits.slice(0, SEARCH_MAX_SPLITS)];
      }
      // City names ride along so the web's header note can say which
      // city's stations were searched without importing cluster data.
      const expandedFromCity = expandedFrom.length > 0 ? clusterOf(from)?.city : undefined;
      const expandedToCity = expandedTo.length > 0 ? clusterOf(to)?.city : undefined;
      const body = {
        options,
        fetchedAt: new Date().toISOString(),
        expandedFrom,
        expandedTo,
        expandedFromCity,
        expandedToCity,
        hiddenByBudget: hiddenTotal,
        partial: partial || undefined,
      };
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
      const ctFares = provider.getFareTable(trainNo, from, to);
      const fares: Record<string, number> = {};
      for (const [cls, fare] of Object.entries(ctFares)) {
        if (fare !== undefined) fares[cls] = fare;
      }
      // irctc.dev is the secondary fare source: ConfirmTkt wins where both
      // list the class, irctc.dev fills the gaps, and a disagreement above
      // FARE_MISMATCH_RUPEES is logged server-side only. The response keeps
      // exactly one fare per class.
      if (irctcDev) {
        try {
          const devFares = await irctcDev.getFare(trainNo, from, to);
          for (const [cls, devFare] of Object.entries(devFares)) {
            if (!isTrainClass(cls)) continue;
            const ctFare = ctFares[cls];
            if (ctFare !== undefined && Math.abs(ctFare - devFare) > FARE_MISMATCH_RUPEES) {
              console.warn(
                `fare disagreement ${trainNo} ${from}-${to} ${cls}: confirmtkt ${ctFare} vs irctc.dev ${devFare}`,
              );
            }
            if (fares[cls] === undefined) fares[cls] = devFare;
          }
        } catch {
          // A failed secondary source must never break the fare table.
        }
      }
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

  // Full schedule, halts and timings for one train, from irctc.dev, whose
  // schedules were accurate in the spike. Its availability is segment-blind
  // and is never read here; this endpoint carries no seat data at all.
  app.get('/api/schedule', async (req, res) => {
    const trainNo = q(req, 'trainNo') ?? '';
    if (!isTrainNo(trainNo)) {
      sendError(res, 400, 'bad_request', 'trainNo must be a train number.');
      return;
    }
    if (!irctcDev) {
      sendError(res, 503, 'not_configured', ERROR_MESSAGES.not_configured);
      return;
    }

    const key = `schedule:${trainNo}`;
    const cached = cache.get(key);
    if (cached) {
      res.json(cached);
      return;
    }
    try {
      const schedule = await irctcDev.getSchedule(trainNo);
      const body = { ...schedule, fetchedAt: new Date().toISOString() };
      cache.set(key, body, DAY_TTL_MS);
      res.json(body);
    } catch (e) {
      mapUpstreamError(e, res, `schedule ${trainNo}`);
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
