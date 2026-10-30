import { Component, input, model, output, signal } from '@angular/core';

import { Station } from '@railvaani/train-core';

/** Station field with typeahead over the all-India directory and a code chip. */
@Component({
  selector: 'rv-station-input',
  template: `
    <label class="block text-sm font-semibold text-slate-600 dark:text-slate-300" [for]="id()">
      {{ label() }}
    </label>
    <div class="relative mt-1">
      <input
        #box
        [id]="id()"
        type="text"
        autocomplete="off"
        role="combobox"
        [attr.aria-expanded]="open() && suggestions().length > 0"
        aria-autocomplete="list"
        [attr.aria-controls]="id() + '-list'"
        [value]="text()"
        (input)="onInput(box.value)"
        (keydown)="onKey($event)"
        (focus)="open.set(true)"
        (blur)="onBlur()"
        class="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 pr-16 text-base text-slate-900 outline-none transition
               placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200
               dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-indigo-900"
        [placeholder]="placeholder()"
      />
      @if (code()) {
        <span
          class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
        >{{ code() }}</span>
      }
      @if (open() && suggestions().length > 0) {
        <ul
          role="listbox"
          [id]="id() + '-list'"
          class="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl
                 dark:border-slate-700 dark:bg-slate-900"
        >
          @for (s of suggestions(); track s.code; let i = $index) {
            <li
              role="option"
              [attr.aria-selected]="i === active()"
              (mousedown)="$event.preventDefault(); pick(s)"
              (mouseenter)="active.set(i)"
              [class]="optionClass(i)"
            >
              <span class="truncate text-slate-800 dark:text-slate-100">{{ s.name }}</span>
              <span class="shrink-0 font-mono text-xs text-slate-500 dark:text-slate-400">{{ s.code }}</span>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class StationInputComponent {
  readonly id = input.required<string>();
  readonly label = input.required<string>();
  readonly placeholder = input('Type a city or station code');
  /** Two-way bound display text. */
  readonly text = model<string>('');
  /** Resolved station code once a suggestion is picked. */
  readonly code = model<string | null>(null);
  readonly suggestions = input<Station[]>([]);
  readonly queryChange = output<string>();

  readonly open = signal(false);
  readonly active = signal(-1);

  onInput(value: string): void {
    this.text.set(value);
    this.code.set(null);
    this.active.set(-1);
    this.open.set(true);
    this.queryChange.emit(value);
  }

  onKey(event: KeyboardEvent): void {
    const max = this.suggestions().length - 1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.open.set(true);
      this.active.set(Math.min(this.active() + 1, max));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.active.set(Math.max(this.active() - 1, 0));
    } else if (event.key === 'Enter' && this.active() >= 0) {
      event.preventDefault();
      const pick = this.suggestions()[this.active()];
      if (pick) this.pick(pick);
    } else if (event.key === 'Escape') {
      this.open.set(false);
    }
  }

  onBlur(): void {
    // Delay so a mousedown on a suggestion lands first.
    setTimeout(() => this.open.set(false), 120);
  }

  optionClass(i: number): string {
    const base =
      'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm text-slate-800 dark:text-slate-100';
    return i === this.active() ? `${base} bg-indigo-50 dark:bg-indigo-950/60` : base;
  }

  pick(s: Station): void {
    this.text.set(s.name);
    this.code.set(s.code);
    this.open.set(false);
  }

  /** Voice fills text directly; the parent resolves the code from the directory. */
  apply(text: string, code: string | null): void {
    this.text.set(text);
    this.code.set(code);
  }
}
