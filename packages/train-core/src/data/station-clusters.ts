/**
 * City station clusters (AGENTS.md, DATA CORRECTNESS): a city is served
 * through several stations, and a search for one must find arrivals at all
 * of them. Delhi arrivals land at NDLS, DLI, ANVT, NZM or SSB; a
 * station-strict search misses most of them.
 *
 * Every code must exist in the real station directory. The directory copy
 * this package tests against lives at data/stations.json (never imported by
 * runtime code, read only by the test, so web bundles stay small).
 */
export interface StationCluster {
  /** Human city key, e.g. 'Delhi'. */
  city: string;
  /** Every station code serving the city, in a stable order. */
  codes: readonly string[];
}

export const STATION_CLUSTERS: readonly StationCluster[] = [
  { city: 'Delhi', codes: ['NDLS', 'DLI', 'ANVT', 'NZM', 'SSB'] },
  { city: 'Lucknow', codes: ['LKO', 'LJN', 'GTNR'] },
  { city: 'Mumbai', codes: ['CSMT', 'BCT', 'BDTS', 'LTT', 'DR'] },
  { city: 'Kolkata', codes: ['HWH', 'SDAH', 'KOAA'] },
  { city: 'Chennai', codes: ['MAS', 'MS'] },
  { city: 'Bengaluru', codes: ['SBC', 'YPR', 'BNC'] },
  { city: 'Patna', codes: ['PNBE', 'RJPB'] },
  { city: 'Varanasi', codes: ['BSB', 'BCY'] },
  { city: 'Gorakhpur', codes: ['GKP', 'GKC'] },
  { city: 'Kanpur', codes: ['CNB', 'CPA'] },
];

const BY_CODE = new Map<string, StationCluster>();
for (const cluster of STATION_CLUSTERS) {
  for (const code of cluster.codes) BY_CODE.set(code, cluster);
}

/** The cluster a station code belongs to, or null when it stands alone. */
export function clusterOf(code: string): StationCluster | null {
  return BY_CODE.get(code.trim().toUpperCase()) ?? null;
}

/** Every station code to search for `code`: the whole cluster's codes, or
 *  just the code itself when it belongs to no cluster. */
export function clusterCodesFor(code: string): readonly string[] {
  return clusterOf(code)?.codes ?? [code.trim().toUpperCase()];
}
