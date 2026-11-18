import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { STATION_CLUSTERS, clusterCodesFor, clusterOf } from './station-clusters';

/** The real station directory ([code, name] pairs), read from disk so no
 *  runtime import ever pulls it into a bundle. */
const directory = new Map<string, string>(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../data/stations.json', import.meta.url)), 'utf8')) as Array<[string, string]>,
);

test('every cluster code exists in the real station directory', () => {
  const missing: string[] = [];
  for (const cluster of STATION_CLUSTERS) {
    assert.ok(cluster.codes.length >= 2, `${cluster.city} must list at least two stations`);
    for (const code of cluster.codes) {
      if (!directory.has(code)) missing.push(`${cluster.city}: ${code}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `cluster codes missing from the station directory: ${missing.join(', ')}`,
  );
});

test('no station code belongs to two clusters', () => {
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const cluster of STATION_CLUSTERS) {
    for (const code of cluster.codes) {
      const owner = seen.get(code);
      if (owner && owner !== cluster.city) dupes.push(`${code}: ${owner} and ${cluster.city}`);
      seen.set(code, cluster.city);
    }
  }
  assert.deepEqual(dupes, [], `codes claimed by two clusters: ${dupes.join(', ')}`);
});

test('clusterCodesFor expands clustered codes and passes others through', () => {
  assert.deepEqual(clusterCodesFor('NDLS'), ['NDLS', 'DLI', 'ANVT', 'NZM', 'SSB']);
  assert.deepEqual(clusterCodesFor('gkp'), ['GKP', 'GKC']);
  assert.deepEqual(clusterCodesFor('GTNR'), ['LKO', 'LJN', 'GTNR']);
  assert.deepEqual(clusterCodesFor('ASR'), ['ASR']);
  assert.equal(clusterOf('ASR'), null);
});
