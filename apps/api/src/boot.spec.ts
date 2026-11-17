import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/** Boot smoke check: run the PRODUCTION start path (plain Node, compiled
 *  output, the boot resolver registered) and read /health over HTTP. Guards
 *  against the compiled build regressing into something tsx can only run. */

function packageRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url));
}

async function waitForBoot(child: ChildProcess): Promise<number> {
  const chunks: Buffer[] = [];
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not report a port in 15s')), 15_000);
    child.stdout!.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      const match = /listening on port (\d+)/.exec(Buffer.concat(chunks).toString());
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited before reporting a port (code ${code})`));
    });
  });
  return port;
}

test('production start boots under plain Node and /health answers the health body', async () => {
  const child = spawn('node', ['--import', './boot/register.mjs', 'dist/main.js'], {
    cwd: packageRoot(),
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    const port = await waitForBoot(child);
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, service: 'railvaani-api' });
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));
  }
});
