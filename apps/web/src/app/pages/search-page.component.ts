import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { Station } from '@railvaani/train-core';

import { StationInputComponent } from '../components/station-input.component';
import { LastSearchService } from '../services/last-search.service';
import { RailService } from '../services/rail.service';
import { StationsService } from '../services/stations.service';
import { VoiceIntentService } from '../services/voice-intent.service';
import { istToday } from '../shared/search-params';

interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: (e: SpeechEvent) => void;
  onerror: (err: { error?: string }) => void;
  onend: () => void;
  start: () => void;
}

type SpeechEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };

/** The search form: voice, fields, example chips. Submitting navigates to /results. */
@Component({
  selector: 'rv-search-page',
  imports: [StationInputComponent],
  template: `
    <main id="main" class="mx-auto max-w-[1060px] px-4 pb-16">
      <h1 class="sr-only">Find trains across India</h1>

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

          <div>
            <label for="date" class="rv-label">Journey date</label>
            <input id="date" type="date" class="rv-input" [value]="date()" [min]="minDate" (change)="date.set(d.value)" #d />
          </div>

          <div>
            <label for="budget" class="rv-label">Budget per person (&#8377;, optional)</label>
            <input id="budget" type="number" min="0" inputmode="numeric" placeholder="e.g. 600" class="rv-input"
              [value]="budget()" (input)="budget.set(b.value)" #b />
          </div>
        </div>

        <button type="button" (click)="submit()" class="rv-primary mt-4">Search trains</button>

        <div class="mt-3 flex flex-wrap gap-2">
          @for (ex of examples; track ex[0]) {
            <button type="button" (click)="tryExample(ex[0], ex[1])" class="rv-chip">
              {{ ex[0] }} &rarr; {{ ex[1] }}
            </button>
          }
        </div>
      </section>

      @if (formError()) {
        <div class="rv-card rv-error mt-4 p-4" role="alert">
          <p class="t-ink text-sm">{{ formError() }}</p>
        </div>
      }
    </main>
  `,
})
export class SearchPageComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly rail = inject(RailService);
  readonly stations = inject(StationsService);
  private readonly voiceIntent = new VoiceIntentService();
  private readonly lastSearch = inject(LastSearchService);

  readonly examples: ReadonlyArray<readonly [string, string]> = [
    ['Gorakhpur', 'New Delhi'], ['Patna', 'Mumbai'], ['Varanasi', 'Lucknow'], ['Chennai', 'Bengaluru'],
  ];

  readonly fromText = signal('');
  readonly toText = signal('');
  readonly fromCode = signal<string | null>(null);
  readonly toCode = signal<string | null>(null);
  readonly date = signal('');
  readonly budget = signal('');
  readonly listening = signal(false);
  readonly voiceNote = signal('');
  readonly formError = signal('');
  readonly fromSuggest = signal<Station[]>([]);
  readonly toSuggest = signal<Station[]>([]);

  readonly minDate = istToday();

  ngOnInit(): void {
    this.prefill();
    void this.stations.init().then(() => {
      this.rail.useStations(this.stations.stations());
      // The full directory arrived: swap any code placeholder for the real name.
      const f = this.fromCode();
      const t = this.toCode();
      if (f) this.fromText.set(this.stations.name(f) || f);
      if (t) this.toText.set(this.stations.name(t) || t);
    });
  }

  /** URL params win; otherwise the last search this session fills the form (Back button). */
  private prefill(): void {
    const qp = this.route.snapshot.queryParamMap;
    const last = this.lastSearch.read();
    const from = qp.get('from') ?? last?.from ?? '';
    const to = qp.get('to') ?? last?.to ?? '';
    const date = qp.get('date') ?? last?.date ?? '';
    const budget = qp.get('budget') ?? last?.budget ?? '';
    if (from) {
      this.fromCode.set(from);
      this.fromText.set(this.stations.name(from) || from);
    }
    if (to) {
      this.toCode.set(to);
      this.toText.set(this.stations.name(to) || to);
    }
    if (date) this.date.set(date);
    if (budget) this.budget.set(budget);
    if (!this.date()) this.date.set(this.minDate);
  }

  onFromQuery(q: string): void { this.fromSuggest.set(this.stations.search(q)); }
  onToQuery(q: string): void { this.toSuggest.set(this.stations.search(q)); }

  swap(): void {
    const t = this.fromText();
    const c = this.fromCode();
    this.fromText.set(this.toText());
    this.fromCode.set(this.toCode());
    this.toText.set(t);
    this.toCode.set(c);
  }

  tryExample(fromName: string, toName: string): void {
    const f = this.stations.resolve(fromName);
    const t = this.stations.resolve(toName);
    this.fromText.set(f?.name ?? fromName);
    this.fromCode.set(f?.code ?? null);
    this.toText.set(t?.name ?? toName);
    this.toCode.set(t?.code ?? null);
    this.submit();
  }

  /** Validates the form, then hands the search to /results as query params. */
  submit(): void {
    const from = this.resolveFromField(this.fromText(), this.fromCode());
    const to = this.resolveFromField(this.toText(), this.toCode());
    if (!from || !to) {
      this.formError.set('Pick both the From and To stations from the list (or say them by voice).');
      return;
    }
    if (from === to) {
      this.formError.set('Origin and destination are the same station.');
      return;
    }
    this.fromCode.set(from);
    this.toCode.set(to);
    const date = this.date() || this.minDate;
    const budgetN = Number(this.budget());
    const budget = Number.isFinite(budgetN) && budgetN > 0 ? String(budgetN) : '';
    const params: Record<string, string> = { from, to, date, quota: 'GN' };
    if (budget) params['budget'] = budget;
    this.lastSearch.save({
      from,
      fromName: this.stations.name(from) || this.fromText(),
      to,
      toName: this.stations.name(to) || this.toText(),
      date,
      quota: 'GN',
      budget,
    });
    this.formError.set('');
    void this.router.navigate(['/results'], { queryParams: params });
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
        this.voiceNote.set('');
        this.submit();
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
