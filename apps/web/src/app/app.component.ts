import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { Availability, CLASS_LABELS, Station, TrainClass } from '@railvaani/train-core';
import { SplitOption } from '@railvaani/split-engine';

import { RailService } from './services/rail.service';
import { StationsService } from './services/stations.service';
import { VoiceIntentService } from './services/voice-intent.service';
import { ClassDetail, OptionCardComponent } from './components/option-card.component';
import { StationInputComponent } from './components/station-input.component';

interface SpeechAlternative { transcript: string }
interface SpeechResultItem { 0: SpeechAlternative; isFinal: boolean }
interface SpeechEvent { results: { length: number; [index: number]: SpeechResultItem } }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: 1;
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

    <header class="rv-header">
      <div class="mx-auto flex max-w-[1060px] items-center gap-3 px-4 py-3.5">
        <span class="rv-logo" aria-hidden="true">
          <svg class="h-6 w-6" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="6" width="14" height="15" rx="3"/>
            <path d="M9 13.5h14M12.5 21l-2.5 5M19.5 21l2.5 5"/>
            <circle cx="12.5" cy="17.5" r="1" fill="currentColor" stroke="none"/>
            <circle cx="19.5" cy="17.5" r="1" fill="currentColor" stroke="none"/>
          </svg>
        </span>
        <div class="min-w-0">
          <p class="rv-wordmark">RailVaani</p>
          <p class="rv-tagline">रेलवाणी · बोलकर ट्रेन खोजें</p>
        </div>
        <p class="rv-header-note ml-auto hidden shrink-0 text-right leading-snug md:block">
          Voice-first train search<br>
          Direct + split journeys
        </p>
      </div>
    </header>

    <main id="main" class="mx-auto max-w-[1060px] px-4 pb-16">
      <h1 class="sr-only">Find trains across India</h1>

      <!-- Search card -->
      <section class="rv-card mt-6 p-4 sm:p-6" aria-label="Search form">
        <button
          type="button"
          (click)="startVoice()"
          [attr.aria-pressed]="listening()"
          class="rv-voice mb-4 flex items-center"
        >
          <span class="rv-voice-disc" aria-hidden="true">
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="2" width="6" height="12" rx="3"/>
              <path d="M5 10a7 7 0 0 0 14 0M12 17v5" stroke-linecap="round"/>
            </svg>
          </span>
          @if (listening()) {
            <span class="animate-pulse">Listening&hellip; say "Gorakhpur to New Delhi"</span>
          } @else {
            <span>Tap and say: "Gorakhpur to New Delhi"</span>
          }
        </button>
        @if (voiceNote()) { <p class="rv-note" role="status">{{ voiceNote() }}</p> }

        <div class="grid gap-3">
          <div class="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
            <rv-station-input
              id="from"
              label="From"
              [(text)]="fromText"
              [(code)]="fromCode"
              [suggestions]="fromSuggest()"
              (queryChange)="onFromQuery($event)"
            />
            <button type="button" (click)="swap()" aria-label="Swap origin and destination" class="rv-swap">
              <svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M7 16V4m0 0L4 7m3-3 3 3m7 4v12m0 0 3-3m-3 3-3-3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <rv-station-input
              id="to"
              label="To"
              [(text)]="toText"
              [(code)]="toCode"
              [suggestions]="toSuggest()"
              (queryChange)="onToQuery($event)"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="date" class="rv-label">Journey date</label>
              <input id="date" type="date" class="rv-input" [value]="date()" [min]="minDate" (change)="date.set(d.value)" #d />
            </div>
            <div>
              <label for="cls" class="rv-label">Class</label>
              <select id="cls" class="rv-input" [value]="cls()" (change)="setCls(c.value)" #c>
                @for (cl of classes; track cl) { <option [value]="cl">{{ classLabel(cl) }}</option> }
              </select>
            </div>
          </div>

          <div>
            <label for="budget" class="rv-label">Budget per person (&#8377;, optional)</label>
            <input id="budget" type="number" min="0" inputmode="numeric" placeholder="e.g. 600" class="rv-input"
              [value]="budget()" (input)="budget.set(b.value)" #b />
          </div>
        </div>

        <button type="button" (click)="search()" [disabled]="searching()" class="rv-primary mt-4">
          @if (searching()) {
            <svg class="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"/>
            </svg>
            @if (progressTotal() > 0) {
              Checking seats {{ progressDone() }}/{{ progressTotal() }} &middot; {{ elapsed() }}s&hellip;
            } @else {
              Finding trains &middot; {{ elapsed() }}s&hellip;
            }
          } @else { Search trains }
        </button>

        <div class="mt-3 flex flex-wrap gap-2">
          @for (ex of examples; track ex[0]) {
            <button type="button" (click)="tryExample(ex[0], ex[1])" class="rv-chip">
              {{ ex[0] }} &rarr; {{ ex[1] }}
            </button>
          }
        </div>
      </section>

      @if (error() && !searching()) {
        <div class="rv-card rv-error mt-4 flex items-start gap-3 p-4" role="alert">
          <p class="t-ink text-sm">{{ error() }}</p>
          <button type="button" (click)="search()" class="rv-retry ml-auto shrink-0">Retry</button>
        </div>
      }

      <!-- Results -->
      @if (results(); as rs) {
        <section class="mt-8" aria-label="Search results">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="rv-results-title mr-auto">
              <span role="status">{{ rs.length }} options &middot; {{ stations.name(fromCode()) || fromCode() }} to {{ stations.name(toCode()) || toCode() }}</span>
            </h2>
            @for (s of sorts; track s.key) {
              <button type="button" (click)="sort.set(s.key)" class="rv-sort" [class.rv-sort-active]="sort() === s.key">
                {{ s.label }}
              </button>
            }
          </div>
          @if (partialNote()) { <p class="rv-note mt-2" role="status">Some options could not be checked.</p> }

          <p class="rv-fineprint mt-1">
            Schedules and fares live from Indian Railways data. Availability comes from ConfirmTkt's cache and can
            lag IRCTC by a few hours; each figure carries its snapshot time. Booking happens on IRCTC.
            @if (isToday()) { Trains that already departed today are not shown. }
          </p>

          <h3 class="rv-section mt-5">Direct trains</h3>
          <div class="mt-2 grid items-start gap-4 lg:grid-cols-2">
            @for (o of shown(); track trackKey(o)) {
              @if (o.type === 'direct') {
                <rv-option-card [option]="o" [classDetail]="classDetailFor(o)"
                  [dateWise]="classDetailFor(o)?.dateWise" [dateWiseDates]="classDetailFor(o)?.dateWiseDates"
                  [dateWiseLabel]="classLabel(cls())" [clsCode]="cls()" [clsLabel]="classLabel(cls())" [budget]="budgetNum()" />
              }
            } @empty {
              <p class="rv-card rv-empty">No direct train runs this route on this date. Check the split options below.</p>
            }
          </div>

          <h3 class="rv-section mt-6">Split options (two tickets, one journey)</h3>
          <div class="mt-2 grid items-start gap-4 lg:grid-cols-2">
            @for (o of shown(); track trackKey(o)) {
              @if (o.type === 'split') {
                <rv-option-card [option]="o" [hubName]="stations.name(o.hub)" [clsLabel]="classLabel(cls())" [budget]="budgetNum()" />
              }
            } @empty {
              <p class="rv-card rv-empty">No split option fits the 90 minute to 8 hour connection window for this route.</p>
            }
          </div>
        </section>
      } @else if (searching()) {
        <section class="mt-8 grid items-start gap-4 lg:grid-cols-2" aria-label="Loading results" aria-busy="true">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="rv-card rv-ticket" aria-hidden="true">
              <div class="flex justify-between"><span class="sk h-6 w-28"></span><span class="sk h-6 w-20"></span></div>
              <div class="mt-5 flex items-center justify-between gap-3">
                <span class="sk h-7 w-16"></span><span class="sk h-2 w-28"></span><span class="sk h-7 w-16"></span>
              </div>
              <div class="mt-5 flex gap-3"><span class="sk h-9 w-24"></span><span class="sk h-9 w-36"></span></div>
            </div>
          }
        </section>
      }

      <footer class="rv-footer mt-10 pt-4 text-center text-xs">
        <p>Data: ConfirmTkt (fares, availability) and erail.in (routes), unofficial mirrors. Booking: IRCTC, the official site.</p>
        <p class="mt-1">RailVaani &middot; voice-first, accessible train search</p>
      </footer>
    </main>
  `,
})

export class AppComponent implements OnInit {
  private readonly rail = inject(RailService);
  readonly stations = inject(StationsService);
  private readonly voiceIntent = new VoiceIntentService();

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
  readonly partialNote = signal(false);
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

  /** Budget as a number for the split banner note; null when unset. */
  readonly budgetNum = computed(() => {
    const n = Number(this.budget());
    return Number.isFinite(n) && n > 0 ? n : null;
  });

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
    this.partialNote.set(false);
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
    } catch {
      // Never surface an exception's raw message. Results already on screen stay.
      this.error.set('Train data could not be reached. Check your connection and try again.');
      if ((this.results()?.length ?? 0) > 0) {
        this.partialNote.set(true);
      } else {
        this.results.set(null);
      }
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

  /** Fills the class-wise table and the per-date seat strip on direct cards. */
  private async loadClassDetails(opts: SplitOption[]): Promise<void> {
    const details: Record<string, ClassDetail> = {};
    const seen = new Set<string>();
    const dates = this.recentDates();
    let warmed = false;
    for (const o of opts) {
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
      details[leg.trainNumber] = {
        fares: this.rail.fareTableFor(leg.trainNumber, leg.from, leg.to),
        avail,
        dateWise: this.rail.dateWiseFor(leg.trainNumber, leg.from, leg.to, this.cls(), dates),
        dateWiseDates: dates,
      };
      this.classDetails.set({ ...details });
    }
  }

  /** The searched date plus the next five, as YYYY-MM-DD (UTC arithmetic; India has no DST). */
  private recentDates(): string[] {
    const base = this.date() || this.minDate;
    const parts = base.split('-').map(Number);
    const start = Date.UTC(parts[0] ?? 2026, (parts[1] ?? 1) - 1, parts[2] ?? 1);
    return Array.from({ length: 6 }, (_, i) => {
      const t = new Date(start + i * 86_400_000);
      return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
    });
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
      const intent = this.voiceIntent.parse(said, this.stations.stations());
      if (intent.from && intent.to) {
        this.fromText.set(intent.from.name);
        this.fromCode.set(intent.from.code);
        this.toText.set(intent.to.name);
        this.toCode.set(intent.to.code);
        this.voiceNote.set(`Heard: ${said}`);
        void this.search();
      } else if (intent.from) {
        this.fromText.set(intent.from.name);
        this.fromCode.set(intent.from.code);
        this.voiceNote.set(`Got ${intent.from.name}. Say the station you are going to as well.`);
      } else {
        this.voiceNote.set(
          `I heard: ${said}. Try saying two station names, like Gorakhpur to New Delhi.`,
        );
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
