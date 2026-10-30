import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { Availability, CLASS_LABELS, Station, TrainClass } from '@railvaani/train-core';
import { SplitOption } from '@railvaani/split-engine';

import { RailService } from './services/rail.service';
import { StationsService } from './services/stations.service';
import { ClassDetail, OptionCardComponent } from './components/option-card.component';
import { StationInputComponent } from './components/station-input.component';

interface SpeechAlternative { transcript: string }
interface SpeechResultItem { 0: SpeechAlternative; isFinal: boolean }
interface SpeechEvent { results: { length: number; [index: number]: SpeechResultItem } }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

const IRCTC_URL = 'https://www.irctc.co.in/nget/train-search';

@Component({
  selector: 'rv-root',
  imports: [StationInputComponent, OptionCardComponent],
  template: `
    <a class="skip-link" href="#main">Skip to main content</a>

    <header class="bg-gradient-to-r from-indigo-700 via-indigo-800 to-slate-900 text-white">
      <div class="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
        <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15" aria-hidden="true">
          <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="5" y="3" width="14" height="13" rx="2"/><path d="M5 11h14M9 16l-2 5M15 16l2 5M7.5 13.5h.01M16.5 13.5h.01" stroke-linecap="round"/>
          </svg>
        </span>
        <div>
          <p class="text-lg font-bold leading-tight">RailVaani</p>
          <p class="text-xs text-indigo-200">Voice-first train search, all India</p>
        </div>
        <span class="ml-auto rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-indigo-100">live IR data</span>
      </div>
    </header>

    <main id="main" class="mx-auto max-w-3xl px-4 pb-16">
      <h1 class="sr-only">Find trains across India</h1>

      <!-- Search card -->
      <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg sm:p-6 dark:border-slate-800 dark:bg-slate-900" aria-label="Search form">
        <button
          type="button"
          (click)="startVoice()"
          [attr.aria-pressed]="listening()"
          class="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800 transition hover:bg-indigo-100
                 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
          [class.animate-pulse]="listening()"
        >
          @if (listening()) {
            <span class="relative flex h-3 w-3"><span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-500 opacity-75"></span><span class="relative inline-flex h-3 w-3 rounded-full bg-indigo-600"></span></span>
            Listening&hellip; say "Gorakhpur to New Delhi"
          } @else {
            <svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5" stroke-linecap="round"/></svg>
            Tap to search by voice
          }
        </button>
        @if (voiceNote()) { <p class="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300" role="status">{{ voiceNote() }}</p> }

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <rv-station-input
            id="from"
            label="From"
            [(text)]="fromText"
            [suggestions]="fromSuggest()"
            (queryChange)="onFromQuery($event)"
          />
          <div class="relative sm:order-3">
            <rv-station-input
              id="to"
              label="To"
              [(text)]="toText"
              [suggestions]="toSuggest()"
              (queryChange)="onToQuery($event)"
            />
            <button
              type="button"
              (click)="swap()"
              aria-label="Swap origin and destination"
              class="absolute -top-3 right-2 z-10 hidden rounded-full border border-slate-200 bg-white p-1.5 text-slate-500 shadow-sm transition hover:text-indigo-600 sm:block dark:border-slate-700 dark:bg-slate-900"
            >
              <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16V4m0 0L4 7m3-3 3 3m7 4v12m0 0 3-3m-3 3-3-3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>

          <div>
            <label for="date" class="block text-sm font-semibold text-slate-600 dark:text-slate-300">Journey date</label>
            <input id="date" type="date" [value]="date()" [min]="minDate" (change)="date.set(d.value)" #d
              class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
          </div>
          <div>
            <label for="cls" class="block text-sm font-semibold text-slate-600 dark:text-slate-300">Class</label>
            <select id="cls" [value]="cls()" (change)="setCls(c.value)" #c
              class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              @for (cl of classes; track cl) { <option [value]="cl">{{ classLabel(cl) }}</option> }
            </select>
          </div>
          <div class="sm:col-span-2">
            <label for="budget" class="block text-sm font-semibold text-slate-600 dark:text-slate-300">Budget per person (&#8377;, optional)</label>
            <input id="budget" type="number" min="0" inputmode="numeric" placeholder="e.g. 600" [value]="budget()" (input)="budget.set(b.value)" #b
              class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
          </div>
        </div>

        <button type="button" (click)="search()" [disabled]="searching()"
          class="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-base font-bold text-white transition hover:bg-indigo-700 disabled:opacity-60">
          @if (searching()) {
            <svg class="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"/></svg>
            @if (progressTotal() > 0) {
              Checking seats {{ progressDone() }}/{{ progressTotal() }} &middot; {{ elapsed() }}s&hellip;
            } @else {
              Finding trains &middot; {{ elapsed() }}s&hellip;
            }
          } @else { Search trains }
        </button>

        <div class="mt-3 flex flex-wrap gap-2">
          @for (ex of examples; track ex[0]) {
            <button type="button" (click)="tryExample(ex[0], ex[1])"
              class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {{ ex[0] }} &rarr; {{ ex[1] }}
            </button>
          }
        </div>
      </section>

      @if (error() && !searching()) {
        <div class="mt-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/50" role="alert">
          <p class="text-sm text-red-800 dark:text-red-200">{{ error() }}</p>
          <button type="button" (click)="search()" class="ml-auto shrink-0 rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-800 dark:bg-red-900/60 dark:text-red-100">Retry</button>
        </div>
      }

      <!-- Results -->
      @if (results(); as rs) {
        <section class="mt-6" aria-label="Search results">
          <div class="flex flex-wrap items-center gap-2">
            <p class="mr-auto text-sm font-semibold text-slate-700 dark:text-slate-200" role="status">
              {{ rs.length }} options · {{ stations.name(fromCode()) || fromCode() }} to {{ stations.name(toCode()) || toCode() }}
            </p>
            @for (s of sorts; track s.key) {
              <button type="button" (click)="sort.set(s.key)" [class]="sortChip(s.key)">
                {{ s.label }}
              </button>
            }
          </div>
          <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Schedules and fares live from Indian Railways data. Availability is indicative; booking happens on IRCTC.
            @if (isToday()) { Trains that already departed today are not shown. }
          </p>

          <h2 class="mt-5 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Direct trains</h2>
          <div class="mt-2 space-y-3">
            @for (o of shown(); track trackKey(o)) {
              @if (o.type === 'direct') { <rv-option-card [option]="o" [classDetail]="classDetailFor(o)" /> }
            } @empty {
              <p class="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">No direct train runs this route on this date. Check the split options below.</p>
            }
          </div>

          <h2 class="mt-6 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Split options (two tickets, one journey)</h2>
          <div class="mt-2 space-y-3">
            @for (o of shown(); track trackKey(o)) {
              @if (o.type === 'split') { <rv-option-card [option]="o" [hubName]="stations.name(o.hub)" /> }
            } @empty {
              <p class="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">No split option fits the 90 minute to 8 hour connection window for this route.</p>
            }
          </div>
        </section>
      } @else if (searching()) {
        <section class="mt-6 space-y-3" aria-label="Loading results">
          @for (i of [1, 2, 3]; track i) {
            <div class="animate-pulse rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div class="flex justify-between"><div class="h-4 w-40 rounded bg-slate-200 dark:bg-slate-700"></div><div class="h-4 w-16 rounded bg-slate-200 dark:bg-slate-700"></div></div>
              <div class="mt-4 flex justify-between"><div class="h-6 w-14 rounded bg-slate-200 dark:bg-slate-700"></div><div class="h-2 w-40 self-center rounded bg-slate-100 dark:bg-slate-800"></div><div class="h-6 w-14 rounded bg-slate-200 dark:bg-slate-700"></div></div>
              <div class="mt-4 h-8 w-32 rounded-full bg-slate-100 dark:bg-slate-800"></div>
            </div>
          }
        </section>
      }

      <footer class="mt-10 border-t border-slate-200 pt-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <p>Data: ConfirmTkt (fares, availability) and erail.in (routes), unofficial mirrors. Booking: IRCTC, the official site.</p>
        <p class="mt-1">RailVaani &middot; voice-first, accessible train search</p>
      </footer>
    </main>
  `,
})
export class AppComponent implements OnInit {
  private readonly rail = inject(RailService);
  readonly stations = inject(StationsService);

  readonly classes: TrainClass[] = ['SL', '3A', '3E', '2A', '1A', 'CC', '2S'];
  readonly sorts = [
    { key: 'best', label: 'Best' },
    { key: 'cheapest', label: 'Cheapest' },
    { key: 'fastest', label: 'Fastest' },
  ] as const;
  readonly examples: ReadonlyArray<readonly [string, string]> = [
    ['Gorakhpur', 'New Delhi'], ['Patna', 'Mumbai'], ['Varanasi', 'Lucknow'], ['Chennai', 'Bengaluru'],
  ];

  readonly fromText = signal('');
  readonly toText = signal('');
  readonly fromCode = signal<string | null>(null);
  readonly toCode = signal<string | null>(null);
  readonly date = signal('');
  readonly cls = signal<TrainClass>('SL');
  readonly budget = signal('');
  readonly searching = signal(false);
  readonly listening = signal(false);
  readonly results = signal<SplitOption[] | null>(null);
  readonly error = signal('');
  readonly voiceNote = signal('');
  readonly sort = signal<'best' | 'cheapest' | 'fastest'>('best');
  readonly progressStage = signal<'searching' | 'checking_seats'>('searching');
  readonly progressDone = signal(0);
  readonly progressTotal = signal(0);
  readonly elapsed = signal(0);
  readonly classDetails = signal<Record<string, ClassDetail>>({});

  readonly fromSuggest = signal<Station[]>([]);
  readonly toSuggest = signal<Station[]>([]);

  readonly minDate = new Date().toISOString().slice(0, 10);

  readonly shown = computed(() => {
    const list = [...(this.results() ?? [])];
    switch (this.sort()) {
      case 'cheapest': return list.sort((a, b) => a.totalFare - b.totalFare);
      case 'fastest': return list.sort((a, b) => a.totalDurationMins - b.totalDurationMins);
      default: return list;
    }
  });

  ngOnInit(): void {
    this.date.set(this.minDate);
    void this.stations.init().then(() => this.rail.useStations(this.stations.stations()));
  }

  classLabel(c: TrainClass): string { return CLASS_LABELS[c]; }

  setCls(value: string): void { this.cls.set(value as TrainClass); }

  sortChip(key: 'best' | 'cheapest' | 'fastest'): string {
    const base = 'rounded-full px-3 py-1.5 text-xs font-semibold transition';
    return this.sort() === key
      ? `${base} bg-indigo-600 text-white`
      : `${base} bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300`;
  }

  onFromQuery(q: string): void { this.fromSuggest.set(this.stations.search(q)); }
  onToQuery(q: string): void { this.toSuggest.set(this.stations.search(q)); }

  swap(): void {
    const t = this.fromText(); const c = this.fromCode();
    this.fromText.set(this.toText()); this.fromCode.set(this.toCode());
    this.toText.set(t); this.toCode.set(c);
  }

  tryExample(fromName: string, toName: string): void {
    const f = this.stations.resolve(fromName); const t = this.stations.resolve(toName);
    this.fromText.set(f?.name ?? fromName); this.fromCode.set(f?.code ?? null);
    this.toText.set(t?.name ?? toName); this.toCode.set(t?.code ?? null);
    void this.search();
  }

  trackKey(o: SplitOption): string {
    return `${o.type}|${o.hub ?? ''}|${o.legs.map((l) => l.trainNumber).join('+')}`;
  }

  async search(): Promise<void> {
    const from = this.resolveFromField(this.fromText(), this.fromCode());
    const to = this.resolveFromField(this.toText(), this.toCode());
    if (!from || !to) {
      this.error.set('Pick both the From and To stations from the list (or say them by voice).');
      return;
    }
    if (from === to) {
      this.error.set('Origin and destination are the same station.');
      return;
    }
    this.fromCode.set(from);
    this.toCode.set(to);
    this.error.set('');
    this.results.set(null);
    this.classDetails.set({});
    this.searching.set(true);
    this.progressStage.set('searching');
    this.progressDone.set(0);
    this.progressTotal.set(0);
    const started = Date.now();
    this.elapsed.set(0);
    const tick = setInterval(() => this.elapsed.set(Math.round((Date.now() - started) / 1000)), 1000);
    try {
      const budgetNum = Number(this.budget());
      const opts = await this.rail.find(
        from, to,
        this.date() || this.minDate,
        this.cls(),
        Number.isFinite(budgetNum) && budgetNum > 0 ? budgetNum : undefined,
        (p) => {
          this.progressStage.set(p.stage);
          this.progressDone.set(p.done);
          this.progressTotal.set(p.total);
        },
      );
      this.results.set(opts);
      if (opts.length === 0) {
        this.error.set('No trains found for this route, class and date. Try another class or date.');
      }
      void this.loadClassDetails(opts);
    } catch (e) {
      this.results.set(null);
      this.error.set(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      clearInterval(tick);
      this.searching.set(false);
    }
  }

  isToday(): boolean {
    const d = new Date(Date.now() + (5 * 60 + 30) * 60_000);
    return (this.date() || this.minDate) === d.toISOString().slice(0, 10);
  }

  classDetailFor(o: SplitOption): ClassDetail | null {
    if (o.type !== 'direct') return null;
    return this.classDetails()[o.legs[0]!.trainNumber] ?? null;
  }

  /** Fills the class-wise availability table on direct cards from the search's cache. */
  private async loadClassDetails(opts: SplitOption[]): Promise<void> {
    const details: Record<string, ClassDetail> = {};
    const seen = new Set<string>();
    for (const o of opts) {
      if (o.type !== 'direct') continue;
      const leg = o.legs[0]!;
      if (seen.has(leg.trainNumber)) continue;
      seen.add(leg.trainNumber);
      const avail = await this.rail.availabilityFor(leg.trainNumber, leg.date).catch(() => ({}));
      details[leg.trainNumber] = {
        fares: this.rail.fareTableFor(leg.trainNumber, leg.from, leg.to),
        avail,
      };
    }
    this.classDetails.set(details);
  }

  private resolveFromField(text: string, code: string | null): string | null {
    if (code) return code;
    const hit = this.stations.resolve(text);
    return hit ? hit.code : null;
  }

  startVoice(): void {
    const w = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      this.voiceNote.set('Voice search works in Chrome or Edge. Type the stations for now.');
      return;
    }
    const rec = new Ctor();
    rec.lang = 'en-IN';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    this.listening.set(true);
    this.voiceNote.set('');
    rec.onresult = (e: SpeechEvent) => {
      const said = e.results[0]?.[0]?.transcript ?? '';
      const m = said.match(/(?:from\s+)?(.+?)\s+(?:to|se|से)\s+(.+)$/i);
      if (m?.[1] && m?.[2]) {
        const f = this.stations.resolve(m[1].trim());
        const t = this.stations.resolve(m[2].trim());
        this.fromText.set(f?.name ?? m[1].trim());
        this.fromCode.set(f?.code ?? null);
        this.toText.set(t?.name ?? m[2].trim());
        this.toCode.set(t?.code ?? null);
        this.voiceNote.set(`Heard: ${said}`);
        void this.search();
      } else {
        this.voiceNote.set(`Heard "${said}". Say it as: Gorakhpur to New Delhi.`);
      }
    };
    rec.onerror = (err) => {
      this.voiceNote.set(
        err.error === 'not-allowed'
          ? 'Microphone permission was blocked. Allow the mic, or type the stations.'
          : 'Could not hear that clearly. Try again, or type the stations.',
      );
    };
    rec.onend = () => this.listening.set(false);
    rec.start();
  }
}
