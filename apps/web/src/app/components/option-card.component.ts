import { Component, computed, inject, input } from '@angular/core';

import { Availability, CLASS_LABELS } from '@railvaani/train-core';
import { SplitOption } from '@railvaani/split-engine';

import { StationsService } from '../services/stations.service';
import { addDaysISO, arrDayDelta, fmtDuration, fmtShortDate, legDurationMins } from '../shared/leg-times';

/** Per-class fares and seat status for one direct train, fetched by the app. */
export interface ClassDetail {
  fares: Partial<Record<string, number>>;
  avail: Partial<Record<string, Availability>>;
  /** Seat status for the selected class across recent dates; keyed YYYY-MM-DD. */
  dateWise?: Partial<Record<string, Availability>>;
  /** The dates dateWise is keyed by, in display order. */
  dateWiseDates?: string[];
  /** Label of the class the date strip shows, e.g. 'Sleeper'. */
  dateWiseLabel?: string;
}

type StampTone = 'rv-stamp-ok' | 'rv-stamp-warn' | 'rv-stamp-bad' | 'rv-stamp-muted';
type AvailTone = 'rv-avail-ok' | 'rv-avail-warn' | 'rv-avail-bad' | 'rv-avail-muted';

/** Pure presentation: a seat status to its stamp colour class.
 *  Bookable or confirmed green, waitlist amber, regret red, unchecked muted. */
function stampTone(a?: { state?: string } | null): StampTone {
  const s = a?.state ?? '';
  if (s === 'AVAILABLE' || s === 'RAC') return 'rv-stamp-ok';
  if (s === 'WL') return 'rv-stamp-warn';
  if (s === 'REGRET' || s === 'NOT_AVAILABLE') return 'rv-stamp-bad';
  return 'rv-stamp-muted';
}

/** Pure presentation: the same status as coloured text for table rows. */
function availTone(a?: { state?: string } | null): AvailTone {
  const t = stampTone(a);
  return t === 'rv-stamp-ok' ? 'rv-avail-ok'
    : t === 'rv-stamp-warn' ? 'rv-avail-warn'
    : t === 'rv-stamp-bad' ? 'rv-avail-bad'
    : 'rv-avail-muted';
}

/** Pure presentation: uppercase stamp text for a seat status. */
function stampText(a?: { state?: string; count?: number; wlPrefix?: string } | null): string {
  const s = a?.state ?? '';
  const count = a?.count ?? 0;
  if (s === 'AVAILABLE') return count > 0 ? `Available ${count}` : 'Available';
  if (s === 'RAC') return count > 0 ? `RAC ${count}` : 'RAC';
  if (s === 'WL') {
    if (count <= 0) return 'Waitlist';
    // IRCTC notation, e.g. GNWL104/WL64, so the figure reads like the booking site.
    return a?.wlPrefix ? `WL ${a.wlPrefix}/${count}` : `WL ${count}`;
  }
  if (s === 'REGRET') return 'Regret';
  if (s === 'NOT_AVAILABLE') return 'Not available';
  return 'Check seats on IRCTC';
}

/** One train on a paper ticket stub, or a split journey as two stubs under one banner. */
@Component({
  selector: 'rv-option-card',
  template: `
    @if (isDirect()) {
      <article class="rv-card rv-ticket">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="rv-train-no">{{ leg().trainNumber }}</p>
            <h3 class="rv-train-name">{{ leg().trainName }}</h3>
          </div>
          <div class="shrink-0 text-right">
            <p class="rv-fare">&#8377;{{ option().totalFare }}</p>
            <p class="rv-fare-per">per person</p>
          </div>
        </div>

        <div class="mt-4 flex items-end gap-2 sm:gap-3">
          <div class="shrink-0">
            <p class="rv-time">{{ leg().depTime }}</p>
            @if (depDate()) { <p class="rv-date">{{ depDate() }}</p> }
            <p class="rv-code">{{ leg().from }}</p>
          </div>
          <div class="min-w-0 flex-1 pb-1">
            <p class="t-soft mb-1 text-center text-xs font-semibold">{{ duration() }}</p>
            <div class="rv-track">
              <span class="rv-dot"></span><span class="rv-track-line"></span><span class="rv-dot"></span>
            </div>
          </div>
          <div class="shrink-0 text-right">
            <p class="rv-time">{{ leg().arrTime }}@if (plusDays() > 0) {<span class="rv-plus">+{{ plusDays() }} {{ plusDays() === 1 ? 'day' : 'days' }}</span>}</p>
            @if (arrDate()) { <p class="rv-date">{{ arrDate() }}</p> }
            <p class="rv-code">{{ leg().to }}</p>
          </div>
        </div>

        <div class="rv-perf" aria-hidden="true"></div>

        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span class="rv-class-chip">{{ classChip() }}</span>
          <span class="rv-stamp {{ stampTone(leg().availability) }}" role="status" [attr.title]="asOfTitle(leg().availability)">
            {{ stampText(leg().availability) }}
          </span>
        </div>
        <p class="rv-meta">{{ metaLine() }}</p>
        <a [href]="irctcUrl()" target="_blank" rel="noopener" class="rv-link-board mt-1.5">Book on IRCTC &rarr;</a>

        @if (classEntries().length > 1) {
          <div class="rv-subblock">
            <p class="rv-subblock-cap">Availability by class &middot; general quota</p>
            <div class="mt-2 grid gap-1.5 sm:grid-cols-2">
              @for (row of classEntries(); track row.cls) {
                <div class="flex items-center justify-between gap-2 text-xs">
                  <span class="t-ink font-semibold">{{ row.label }}</span>
                  <span class="flex items-center gap-2">
                    @if (row.fare !== null) { <span class="t-soft tabular-nums">&#8377;{{ row.fare }}</span> }
                    @if (row.avail; as av) {
                      <span class="{{ availTone(av) }}" role="status" [attr.title]="asOfTitle(av)">{{ stampText(av) }}</span>
                    } @else { <span class="rv-avail-muted">not checked</span> }
                  </span>
                </div>
              }
            </div>
          </div>
        }

        @if (dateWiseRows().length > 0) {
          <div class="rv-subblock">
            <p class="rv-subblock-cap">Seats by date &middot; {{ dateWiseLabel() }} &middot; general quota</p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              @for (row of dateWiseRows(); track row.date) {
                <span class="rv-date-chip {{ row.cls }}" [attr.title]="row.title">
                  <span class="t-soft">{{ row.short }}</span>
                  <span class="font-bold">{{ row.text }}</span>
                </span>
              }
            </div>
            <p class="rv-meta">Counts are ConfirmTkt snapshots and can lag IRCTC by a few hours; hover a date for its snapshot time.</p>
          </div>
        }
      </article>
    } @else {
      <article class="rv-card rv-ticket-split overflow-hidden">
        <p class="rv-banner" [class.rv-banner-over]="budgetNote().over">
          <span>SPLIT &middot; 2 TICKETS, 1 JOURNEY{{ budgetNote().text }}</span>
          <span>Total &#8377;{{ option().totalFare }}</span>
        </p>
        <p class="rv-banner rv-banner-sub">
          <span>Total {{ fmtDuration(option().totalDurationMins) }}</span>
          @if (waitLabel()) { <span>{{ waitLabel() }}</span> }
        </p>
        <div class="rv-ticket-body">
          <ol class="space-y-2.5">
            @for (leg of option().legs; track $index) {
              @if ($index > 0) {
                <li class="rv-via">
                  <span class="rv-via-dot" aria-hidden="true"></span>
                  <span>Wait {{ fmtDuration(option().connectionMins ?? 0) }} at {{ hub() }}</span>
                </li>
              }
              <li>
                <p class="m-0 flex flex-wrap items-baseline gap-x-2">
                  <span class="rv-train-no-sm">{{ leg.trainNumber }}</span>
                  <span class="t-ink font-bold">{{ leg.trainName }}</span>
                </p>
                <p class="t-soft m-0 mt-0.5 flex flex-wrap items-center gap-x-2 text-sm">
                  <span class="t-ink font-bold tabular-nums">{{ leg.depTime }}</span>
                  <span>{{ leg.from }}</span>
                  <span class="t-soft text-xs tabular-nums">{{ fmtShortDate(leg.date) }}</span>
                  <span aria-hidden="true">&rarr;</span>
                  <span class="t-ink font-bold tabular-nums">{{ leg.arrTime }}</span>
                  <span>{{ leg.to }}</span>
                  <span class="t-soft text-xs tabular-nums">{{ legArrDate(leg) }}</span>
                  <span class="t-soft text-xs font-semibold tabular-nums">{{ fmtDuration(legDur(leg.depTime, leg.arrTime)) }}</span>
                  <span class="t-ink font-bold">&#8377;{{ leg.fare }}</span>
                  <span class="text-xs font-semibold">{{ leg.date === firstDate() ? 'same day' : 'next day' }}</span>
                  <span class="rv-stamp rv-stamp-sm {{ stampTone(leg.availability) }}" role="status" [attr.title]="asOfTitle(leg.availability)">
                    {{ stampText(leg.availability) }}
                  </span>
                </p>
              </li>
            }
          </ol>

          <div class="rv-perf" aria-hidden="true"></div>

          <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span class="rv-class-chip">{{ clsLabel() || 'Sleeper' }}</span>
          </div>
          <p class="rv-meta">Two separate tickets, booked one after the other on IRCTC.</p>
          <a [href]="irctcUrl()" target="_blank" rel="noopener" class="rv-link-board mt-1.5">Book both legs on IRCTC &rarr;</a>
        </div>
      </article>
    }
  `,
})
export class OptionCardComponent {
  readonly option = input.required<SplitOption>();
  readonly classDetail = input<ClassDetail | null>(null);
  readonly hubName = input('');
  readonly irctcUrl = input('https://www.irctc.co.in/nget/train-search');
  readonly dateWise = input<Partial<Record<string, Availability>> | undefined>(undefined);
  readonly dateWiseDates = input<string[] | undefined>(undefined);
  readonly dateWiseLabel = input('');
  /** Selected class code, to look up the fare shown inside the class chip. */
  readonly clsCode = input<string>('');
  /** Selected class label, shown in the class chip. */
  readonly clsLabel = input('');
  /** Per-person budget from the form; null when unset. Drives the split banner note. */
  readonly budget = input<number | null>(null);

  private readonly stations = inject(StationsService);

  /** Template-facing handles for the pure helpers above. */
  readonly stampTone = stampTone;
  readonly stampText = stampText;
  readonly availTone = availTone;
  readonly fmtShortDate = fmtShortDate;
  readonly fmtDuration = fmtDuration;
  readonly legDur = legDurationMins;

  readonly isDirect = computed(() => this.option().type === 'direct');
  readonly leg = computed(() => this.option().legs[0]!);
  readonly firstDate = computed(() => this.option().legs[0]?.date ?? '');
  readonly duration = computed(() => fmtDuration(this.option().totalDurationMins));
  readonly hub = computed(() => this.hubName() || this.option().hub);

  /** Whole days the journey spans, from departure time plus duration: "+1 day" on arrival. */
  readonly plusDays = computed(() => {
    const m = /^(\d{1,2}):(\d{2})/.exec(this.leg().depTime ?? '');
    if (!m) return 0;
    const start = Number(m[1]) * 60 + Number(m[2]);
    const days = Math.floor((start + (this.option().totalDurationMins || 0)) / 1440);
    return days > 0 ? days : 0;
  });

  /** Real calendar dates under the times, derived from the leg's own date:
   *  departure date as searched, arrival date shifted by the day offset. */
  readonly depDate = computed(() => fmtShortDate(this.leg().date));
  readonly arrDate = computed(() => fmtShortDate(addDaysISO(this.leg().date, this.plusDays())));

  /** Split summary: the change wait with the hub's name. Empty when there is none. */
  readonly waitLabel = computed(() => {
    const w = this.option().connectionMins ?? 0;
    return w > 0 ? `${fmtDuration(w)} wait at ${this.hub()}` : '';
  });

  /** Class chip text: the selected class, with the fare inside when it is known. */
  readonly classChip = computed(() => {
    const label = this.clsLabel() || this.dateWiseLabel();
    const fare = this.classDetail()?.fares[this.clsCode()];
    return fare != null ? `${label} · ₹${fare}` : label;
  });

  /** Snapshot time plus the actual boarding and alighting stations, in words. */
  readonly metaLine = computed(() => {
    const from = this.stations.name(this.leg().from) || this.leg().from;
    const to = this.stations.name(this.leg().to) || this.leg().to;
    const route = `Boards at ${from}, alights at ${to}.`;
    const ao = this.leg().availability?.asOf;
    return ao ? `Seat snapshot ${this.asOfTime(ao)} IST. ${route}` : route;
  });

  /** Over-budget state and note for the split banner; no note when no budget is set. */
  readonly budgetNote = computed(() => {
    const b = this.budget();
    if (b == null) return { over: false, text: '' };
    const total = this.option().totalFare;
    if (total <= b) return { over: false, text: ` · inside your ₹${b} budget` };
    return { over: true, text: ` · ₹${total - b} over your ₹${b} budget` };
  });

  /** Classes the train sells on this leg, each with its fare and seat status. */
  readonly classEntries = computed(() => {
    const d = this.classDetail();
    if (!d) return [];
    const rows: { cls: string; label: string; fare: number | null; avail: Availability | null }[] = [];
    for (const cls of ['SL', '3A', '3E', '2A', '1A', 'CC', '2S'] as const) {
      const fare = d.fares[cls];
      const avail = d.avail[cls] ?? null;
      if (fare === undefined && !avail) continue;
      rows.push({
        cls,
        label: (CLASS_LABELS as Record<string, string>)[cls] ?? cls,
        fare: fare ?? null,
        avail,
      });
    }
    return rows;
  });

  /** Per-date chips for the strip: date, short label, tone class, snapshot time. */
  readonly dateWiseRows = computed(() => {
    const map = this.dateWise();
    const dates = this.dateWiseDates();
    if (!map || !dates || dates.length === 0) return [];
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return dates.map((date) => {
      const av = map[date] ?? null;
      const d = new Date(`${date}T00:00:00Z`);
      const short = `${d.getUTCDate()} ${wd[d.getUTCDay()] ?? ''}`.trim();
      let text = '\u2014';
      let cls = 'rv-date-na';
      if (av) {
        if (av.state === 'AVAILABLE') {
          text = av.count > 0 ? `${av.count}` : 'Yes';
          cls = 'rv-date-ok';
        } else if (av.state === 'RAC') {
          text = `RAC ${av.count || ''}`.trim();
          cls = 'rv-date-ok';
        } else if (av.state === 'WL') {
          text = av.count > 0 ? `WL ${av.count}` : 'WL';
          cls = 'rv-date-warn';
        }
      }
      const title = av?.asOf ? `ConfirmTkt snapshot as of ${this.asOfTime(av.asOf)} IST` : '';
      return { date, short, text, cls, title };
    });
  });

  /** Arrival calendar date for one split leg, from its own date and clock times. */
  legArrDate(leg: { date: string; depTime: string; arrTime: string }): string {
    return fmtShortDate(addDaysISO(leg.date, arrDayDelta(leg.depTime, leg.arrTime)));
  }

  asOfTime(iso: string): string {
    const m = /T(\d{2}:\d{2})/.exec(iso ?? '');
    return m?.[1] ?? '';
  }

  asOfTitle(a: { asOf?: string }): string {
    return a?.asOf ? `ConfirmTkt snapshot as of ${this.asOfTime(a.asOf)} IST` : '';
  }

}
