import { Injectable, signal } from '@angular/core';

import { MAJOR_STATIONS, Station } from '@railvaani/train-core';

function toStation([code, name]: readonly [string, string]): Station {
  return { code, name, zone: '', isJunction: /jn|junction/i.test(name) };
}

/** All-India station directory: full list loads lazily from an asset; the bundled
 *  major-station list keeps autocomplete and voice parsing working until then. */
@Injectable({ providedIn: 'root' })
export class StationsService {
  readonly stations = signal<Station[]>(MAJOR_STATIONS.map(toStation));
  readonly loaded = signal(false);

  async init(): Promise<void> {
    if (this.loaded()) return;
    try {
      const res = await fetch('stations.json');
      if (res.ok) {
        const rows = (await res.json()) as [string, string][];
        if (Array.isArray(rows) && rows.length > 100) {
          this.stations.set(rows.map(toStation));
        }
      }
    } catch {
      // Bundled majors remain the directory; search still works for big stations.
    }
    this.loaded.set(true);
  }

  search(query: string): Station[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const byCode: Station[] = [];
    const byName: Station[] = [];
    for (const s of this.stations()) {
      if (s.code.toLowerCase().startsWith(q)) byCode.push(s);
      else if (s.name.toLowerCase().includes(q)) byName.push(s);
      if (byCode.length >= 8 && byName.length >= 8) break;
    }
    return [...byCode, ...byName].slice(0, 12);
  }

  resolve(input: string): Station | null {
    const v = input.trim();
    if (!v) return null;
    const upper = v.toUpperCase();
    const lower = v.toLowerCase();
    const all = this.stations();
    return (
      all.find((s) => s.code.toUpperCase() === upper) ??
      all.find((s) => s.name.toLowerCase() === lower) ??
      all.find((s) => s.name.toLowerCase().includes(lower)) ??
      null
    );
  }

  name(code?: string | null): string {
    if (!code) return '';
    return this.stations().find((s) => s.code === code)?.name ?? code;
  }
}
