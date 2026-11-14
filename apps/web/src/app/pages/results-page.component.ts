import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { SplitOption } from '@railvaani/split-engine';

import { ClassDetail, OptionCardComponent } from '../components/option-card.component';
import { RailService } from '../services/rail.service';
import { StationsService } from '../services/stations.service';
import { SearchParams, istToday, parseSearchParams } from '../shared/search-params';
import { classLabel } from '../shared/train-classes';
import {
  budgetHiddenNote,
  slowSearchLine,
  visibleError,
} from '../shared/search-status';

/** The results page: reads its search from the URL, runs it, renders ticket stubs. */
@Component({
  selector: 'rv-results-page',
  imports: [OptionCardComponent],
  template: `
    <main id="main" class="mx-auto max-w-[1060px] px-4 pb-16">
      <h1 class="sr-only">Train results</h1>

      <div class="rv-card mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 p-3 sm:p-4">
        <p class="mr-auto text-sm font-semibold t-ink" role="status">{{ summary() }}</p>
        <button type="button" (click)="editSearch()" class="rv-chip">Edit search</button>
      </div>

      @if (errorLine() && !searching()) {
        <div class="rv-card rv-error mt-4 flex items-start gap-3 p-4" role="alert">
          <p class="text-sm t-ink">{{ error() }}</p>
          <button type="button" (click)="retry()" class="rv-retry ml-auto shrink-0">Retry</button>
        </div>
      }

      @if (stepLine()) { <p class="rv-note mt-3" role="status">{{ stepLine() }}</p> }

      @if (results(); as rs) {
        <section class="mt-8" aria-label="Search results">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="rv-results-title mr-auto">
              <span role="status">{{ rs.length }} options &middot; {{ routeName() }}</span>
            </h2>
            <div class="flex gap-1.5" role="group" aria-label="Sort options">
              @for (s of sorts; track s.key) {
                <button type="button" (click)="sort.set(s.key)" [class.rv-sort-active]="sort() === s.key" class="rv-sort">
                  {{ s.label }}
                </button>
              }
            </div>
          </div>
          @if (partialNote()) { <p class="rv-note mt-2" role="status">Some options could not be checked.</p> }
          <p class="rv-fineprint mt-2">
            Schedules and fares live from Indian Railways data. Availability comes from ConfirmTkt's cache and can lag
            IRCTC by a few hours; each figure carries its snapshot time. Booking happens on IRCTC. @if (isToday()) {
            Trains that already departed today are not shown. }
          </p>

          <h3 class="rv-section mt-5">Direct trains</h3>
          @if (direct().length > 0) {
            <div class="mt-3 grid items-start gap-4 lg:grid-cols-2">
              @for (o of direct(); track trackKey(o)) {
                <rv-option-card [option]="o" [classDetail]="classDetailFor(o)"
                  [dateWise]="classDetailFor(o)?.dateWise" [dateWiseDates]="classDetailFor(o)?.dateWiseDates"
                  [dateWiseLabel]="dateWiseLabelFor(o)" [clsCode]="params()?.cls ?? ''" [clsLabel]="clsName()" [budget]="budgetNum()" />
              }
            </div>
          } @else {
            <p class="rv-note mt-3">No direct trains on this route and class. A split journey may still work.</p>
          }

          <h3 class="rv-section mt-6">Split options (two tickets, one journey)</h3>
          @if (splits().length > 0) {
            <div class="mt-3 grid items-start gap-4 lg:grid-cols-2">
              @for (o of splits(); track trackKey(o)) {
                <rv-option-card [option]="o" [hubName]="stations.name(o.hub)" [clsLabel]="clsName()" [budget]="budgetNum()" />
              }
            </div>
          } @else {
            <p class="rv-note mt-3">
              No split found within the 90 minute to 8 hour connection window. Direct trains above are the options.
            </p>
          }
        </section>
      } @else if (searching()) {
        <section class="mt-8 grid items-start gap-4 lg:grid-cols-2" aria-label="Loading results">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="rv-card rv-skeleton p-4" aria-hidden="true">
              <div class="rv-pulse mb-3 h-6 w-24 rounded bg-[var(--line)]"></div>
              <div class="rv-pulse mb-2 h-5 w-40 rounded bg-[var(--line)]"></div>
              <div class="rv-pulse h-5 w-full rounded bg-[var(--line)]"></div>
              <div class="rv-pulse mt-3 h-9 w-full rounded bg-[var(--line)]"></div>
            </div>
          }
        </section>
      }
    </main>
  `,
})
export class ResultsPageComponent implements OnInit {
  private readonly rail = inject(RailService);
  readonly stations = inject(StationsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly sorts = [
    { key: 'best', label: 'Best' },
    { key: 'cheapest', label: 'Cheapest' },
    { key: 'fastest', label: 'Fastest' },
  ] as const;
  readonly sort = signal<'best' | 'cheapest' | 'fastest'>('best');

  readonly params = signal<SearchParams | null>(null);
  readonly searching = signal(false);
  readonly stage = signal<'finding' | 'checking'>('finding');
  readonly checking = signal(false);
  readonly results = signal<SplitOption[] | null>(null);
  readonly error = signal('');
  readonly partialNote = signal(false);
  /** True once the search has run 20s with no options yet: a note, not an error. */
  readonly slow = signal(false);
  readonly classDetails = signal<Record<string, ClassDetail>>({});
  private runId = 0;

  readonly stepLine = computed(() => {
    if (this.searching()) {
      const slowLine = slowSearchLine(this.searching(), (this.results()?.length ?? 0) > 0, this.slow());
      if (slowLine) return slowLine;
      return this.stage() === 'checking' ? 'Checking seats…' : 'Finding trains…';
    }
    if (this.checking()) return 'Checking seats…';
    return '';
  });

  /** The error banner hides the moment options are on screen. */
  readonly errorLine = computed(() => visibleError(this.error(), (this.results()?.length ?? 0) > 0));

  readonly budgetNum = computed(() => this.params()?.budget ?? null);

  readonly shown = computed(() => {
    const list = [...(this.results() ?? [])];
    switch (this.sort()) {
      case 'cheapest': return list.sort((a, b) => a.totalFare - b.totalFare);
      case 'fastest': return list.sort((a, b) => a.totalDurationMins - b.totalDurationMins);
      default: return list;
    }
  });

  readonly direct = computed(() => this.shown().filter((o) => o.type === 'direct'));
  readonly splits = computed(() => this.shown().filter((o) => o.type === 'split'));

  readonly routeName = computed(() => {
    const p = this.params();
    if (!p) return '';
    return `${this.stations.name(p.from) || p.from} to ${this.stations.name(p.to) || p.to}`;
  });

  readonly summary = computed(() => {
    const p = this.params();
    if (!p) return '';
    const parts: string[] = [`${this.stations.name(p.from) || p.from} → ${this.stations.name(p.to) || p.to}`];
    parts.push(this.fmtDate(p.date));
    parts.push(classLabel(p.cls));
    if (p.budget !== undefined) parts.push(`Budget ₹${p.budget}`);
    const hidden = budgetHiddenNote(this.rail.budgetHidden(), p.budget);
    if (hidden) parts.push(hidden);
    return parts.join(' · ');
  });

  readonly clsName = computed(() => {
    const p = this.params();
    return p ? classLabel(p.cls) : '';
  });

  /** Label for a card's per-date strip: the searched class, or the headline
   *  class of a direct option in Any-class mode. */
  dateWiseLabelFor(o: SplitOption): string {
    const p = this.params();
    if (!p) return '';
    if (p.cls !== 'ANY') return classLabel(p.cls);
    return classLabel(o.legs[0]?.cls ?? 'SL');
  }

  ngOnInit(): void {
    void this.stations.init().then(() => this.rail.useStations(this.stations.stations()));
    this.route.queryParamMap.subscribe((qp) => {
      const parsed = parseSearchParams({
        from: qp.get('from') ?? undefined,
        to: qp.get('to') ?? undefined,
        date: qp.get('date') ?? undefined,
        cls: qp.get('cls') ?? undefined,
        quota: qp.get('quota') ?? undefined,
        budget: qp.get('budget') ?? undefined,
      });
      if (!parsed) {
        // Missing or invalid params never show a results page.
        void this.router.navigate(['/'], { replaceUrl: true });
        return;
      }
      this.apply(parsed);
    });
  }

  retry(): void {
    const p = this.params();
    if (p) void this.run(p);
  }

  editSearch(): void {
    const p = this.params();
    if (!p) return;
    const qp: Record<string, string> = { from: p.from, to: p.to, date: p.date, cls: p.cls, quota: p.quota };
    if (p.budget !== undefined) qp['budget'] = String(p.budget);
    void this.router.navigate(['/'], { queryParams: qp });
  }

  classDetailFor(o: SplitOption): ClassDetail | null {
    if (o.type !== 'direct') return null;
    return this.classDetails()[o.legs[0]!.trainNumber] ?? null;
  }

  isToday(): boolean {
    return (this.params()?.date ?? '') === istToday();
  }

  trackKey(o: SplitOption): string {
    return `${o.type}|${o.hub ?? ''}|${o.legs.map((l) => l.trainNumber).join('+')}`;
  }

  private apply(p: SearchParams): void {
    const prev = this.params();
    if (
      prev && prev.from === p.from && prev.to === p.to && prev.date === p.date &&
      prev.cls === p.cls && prev.quota === p.quota && prev.budget === p.budget
    ) {
      return;
    }
    this.params.set(p);
    void this.run(p);
  }

  /** Runs the search. Options render the moment they arrive; class details load after. */
  private async run(p: SearchParams): Promise<void> {
    const id = ++this.runId;
    this.error.set('');
    this.partialNote.set(false);
    this.results.set(null);
    this.classDetails.set({});
    this.searching.set(true);
    this.stage.set('finding');
    this.checking.set(false);
    this.slow.set(false);
    let settled = false;
    const timer = setTimeout(() => {
      // Not an error state: the search keeps running, no retry is offered,
      // and nothing blames the connection. The step line swaps to the
      // slow-search note until options arrive.
      if (settled || id !== this.runId) return;
      if ((this.results()?.length ?? 0) === 0) this.slow.set(true);
    }, 20_000);
    try {
      const opts = await this.rail.find(
        p.from, p.to, p.date, p.cls, p.budget,
        (st) => {
          if (settled || id !== this.runId) return;
          this.stage.set(st.stage === 'checking_seats' ? 'checking' : 'finding');
        },
      );
      if (id !== this.runId) {
        clearTimeout(timer);
        return;
      }
      if (settled) {
        // A failure already settled the run; options that arrived late still render.
        if (opts.length > 0) {
          this.results.set(opts);
          this.partialNote.set(true);
          void this.loadClassDetails(opts, p, id);
        }
        return;
      }
      settled = true;
      clearTimeout(timer);
      this.results.set(opts);
      // Options on screen outrank any error: it clears the moment they render.
      if (opts.length > 0 && this.error()) this.error.set('');
      if (opts.length === 0) {
        this.error.set('No trains found for this route, class and date. Try another class or date.');
      }
      void this.loadClassDetails(opts, p, id);
    } catch {
      // Never surface an exception's raw message. Results already on screen stay.
      if (id !== this.runId || settled) return;
      settled = true;
      clearTimeout(timer);
      this.searching.set(false);
      this.error.set('Train data could not be reached. Check your connection and try again.');
      if ((this.results()?.length ?? 0) > 0) {
        this.partialNote.set(true);
      } else {
        this.results.set(null);
      }
    }
  }

  /** Fills the class-wise table and the per-date seat strip after the cards render. */
  private async loadClassDetails(opts: SplitOption[], p: SearchParams, id: number): Promise<void> {
    const details: Record<string, ClassDetail> = {};
    const seen = new Set<string>();
    const dates = this.recentDates(p.date);
    let warmed = false;
    this.checking.set(true);
    try {
      for (const o of opts) {
        if (id !== this.runId) return;
        if (o.type !== 'direct') continue;
        const leg = o.legs[0]!;
        if (seen.has(leg.trainNumber)) continue;
        seen.add(leg.trainNumber);
        if (!warmed) {
          // One upstream call per date, then every train's strip reads from cache.
          warmed = true;
          await this.rail.warmDates(leg.from, leg.to, dates).catch(() => undefined);
        }
        const avail = await this.rail.availabilityFor(leg.trainNumber, leg.date).catch(() => ({}));
        if (id !== this.runId) return;
        details[leg.trainNumber] = {
          fares: this.rail.fareTableFor(leg.trainNumber, leg.from, leg.to),
          avail,
          dateWise: this.rail.dateWiseFor(
            leg.trainNumber, leg.from, leg.to, p.cls === 'ANY' ? (leg.cls ?? 'SL') : p.cls, dates,
          ),
          dateWiseDates: dates,
        };
        this.classDetails.set({ ...details });
      }
    } finally {
      if (id === this.runId) this.checking.set(false);
    }
  }

  /** The searched date plus the next five, as YYYY-MM-DD (UTC arithmetic; India has no DST). */
  private recentDates(base: string): string[] {
    const parts = base.split('-').map(Number);
    const start = Date.UTC(parts[0] ?? 2026, (parts[1] ?? 1) - 1, parts[2] ?? 1);
    return Array.from({ length: 6 }, (_, i) => {
      const t = new Date(start + i * 86_400_000);
      return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
    });
  }

  private fmtDate(date: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m) return date;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] ?? '';
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] ?? '';
    return `${wd} ${d.getUTCDate()} ${mo}`;
  }
}
