/**
 * Downloads erail's full station list (~9,300 Indian Railways stations) at build
 * time and writes public/stations.json as [[code, name], ...] pairs. Erail's
 * stations.js is the same file erail's own autocomplete uses.
 *
 * Any failure exits 0: the app bundles ~160 major stations in code and keeps
 * working with those, so a flaky fetch never breaks a deploy.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const URL_ = 'https://erail.in/js/cmp/stations.js';
try {
  const res = await fetch(URL_, { headers: { 'User-Agent': 'RailVaani build' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const js = await res.text();
  const start = js.indexOf('="') + 2;
  const end = js.lastIndexOf('"');
  const parts = js.slice(start, end).split(',');
  const out = [];
  const seen = new Set();
  for (let i = 2; i + 1 < parts.length; i += 2) {
    const code = (parts[i] ?? '').trim();
    const name = (parts[i + 1] ?? '').trim();
    if (!/^[A-Z0-9]{2,5}$/.test(code)) continue;
    if (!name || /^\d+$/.test(name)) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push([code, name]);
  }
  if (out.length < 1000) throw new Error(`only ${out.length} stations parsed`);
  mkdirSync('public', { recursive: true });
  writeFileSync('public/stations.json', JSON.stringify(out));
  console.log(`fetch-stations: wrote ${out.length} stations`);
} catch (e) {
  console.log(`fetch-stations: skipped (${e.message}); using bundled major stations`);
}
