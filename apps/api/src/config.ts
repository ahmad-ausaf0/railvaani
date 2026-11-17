/** Startup configuration, read once from the environment. Nothing else in the
 *  API reads process.env directly; everything takes its values from here. */
export interface ApiConfig {
  port: number;
  /** Origins the browser may call the API from; anything else gets no CORS
   *  headers. Comma-separated in ALLOWED_ORIGINS. */
  allowedOrigins: string[];
  /** Live seat/fare data key. No default: without it some upstream calls
   *  cannot run, so startup logs a clear warning. */
  confirmtktApiKey?: string;
  /** Optional secondary key for development data. */
  irctcDevApiKey?: string;
}

/** Parse one config from an environment map (defaults to the real one).
 *  Unknown names in the map are ignored. */
export function loadConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const rawPort = env['PORT'];
  const port = rawPort && Number.isFinite(Number(rawPort)) ? Number(rawPort) : 3000;
  const origins = (env['ALLOWED_ORIGINS'] ?? 'http://localhost:4200')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const cfg: ApiConfig = {
    port,
    allowedOrigins: origins.length > 0 ? origins : ['http://localhost:4200'],
  };
  if (env['CONFIRMTKT_API_KEY']) cfg.confirmtktApiKey = env['CONFIRMTKT_API_KEY'];
  if (env['IRCTC_DEV_API_KEY']) cfg.irctcDevApiKey = env['IRCTC_DEV_API_KEY'];
  return cfg;
}
