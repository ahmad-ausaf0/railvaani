import type { Station } from '@railvaani/train-core';

export interface VoiceIntent {
  from?: Station;
  to?: Station;
}

/** Words that carry no station meaning in a spoken search
 *  ("mujhe Gorakhpur se Delhi jana hai", "from Patna to Mumbai please"). */
const FILLER_WORDS = new Set([
  'a', 'the', 'for', 'me', 'ki', 'ka', 'chal', 'hai', 'jana', 'mujhe',
  'please', 'tomorrow', 'today', 'kal', 'aaj', 'ticket', 'train', 'trains',
  'book', 'from', 'to', 'se',
  'मुझे', 'जाना', 'है', 'कल', 'आज', 'की', 'का', 'से',
]);

/** A bare spoken city name that matches several stations must land on the
 *  city's main station: "Delhi" is New Delhi (NDLS), not Old Delhi (DLI,
 *  which the directory lists under the plain name "Delhi") and not Delhi
 *  Cantt. Keyed on the exact spoken phrase, so "Delhi Cantt" still resolves
 *  to DEC by exact name. */
const MAIN_CITY_STATION: Readonly<Record<string, string>> = { delhi: 'NDLS' };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when phrase appears in text as whole words (both sides padded). */
function wholeWordAt(text: string, phrase: string): boolean {
  return new RegExp(`(^|\\s)${escapeRegExp(phrase)}($|\\s)`).test(text);
}

/** Hears a sentence, finds the two stations in it. One pure method, no
 *  Angular dependencies, so it unit-tests directly under node:test. */
export class VoiceIntentService {
  parse(transcript: string, stations: readonly Station[]): VoiceIntent {
    const said = transcript.trim();
    if (!said) return {};

    const split = this.fromSplit(said, stations);
    const known = [split.from, split.to].filter((s): s is Station => !!s);
    if (known.length === 2) return { from: split.from, to: split.to };

    // Split failed or resolved only one side: scan the transcript for
    // station names in spoken order instead.
    const scan = this.scanTranscript(said, stations)
      .filter((s) => s.code !== known[0]?.code);
    if (known.length === 1) {
      if (!scan[0]) return { from: known[0] };
      return split.from
        ? { from: known[0], to: scan[0] }
        : { from: scan[0], to: known[0] };
    }
    return { from: scan[0], to: scan[1] };
  }

  /** First pass: explicit "from X to Y", "X to Y", "X se Y", "X से Y". */
  private fromSplit(
    said: string,
    stations: readonly Station[],
  ): { from?: Station; to?: Station } {
    const markers = [...said.matchAll(/\b(?:from|to|se)\b|से/gi)];
    const first = markers[0];
    if (!first) return {};
    if (first[0].toLowerCase() === 'from') {
      const next = markers[1];
      const fromSide = next
        ? said.slice(first.index! + first[0].length, next.index)
        : said.slice(first.index! + first[0].length);
      const toSide = next ? said.slice(next.index! + next[0].length) : '';
      return {
        from: this.resolveSide(fromSide, stations),
        to: this.resolveSide(toSide, stations),
      };
    }
    return {
      from: this.resolveSide(said.slice(0, first.index), stations),
      to: this.resolveSide(said.slice(first.index! + first[0].length), stations),
    };
  }

  private resolveSide(side: string, stations: readonly Station[]): Station | undefined {
    const tokens = side
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t && !FILLER_WORDS.has(t));
    if (tokens.length === 0) return undefined;
    return this.resolveStation(tokens.join(' '), stations);
  }

  /** Same ladder as StationsService.resolve (exact code, exact name,
   *  contains) refined per the voice rules: a bare city word lands on the
   *  main station, containing matches prefer the shortest name so "Delhi"
   *  cannot land on Delhi Cantt, and a phrase longer than any name falls
   *  back to its longest token ("Gorakhpur Junction"). */
  private resolveStation(phrase: string, stations: readonly Station[]): Station | undefined {
    const v = phrase.trim().toLowerCase();
    if (!v) return undefined;
    const upper = phrase.trim().toUpperCase();
    const byCode = stations.find((s) => s.code.toUpperCase() === upper);
    if (byCode) return byCode;
    const mainCode = MAIN_CITY_STATION[v];
    if (mainCode) {
      const main = stations.find((s) => s.code === mainCode);
      if (main) return main;
    }
    const exact = stations.find((s) => s.name.toLowerCase() === v);
    if (exact) return exact;
    let best: Station | undefined;
    for (const s of stations) {
      if (wholeWordAt(s.name.toLowerCase(), v) && (!best || s.name.length < best.name.length)) {
        best = s;
      }
    }
    if (best) return best;
    const tokens = v.split(/\s+/).filter((t) => t !== v && !FILLER_WORDS.has(t));
    tokens.sort((a, b) => b.length - a.length);
    for (const t of tokens) {
      const hit = this.resolveStation(t, stations);
      if (hit) return hit;
    }
    return undefined;
  }

  /** Second pass: spot directory names in the sentence, longest names first
   *  on word boundaries, reported in spoken order; falls back to scanning
   *  the remaining (non-filler) words one by one. */
  private scanTranscript(said: string, stations: readonly Station[]): Station[] {
    const norm =
      ' ' +
      said
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim() +
      ' ';
    const hits: { s: Station; start: number; end: number }[] = [];
    for (const s of stations) {
      const name = s.name.toLowerCase();
      const idx = norm.indexOf(' ' + name + ' ');
      if (idx >= 0) {
        // Real span without the padding spaces, so adjacent names ("Gorakhpur
        // Lucknow") sharing one space do not count as overlapping.
        const start = idx + 1;
        hits.push({ s, start, end: start + name.length });
      }
    }
    hits.sort((a, b) => b.end - b.start - (a.end - a.start));
    const picked: { s: Station; start: number }[] = [];
    const taken: { start: number; end: number }[] = [];
    for (const h of hits) {
      if (taken.some((t) => h.start < t.end && t.start < h.end)) continue;
      taken.push(h);
      picked.push({ s: h.s, start: h.start });
    }
    if (picked.length) {
      return picked.sort((a, b) => a.start - b.start).map((p) => p.s);
    }
    const out: Station[] = [];
    const seen = new Set<string>();
    for (const t of norm.trim().split(' ').filter((w) => w && !FILLER_WORDS.has(w))) {
      const hit = this.resolveStation(t, stations);
      if (hit && !seen.has(hit.code)) {
        seen.add(hit.code);
        out.push(hit);
      }
    }
    return out;
  }
}
