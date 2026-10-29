import { Component, OnInit, computed, signal } from '@angular/core';

import {
  AVAILABILITY_LABELS,
  CLASS_LABELS,
  MockTrainProvider,
  TrainClass,
} from '@railvaani/train-core';
import { findOptions, SplitLeg, SplitOption } from '@railvaani/split-engine';

const IRCTC_URL = 'https://www.irctc.co.in/nget/train-search';

interface SpeechAlternative {
  transcript: string;
}
interface SpeechResultItem {
  0: SpeechAlternative;
  isFinal: boolean;
}
interface SpeechEvent {
  results: { length: number; [index: number]: SpeechResultItem };
}
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

function fmt(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

@Component({
  selector: 'rv-root',
  template: `
    <a class="skip-link" href="#main">Skip to main content</a>
    <header class="app-header">
      <p class="app-title">RailVaani</p>
      <p class="app-sub">Voice-first train search</p>
    </header>
    <main id="main" class="app-main">
      <h1>Find trains</h1>
      <p class="hint">
        Tap the mic and say &ldquo;Gorakhpur to New Delhi&rdquo;, or type below. Split options
        show cheaper two-ticket journeys when direct trains are full or over budget.
      </p>

      <section class="card" aria-label="Search form">
        <div class="mic-row">
          <button type="button" class="mic" (click)="startVoice()" [attr.aria-pressed]="listening()">
            @if (listening()) { Listening&hellip; } @else { 🎤 Voice search }
          </button>
        </div>
        <div class="grid">
          <div class="field">
            <label for="from">From</label>
            <input id="from" list="station-list" autocomplete="off" [value]="from()" (input)="from.set(f.value)" #f />
          </div>
          <div class="field">
            <label for="to">To</label>
            <input id="to" list="station-list" autocomplete="off" [value]="to()" (input)="to.set(t.value)" #t />
          </div>
          <div class="field">
            <label for="date">Journey date</label>
            <input id="date" type="date" [value]="date()" (input)="date.set(d.value)" #d />
          </div>
          <div class="field">
            <label for="cls">Class</label>
            <select id="cls" [value]="cls()" (change)="setCls(c.value)" #c>
              @for (cl of classes; track cl) {
                <option [value]="cl" [selected]="cl === cls()">{{ classLabel(cl) }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label for="budget">Budget per person (₹, optional)</label>
            <input id="budget" type="number" min="0" inputmode="numeric" [value]="budget()" (input)="budget.set(b.value)" #b />
          </div>
        </div>
        <button type="button" class="search" (click)="search()">
          @if (searching()) { Searching&hellip; } @else { Search trains }
        </button>
        <datalist id="station-list">
          @for (s of stations(); track s.code) {
            <option [value]="s.code">{{ s.name }}</option>
          }
        </datalist>
      </section>

      @if (error() && !searching()) {
        <p class="status error" role="alert">{{ error() }}</p>
      }

      @if (results(); as rs) {
        <section aria-label="Search results">
          <p class="results-count" role="status">{{ rs.length }} options found, best first</p>

          <h2>Direct trains</h2>
          @for (o of directs(); track $index) {
            @let leg = o.legs[0];
            <article class="option">
              <div class="option-head">
                <span class="train-no">{{ leg?.trainNumber }}</span>
                <span class="train-name">{{ leg?.trainName }}</span>
                <span class="fare">₹{{ o.totalFare }}</span>
              </div>
              <p class="times">
                {{ leg?.depTime }} → {{ leg?.arrTime }} · {{ fmt(o.totalDurationMins) }}
              </p>
              <p class="avail">
                <span class="chip" [class]="'chip-' + chipKind(availState(leg))">
                  {{ availIcon(availState(leg)) }}
                  {{ availLabel(availState(leg)) }}
                </span>
              </p>
              <a class="book" [href]="irctcUrl" target="_blank" rel="noopener">
                Book on IRCTC (official site) ↗
              </a>
            </article>
          } @empty {
            <p class="empty">No direct train runs this route on this date. Check the splits below.</p>
          }

          <h2>Split options (two tickets, one journey)</h2>
          @for (o of splits(); track $index) {
            <article class="option">
              <div class="option-head">
                <span class="train-name">Via {{ o.hub }} · 2 trains</span>
                <span class="fare">₹{{ o.totalFare }}</span>
              </div>
              @for (leg of o.legs; track $index) {
                <p class="leg">
                  <span class="train-no">{{ leg.trainNumber }}</span>
                  {{ leg.from }} → {{ leg.to }}
                  {{ leg.depTime }}–{{ leg.arrTime }}
                  ₹{{ leg.fare }}
                  <span class="chip" [class]="'chip-' + chipKind(leg.availability.state)">
                    {{ availIcon(leg.availability.state) }} {{ availLabel(leg.availability.state) }}
                  </span>
                </p>
              }
              <p class="wait">Wait {{ fmt(o.connectionMins ?? 0) }} at {{ hubName(o.hub) }}</p>
              <a class="book" [href]="irctcUrl" target="_blank" rel="noopener">
                Book both legs on IRCTC (official site) ↗
              </a>
            </article>
          } @empty {
            <p class="empty">No split option fits within a 90 minute to 8 hour connection window.</p>
          }
        </section>
      }
    </main>
  `,
  styles: [`
    .skip-link { position: absolute; left: -999px; top: 0; background: #fff; padding: 8px 16px; z-index: 100; }
    .skip-link:focus { left: 8px; top: 8px; }
    .app-header { background: var(--rv-color-primary); color: #fff; padding: 12px 16px; }
    .app-title { margin: 0; font-size: 1.25rem; font-weight: 700; letter-spacing: 0.02em; }
    .app-sub { margin: 2px 0 0; font-size: 0.85rem; opacity: 0.85; }
    .app-main { padding: 16px; max-width: 720px; margin: 0 auto; }
    h1 { font-size: 1.35rem; margin: 8px 0 4px; }
    h2 { font-size: 1.05rem; margin: 20px 0 8px; }
    .hint { color: #444; margin: 0 0 12px; }
    .card { border: 1px solid #d8d8d8; border-radius: 12px; padding: 16px; background: #fafbfc; }
    .mic-row { margin-bottom: 12px; }
    .mic { width: 100%; font-size: 1rem; border: 2px solid var(--rv-color-primary); border-radius: 10px;
           background: #eef2fb; color: var(--rv-color-primary-text); font-weight: 600; padding: 10px 16px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field:first-child { grid-column: 1 / -1; }
    label { font-weight: 600; font-size: 0.9rem; }
    input, select { font-size: 1rem; padding: 10px; border: 1px solid #999; border-radius: 8px; background: #fff; }
    .search { margin-top: 14px; width: 100%; font-size: 1.05rem; font-weight: 700; padding: 12px;
              background: var(--rv-color-primary); color: #fff; border: none; border-radius: 10px; }
    .search:disabled { opacity: 0.6; }
    .status { padding: 10px 12px; border-radius: 8px; }
    .status.error { background: #fdecec; color: var(--rv-color-danger); border: 1px solid #f3b8b8; }
    .results-count { font-weight: 600; margin: 16px 0 4px; }
    .option { border: 1px solid #d8d8d8; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; background: #fff; }
    .option-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .train-no { font-weight: 700; color: var(--rv-color-primary-text); }
    .train-name { flex: 1; min-width: 140px; font-weight: 600; }
    .fare { font-weight: 700; font-size: 1.1rem; }
    .times { margin: 6px 0; color: #333; }
    .leg { margin: 6px 0; font-size: 0.95rem; }
    .wait { margin: 8px 0 0; color: var(--rv-color-warn); font-weight: 600; }
    .avail { margin: 6px 0; }
    .chip { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 0.85rem; font-weight: 600; }
    .chip-ok { background: #e6f4e6; color: var(--rv-color-ok); }
    .chip-warn { background: #fdf3e6; color: var(--rv-color-warn); }
    .chip-bad { background: #fdecec; color: var(--rv-color-danger); }
    .book { display: inline-block; margin-top: 8px; font-weight: 600; color: var(--rv-color-primary-text); }
    .empty { color: #555; font-style: italic; }
    @media (max-width: 480px) { .grid { grid-template-columns: 1fr; } }
  `],
})
export class AppComponent implements OnInit {
  private readonly provider = new MockTrainProvider();

  readonly irctcUrl = IRCTC_URL;
  readonly classes: TrainClass[] = ['SL', '3A', '3E', '2A', 'CC', '2S'];

  readonly stations = signal<{ code: string; name: string }[]>([]);
  readonly from = signal('GKP');
  readonly to = signal('NDLS');
  readonly date = signal('');
  readonly cls = signal<TrainClass>('SL');
  readonly budget = signal('');
  readonly searching = signal(false);
  readonly listening = signal(false);
  readonly results = signal<SplitOption[] | null>(null);
  readonly error = signal('');

  readonly directs = computed(() => (this.results() ?? []).filter((o) => o.type === 'direct'));
  readonly splits = computed(() => (this.results() ?? []).filter((o) => o.type === 'split'));

  constructor() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    this.date.set(tomorrow.toISOString().slice(0, 10));
  }

  async ngOnInit(): Promise<void> {
    this.stations.set(await this.provider.listStations());
  }

  classLabel(c: TrainClass): string {
    return CLASS_LABELS[c];
  }

  setCls(value: string): void {
    this.cls.set(value as TrainClass);
  }

  fmt(mins: number): string {
    return fmt(mins);
  }

  hubName(code?: string): string {
    const hit = this.stations().find((s) => s.code === code);
    return hit ? hit.name : (code ?? '');
  }

  availState(leg?: SplitLeg): string {
    return leg?.availability.state ?? 'NOT_AVAILABLE';
  }

  chipKind(state?: string): 'ok' | 'warn' | 'bad' {
    switch (state) {
      case 'AVAILABLE':
      case 'RAC':
        return 'ok';
      case 'WL':
      case 'REGRET':
        return 'warn';
      default:
        return 'bad';
    }
  }

  availIcon(state?: string): string {
    const key = (state ?? 'NOT_AVAILABLE') as keyof typeof AVAILABILITY_LABELS;
    return AVAILABILITY_LABELS[key]?.icon ?? '•';
  }

  availLabel(state?: string): string {
    const key = (state ?? 'NOT_AVAILABLE') as keyof typeof AVAILABILITY_LABELS;
    return AVAILABILITY_LABELS[key]?.en ?? 'Unknown';
  }

  async search(): Promise<void> {
    const from = this.from().trim();
    const to = this.to().trim();
    if (!from || !to) {
      this.error.set('Enter both the From and To stations.');
      return;
    }
    if (from.toUpperCase() === to.toUpperCase()) {
      this.error.set('Origin and destination are the same station.');
      return;
    }
    this.error.set('');
    this.searching.set(true);
    try {
      const budgetNum = Number(this.budget());
      const opts = await findOptions(this.provider, {
        from,
        to,
        date: this.date() || new Date().toISOString().slice(0, 10),
        cls: this.cls(),
        budgetPerHead: Number.isFinite(budgetNum) && budgetNum > 0 ? budgetNum : undefined,
        maxResults: 12,
      });
      this.results.set(opts);
      if (opts.length === 0) {
        this.error.set('No trains found for this route, class and date. Try another class or date.');
      }
    } catch (e) {
      this.results.set(null);
      this.error.set(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      this.searching.set(false);
    }
  }

  startVoice(): void {
    const w = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      this.error.set('Voice search works in Chrome or Edge. Type the stations for now.');
      return;
    }
    const rec = new Ctor();
    rec.lang = 'en-IN';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    this.listening.set(true);
    this.error.set('');
    rec.onresult = (e: SpeechEvent) => {
      const said = e.results[0]?.[0]?.transcript ?? '';
      const m = said.match(/^(.+?)\s+(?:to|se|से)\s+(.+)$/i);
      if (m?.[1] && m[2]) {
        this.from.set(m[1].trim());
        this.to.set(m[2].trim());
        void this.search();
      } else {
        this.error.set(`Heard "${said}". Say it as: Gorakhpur to New Delhi.`);
      }
    };
    rec.onerror = (e) => {
      this.error.set(
        e.error === 'not-allowed'
          ? 'Microphone permission was blocked. Allow the mic, or type the stations.'
          : 'Could not hear that clearly. Try again, or type the stations.',
      );
    };
    rec.onend = () => this.listening.set(false);
    rec.start();
  }
}
