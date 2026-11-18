import {
  ConfirmTktProvider,
  ErailProvider,
  MAJOR_STATIONS,
  TrainDataProvider,
} from '@railvaani/train-core';

import { ApiConfig } from './config.js';

/** The composite provider the server runs: ConfirmTkt over erail, built once
 *  at startup. Server-side calls hit erail directly (no CORS relay needed,
 *  unlike the browser path) and keep the same polite pacing. The ConfirmTkt
 *  key comes from config only; nothing here hardcodes one. */
export function buildProvider(cfg: ApiConfig): TrainDataProvider {
  const erail = new ErailProvider({
    stationDirectory: MAJOR_STATIONS.map(([code, name]) => ({
      code,
      name,
      zone: '',
      isJunction: false,
    })),
    minIntervalMs: 300,
    maxConcurrency: 3,
  });
  return new ConfirmTktProvider(
    erail,
    cfg.confirmtktApiKey ? { apiKey: cfg.confirmtktApiKey } : {},
  );
}
