import { Component, computed, inject, input } from '@angular/core';

import { Availability, CLASS_LABELS } from '@railvaani/train-core';
import { SplitOption, SplitLeg } from '@railvaani/split-engine';

import { StationsService } from '../services/stations.service';
import { addDaysISO, arrDayDelta, fmtDuration, fmtShortDate, legDurationMins } from '../shared/leg-times';
import { splitWaitLabel, stationChangeNote } from '../shared/split-notes';
import { classChips as buildClassChips } from '../shared/class-chips';
import { availTone, stampText, stampTone } from '../shared/stamps';
import { classLabel } from '../shared/train-classes';

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

/** One train on a card, or a split journey as two legs under one banner. */
@Component({
  selector: 'rv-option-card',
  template: `
    @if (isDirect()) {
      <article class="rv-card rv-ticket">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="rv-train-head">{{ leg().trainName }} &middot; {{ leg().trainNumber }}</h3>
          </div>
          <div class="shrink-0 text-right">
            <p class="rv-fare"><span class="rv-fare-from">from</span>&#8377;{{ option().totalFare }}</p>
            <p class="rv-fare-per">per person</p>
          </div>
        </div>

        <div class="rv-rule" aria-hidden="true"></div>

        <div class="flex items-end gap-2 sm:gap-3">
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
          @if (classChips().length > 0) {
            @for (chip of classChips(); track chip.cls) {
              <span class="rv-class-chip {{ chip.tone }}">
                {{ chip.cls }} &#8377;{{ chip.fare }} &middot;
                <span class="{{ chip.tone }}" role="status" [attr.title]="asOfTitle(chip.availability)">{{ chip.status }}</span>
              </span>
            }
          } @else {
            <span class="rv-class-chip">{{ classChip() }}</span>
            <span class="rv-stamp {{ stampTone(leg().availability) }}" role="status" [attr.title]="asOfTitle(leg().availability)">
              {{ stampText(leg().availability) }}
            </span>
          }
        </div>
        <p class="rv-meta">{{ metaLine() }}</p>
        <a [href]="irctcUrl()" target="_blank" rel="noopener" class="rv-link-board mt-1.5">Book on IRCTC &rarr;</a>

        @if (classEntries().length > 1 && classChips().length === 0) {
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
        <span class="rv-grad-bar" aria-hidden="true"></span>
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
                  <span>Wait {{ fmtDuration(option().connectionMins ?? 0) }}{{ changeNote() ? '' : ' at ' + arriveName() }}</span>
                </li>
                @if (changeNote(); as change) {
                  <li class="rv-via">
                    <span class="rv-via-dot" aria-hidden="true"></span>
                    <span>{{ change }}</span>
                  </li>
                }
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
                  @if (legLabel(leg); as legCls) { <span class="t-soft text-xs font-semibold">{{ legCls }}</span> }
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
            <span class="rv-class-chip">{{ splitClsChip() }}</span>
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

  /** Truthful wait label: names the station only when leg 2 boards where leg 1
   *  arrives; a cross-station change gets its own line instead. */
  readonly waitLabel = computed(() =>
    splitWaitLabel(this.option(), this.hub() ?? '', (c) => this.stations.name(c), fmtDuration),
  );

  /** 'Change stations in Kanpur: Kanpur Central → Govindpuri' when leg 2 boards
   *  at a different station than leg 1 arrives at; null otherwise. */
  readonly changeNote = computed(() =>
    stationChangeNote(this.option(), this.hubName(), (c) => this.stations.name(c)),
  );

  /** Where leg 1 arrives: the station the traveller is actually standing at. */
  readonly arriveName = computed(
    () => this.stations.name(this.option().legs[0]?.to) || this.option().legs[0]?.to || '',
  );

  /** Class chip text: the selected class, with the fare inside when it is known. */
  readonly classChip = computed(() => {
    const label = this.clsLabel() || this.dateWiseLabel();
    const fare = this.classDetail()?.fares[this.clsCode()];
    return fare != null ? `${label} · ₹${fare}` : label;
  });

  /** Per-class chip row in Any-class mode; empty when the query picked a class. */
  readonly classChips = computed(() => buildClassChips(this.leg().perClass));

  /** Any-class mode: the picked class's label for a split leg row; '' in single-class mode. */
  legLabel(leg: SplitLeg): string {
    return leg.perClass && leg.cls ? classLabel(leg.cls) : '';
  }

  /** Any-class mode: the classes the two legs were booked in; the searched class otherwise. */
  readonly splitClsChip = computed(() => {
    const legs = this.option().legs;
    if (legs.length === 2 && legs.every((l) => l.perClass && l.cls)) {
      const labels = legs.map((l) => classLabel(l.cls!));
      return labels[0] === labels[1] ? labels[0]! : labels.join(' + ');
    }
    return this.clsLabel() || 'Sleeper';
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
