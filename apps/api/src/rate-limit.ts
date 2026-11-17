import type { NextFunction, Request, Response } from 'express';
import { ERROR_MESSAGES, sendError } from './errors.js';

/** Simple in-memory rate limiter: a fixed window of `limit` requests per IP
 *  per `windowMs` (60 per minute by default). Mounted once across /api/*.
 *  The window table is bounded: stale windows are pruned once the map grows
 *  past 10,000 addresses. */
export function rateLimiter(
  { limit = 60, windowMs = 60_000, now = Date.now }:
    { limit?: number; windowMs?: number; now?: () => number } = {},
) {
  const windows = new Map<string, { count: number; windowStart: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const t = now();
    const key = req.ip ?? 'unknown';
    if (windows.size > 10_000) {
      for (const [k, w] of windows) {
        if (t - w.windowStart >= windowMs) windows.delete(k);
      }
    }
    let w = windows.get(key);
    if (!w || t - w.windowStart >= windowMs) {
      w = { count: 0, windowStart: t };
      windows.set(key, w);
    }
    w.count += 1;
    if (w.count > limit) {
      res.setHeader('Retry-After', String(Math.ceil((w.windowStart + windowMs - t) / 1000)));
      sendError(res, 429, 'rate_limited', ERROR_MESSAGES.rate_limited);
      return;
    }
    next();
  };
}
