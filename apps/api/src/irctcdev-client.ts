/**
 * irctc.dev client. API-only on purpose: nothing in the browser may reach
 * it, and it lives here so it cannot be imported by web code.
 *
 * HARD RULE (12 Nov spike): irctc.dev availability is segment-blind -- it
 * returned identical seat status for GKP->NDLS, GKP->LKO and LKO->NDLS -- so
 * it must never feed a seat status in this app. This client therefore
 * exposes NO availability method; do not add one. Its schedules and fares
 * were accurate in the spike (the fare matched ConfirmTkt to the rupee).
 *
 * Endpoint paths, read 18 Nov 2026 from the service's own live
 * documentation (irctc.dev/docs and irctc.dev/postman_collection.json):
 *   train search: GET /api/v1/trains/search?from=&to=
 *   schedule:     GET /api/v1/trains/:trainNo            (full schedule, halts, timings)
 *   fare:         GET /api/v1/trains/:trainNo/fare?from=&to=&class=all&quota=GN
 * Auth: x-api-key header (Bearer and api_key query also documented).
 */
import { ProviderError } from '@railvaani/train-core';

/** One stop of a train's full schedule. day is the 0-based day offset from
 *  the train's origin, matching Stop.day elsewhere in the app. */
export interface IrctcDevScheduleStop {
  seq: number;
  code: string;
  name: string;
  arr: string | null;
  dep: string | null;
  day: number;
  haltMins: number;
  distanceKm: number;
}

export interface IrctcDevSchedule {
  trainNo: string;
  trainName: string;
  runningDays: string[];
  originCode: string;
  destinationCode: string;
  stops: IrctcDevScheduleStop[];
}

/** Raw class code -> total fare for the queried segment. Class codes outside
 *  the app's TrainClass set stay in here; the fare-table merge filters. */
export type IrctcDevFares = Record<string, number>;

/** Direct trains found between two stations (search endpoint). */
export interface IrctcDevTrain {
  number: string;
  name: string;
  from: string;
  to: string;
  depTime: string;
  arrTime: string;
  durationMins: number;
  runsOn: string[];
}

const REQUEST_TIMEOUT_MS = 8_000;

/** The gateway answers { success, data } on every documented endpoint. */
interface IrctcDevEnvelope {
  success?: boolean;
  data?: unknown;
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

export class IrctcDevClient {
  private readonly base: string;
  private readonly apiKey: string;

  constructor(opts: { apiKey: string; baseUrl?: string }) {
    this.base = (opts.baseUrl ?? 'https://api.irctc.dev').replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
  }

  /** Direct trains between two stations (GET /api/v1/trains/search). Not
   *  wired to an endpoint yet; kept here because the service documents it
   *  beside the other two calls this app uses. */
  async searchTrains(from: string, to: string): Promise<IrctcDevTrain[]> {
    const path = `/api/v1/trains/search?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const data = asRecord(await this.request(path, `search ${from}-${to}`));
    const rows = Array.isArray(data['trains']) ? data['trains'] : [];
    return rows.map((row) => {
      const r = asRecord(row);
      return {
        number: String(r['trainNo'] ?? r['number'] ?? ''),
        name: String(r['trainName'] ?? r['name'] ?? ''),
        from: String(r['from'] ?? r['source'] ?? from),
        to: String(r['to'] ?? r['destination'] ?? to),
        depTime: String(r['departure'] ?? r['depTime'] ?? ''),
        arrTime: String(r['arrival'] ?? r['arrTime'] ?? ''),
        durationMins: Number(r['duration'] ?? r['durationMins'] ?? 0),
        runsOn: Array.isArray(r['runningDays'] ?? r['runsOn'])
          ? ((r['runningDays'] ?? r['runsOn']) as unknown[]).map(String)
          : [],
      };
    });
  }

  /** Full schedule, halts and timings for one train (GET
   *  /api/v1/trains/:trainNo). This is schedule data only. */
  async getSchedule(trainNo: string): Promise<IrctcDevSchedule> {
    const data = asRecord(
      await this.request(`/api/v1/trains/${encodeURIComponent(trainNo)}`, `schedule ${trainNo}`),
    );
    const stations = Array.isArray(data['stations']) ? data['stations'] : [];
    return {
      trainNo: String(data['trainNo'] ?? trainNo),
      trainName: String(data['trainName'] ?? ''),
      runningDays: Array.isArray(data['runningDays']) ? data['runningDays'].map(String) : [],
      originCode: String(data['originCode'] ?? ''),
      destinationCode: String(data['destinationCode'] ?? ''),
      stops: stations.map((row) => {
        const s = asRecord(row);
        return {
          seq: Number(s['seq'] ?? 0),
          code: String(s['code'] ?? ''),
          name: String(s['name'] ?? ''),
          arr: s['arrival'] == null ? null : String(s['arrival']),
          dep: s['departure'] == null ? null : String(s['departure']),
          day: Number(s['dayOffset'] ?? 0),
          haltMins: Number(s['haltMinutes'] ?? 0),
          distanceKm: Number(s['distanceKm'] ?? 0),
        };
      }),
    };
  }

  /** Fare breakup for one train between two stations (GET
   *  /api/v1/trains/:trainNo/fare?from=&to=&class=all&quota=GN). Returns one
   *  total per class code; unknown class codes pass through for the merge
   *  to filter. No availability on this client, by design. */
  async getFare(trainNo: string, from: string, to: string): Promise<IrctcDevFares> {
    const path = `/api/v1/trains/${encodeURIComponent(trainNo)}/fare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&class=all&quota=GN`;
    const data = asRecord(await this.request(path, `fare ${trainNo}`));
    const rows = Array.isArray(data['fares'])
      ? data['fares']
      : Array.isArray(data['fareBreakup'])
        ? data['fareBreakup']
        : [];
    const fares: IrctcDevFares = {};
    for (const row of rows) {
      const r = asRecord(row);
      const cls = r['class'] ?? r['cls'] ?? r['travelClass'];
      const total = r['total'] ?? r['totalFare'] ?? r['grandTotal'] ?? r['fare'];
      if (typeof cls === 'string' && typeof total === 'number' && Number.isFinite(total)) {
        fares[cls.toUpperCase()] = total;
      }
    }
    return fares;
  }

  /** One authenticated GET: 8 s timeout, one retry (AGENTS.md
   *  PERFORMANCE), and the documented { success, data } envelope. */
  private async request(path: string, what: string): Promise<unknown> {
    let lastError: unknown = new ProviderError(
      'provider_down',
      `${what}: irctc.dev could not be reached.`,
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${this.base}${path}`, {
          headers: { accept: 'application/json', 'x-api-key': this.apiKey },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          throw new ProviderError('provider_down', `${what}: irctc.dev returned ${res.status}.`);
        }
        const body = (await res.json()) as IrctcDevEnvelope;
        if (!body || body.success === false) {
          throw new ProviderError('provider_down', `${what}: irctc.dev reported failure.`);
        }
        return body.data;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }
}
