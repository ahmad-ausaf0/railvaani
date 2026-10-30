import { Component, computed, input } from '@angular/core';

import { AVAILABILITY_LABELS, Availability, AvailabilityState, CLASS_LABELS } from '@railvaani/train-core';
import { SplitOption } from '@railvaani/split-engine';

type ChipTone = 'ok' | 'warn' | 'bad';

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

const CHIP_CLASSES: Record<ChipTone, string> = {
  ok: 'chip chip-ok',
  warn: 'chip chip-warn',
  bad: 'chip chip-bad',
};

const CHIP_DARK_CSS = `
  @media (prefers-color-scheme: dark) {
    .chip-ok { background: #052e16; color: #86efac; }
    .chip-warn { background: #451a03; color: #fcd34d; }
    .chip-bad { background: #450a0a; color: #fca5a5; }
    .date-ok { border-color: #166534; color: #86efac; }
    .date-warn { border-color: #92400e; color: #fcd34d; }
    .date-na { border-color: #334155; color: #64748b; }
  }
`;

@Component({
  selector: 'rv-option-card',
  template: `
    @if (isDirect()) {
      <article
        class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md sm:p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-md bg-indigo-600 px-2 py-0.5 font-mono text-xs font-bold text-white">{{ leg().trainNumber }}</span>
              <h3 class="truncate text-base font-semibold text-slate-900 dark:text-slate-50">{{ leg().trainName }}</h3>
            </div>
          </div>
          <div class="shrink-0 text-right">
            <p class="text-xl font-bold text-slate-900 dark:text-white">&#8377;{{ option().totalFare }}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">per head</p>
          </div>
        </div>

        <div class="mt-4 flex items-center gap-2 sm:gap-4">
          <div>
            <p class="text-xl font-bold tabular-nums text-slate-900 dark:text-white">{{ leg().depTime }}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ leg().from }}</p>
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-center text-xs font-medium text-slate-500 dark:text-slate-400">{{ duration() }}</p>
            <div class="relative mt-1 h-0.5 rounded bg-slate-200 dark:bg-slate-700">
              <span class="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500"></span>
            </div>
          </div>
          <div class="text-right">
            <p class="text-xl font-bold tabular-nums text-slate-900 dark:text-white">{{ leg().arrTime }}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ leg().to }}</p>
          </div>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-2">
          <span [class]="chip(leg().availability)" role="status" [attr.title]="asOfTitle(leg().availability)">
            {{ chipText(leg().availability) }}
          </span>
          @if (leg().availability.asOf; as ao) {
            <span class="text-[10px] text-slate-400 dark:text-slate-500">as of {{ asOfTime(ao) }} IST</span>
          }
          <a
            [href]="irctcUrl()"
            target="_blank"
            rel="noopener"
            class="ml-auto inline-flex min-h-11 items-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >Book on IRCTC
            <svg aria-hidden="true" class="ml-1.5 h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 17 17 7M9 7h8v8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </a>
        </div>

        @if (classEntries().length > 1) {
          <div class="mt-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
            <p class="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Availability by class &middot; general quota
            </p>
            <div class="mt-2 grid gap-1.5 sm:grid-cols-2">
              @for (row of classEntries(); track row.cls) {
                <div class="flex items-center justify-between gap-2 text-xs">
                  <span class="font-medium text-slate-700 dark:text-slate-200">{{ row.label }}</span>
                  <span class="flex items-center gap-2">
                    @if (row.fare !== null) {
                      <span class="tabular-nums text-slate-500 dark:text-slate-400">&#8377;{{ row.fare }}</span>
                    }
                    @if (row.avail; as av) {
                      <span [class]="chip(av)" role="status" [attr.title]="asOfTitle(av)">{{ chipText(av) }}</span>
                    }
                  </span>
                </div>
              }
            </div>
          </div>
        }

        @if (dateWiseRows().length > 0) {
          <div class="mt-3 rounded-xl bg-indigo-50/60 p-3 dark:bg-indigo-950/30">
            <p class="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Seats by date &middot; {{ dateWiseLabel() }} &middot; general quota
            </p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              @for (row of dateWiseRows(); track row.date) {
                <span class="rounded-lg border bg-white px-2 py-1 text-xs tabular-nums dark:bg-slate-900 {{ row.cls }}" [attr.title]="row.title">
                  <span class="text-slate-500 dark:text-slate-400">{{ row.short }}</span>
                  <span class="ml-1 font-bold">{{ row.text }}</span>
                </span>
              }
            </div>
            <p class="mt-1.5 text-[10px] text-slate-400 dark:text-slate-500">
              Counts are ConfirmTkt snapshots and can lag IRCTC by a few hours; hover a date for its snapshot time.
            </p>
          </div>
        }
      </article>
    } @else {
      <article
        class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md sm:p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">Split journey</span>
              <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">Via {{ hubName() || option().hub }}</h3>
            </div>
            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">2 tickets, {{ option().legs.length }} trains &middot; wait {{ shortDur(option().connectionMins ?? 0) }} at {{ hubName() || option().hub }}</p>
          </div>
          <div class="shrink-0 text-right">
            <p class="text-xl font-bold text-slate-900 dark:text-white">&#8377;{{ option().totalFare }}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">both legs</p>
          </div>
        </div>

        <ol class="mt-4 space-y-3 border-l-2 border-dashed border-indigo-200 pl-4 dark:border-indigo-900">
          @for (leg of option().legs; track $index) {
            <li>
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{{ leg.trainNumber }}</span>
                <span class="text-sm font-medium text-slate-800 dark:text-slate-100">{{ leg.trainName }}</span>
              </div>
              <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-slate-600 dark:text-slate-300">
                <span class="font-semibold tabular-nums">{{ leg.depTime }}</span>
                <span class="text-slate-400">{{ leg.from }}</span>
                <span aria-hidden="true">&rarr;</span>
                <span class="font-semibold tabular-nums">{{ leg.arrTime }}</span>
                <span class="text-slate-400">{{ leg.to }}</span>
                <span class="font-semibold text-slate-900 dark:text-white">&#8377;{{ leg.fare }}</span>
                <span class="text-xs" [class]="leg.date === firstDate() ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'">
                  {{ leg.date === firstDate() ? 'same day' : 'next day' }}
                </span>
              </div>
              <span [class]="chip(leg.availability)" role="status">{{ chipText(leg.availability) }}</span>
            </li>
          }
        </ol>

        <div class="mt-4 flex justify-end">
          <a
            [href]="irctcUrl()"
            target="_blank"
            rel="noopener"
            class="inline-flex min-h-11 items-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >Book both legs on IRCTC
            <svg aria-hidden="true" class="ml-1.5 h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 17 17 7M9 7h8v8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </a>
        </div>
      </article>
    }
  `,
  styles: [`
    .chip { display: inline-flex; align-items: center; gap: 0.35rem; border-radius: 9999px;
            padding: 0.25rem 0.75rem; font-size: 0.8rem; font-weight: 600; }
    .chip-ok { background: #dcfce7; color: #166534; }
    .chip-warn { background: #fef3c7; color: #92400e; }
    .chip-bad { background: #fee2e2; color: #991b1b; }
    .date-ok { border-color: #86efac; color: #166534; }
    .date-warn { border-color: #fcd34d; color: #92400e; }
    .date-na { border-color: #e2e8f0; color: #94a3b8; }
    ${CHIP_DARK_CSS}
  `],
})
export class OptionCardComponent {
  readonly option = input.required<SplitOption>();
  readonly classDetail = input<ClassDetail | null>(null);
  readonly hubName = input('');
  readonly irctcUrl = input('https://www.irctc.co.in/nget/train-search');
  readonly dateWise = input<Partial<Record<string, Availability>> | undefined>(undefined);
  readonly dateWiseDates = input<string[] | undefined>(undefined);
  readonly dateWiseLabel = input('');

  readonly isDirect = computed(() => this.option().type === 'direct');
  readonly leg = computed(() => this.option().legs[0]!);
  readonly firstDate = computed(() => this.option().legs[0]?.date ?? '');
  readonly duration = computed(() => this.shortDur(this.option().totalDurationMins));

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

  /** Per-date chips for the strip: date, short label, tone text, snapshot time. */
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
      let cls = 'date-na';
      if (av) {
        if (av.state === 'AVAILABLE') {
          text = av.count > 0 ? `${av.count}` : 'Yes';
          cls = 'date-ok';
        } else if (av.state === 'RAC') {
          text = `RAC ${av.count || ''}`.trim();
          cls = 'date-warn';
        } else if (av.state === 'WL') {
          text = av.count > 0 ? `WL ${av.count}` : 'WL';
          cls = 'date-warn';
        }
      }
      const title = av?.asOf ? `ConfirmTkt snapshot as of ${this.asOfTime(av.asOf)} IST` : '';
      return { date, short, text, cls, title };
    });
  });

  asOfTime(iso: string): string {
    const m = /T(\d{2}:\d{2})/.exec(iso ?? '');
    return m?.[1] ?? '';
  }

  asOfTitle(a: { asOf?: string }): string {
    return a?.asOf ? `ConfirmTkt snapshot as of ${this.asOfTime(a.asOf)} IST` : '';
  }

  shortDur(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }

  chip(a: { state: string; count: number }): string {
    const tone = this.tone(a.state);
    return CHIP_CLASSES[tone];
  }

  chipText(a: { state: string; count: number; wlPrefix?: string }): string {
    const key = (a.state ?? 'NOT_AVAILABLE') as keyof typeof AVAILABILITY_LABELS;
    const meta = AVAILABILITY_LABELS[key] ?? AVAILABILITY_LABELS['NOT_AVAILABLE'];
    let suffix = '';
    if (a.state === 'AVAILABLE' && a.count > 0) suffix = ` (${a.count})`;
    if (a.state === 'WL' && a.count > 0) {
      // IRCTC notation, e.g. GNWL104/WL64, so the figure reads like the booking site.
      suffix = a.wlPrefix ? ` (${a.wlPrefix}/${a.count})` : ` (WL ${a.count})`;
    }
    return `${meta.icon} ${meta.en}${suffix}`;
  }

  private tone(state: string): ChipTone {
    if (state === 'AVAILABLE' || state === 'RAC') return 'ok';
    if (state === 'WL') return 'warn';
    return 'bad';
  }
}
