import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
import { buildApp } from './app.js';

// Pick up a local .env when present (optional; real env vars always win since
// loadEnvFile does not overwrite existing keys).
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  // No .env file: nothing to load.
}

const cfg = loadConfig();

if (!cfg.confirmtktApiKey) {
  console.warn(
    '[railvaani-api] CONFIRMTKT_API_KEY is not set. Live seat and fare data that needs it will be unavailable.',
  );
}

const app = buildApp(cfg);
const server = app.listen(cfg.port, () => {
  // PORT=0 binds an ephemeral port; report the address actually bound.
  const bound = (server.address() as AddressInfo | null)?.port ?? cfg.port;
  console.log(`railvaani-api listening on port ${bound}`);
});
