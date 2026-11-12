import { Component, input, model, output, signal } from '@angular/core';

import { Station } from '@railvaani/train-core';

/** Station field with typeahead over the all-India directory and a code chip. */
@Component({
  selector: 'rv-station-input',
  template: `
    <label class="rv-label" [for]="id()">
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
        class="rv-input pr-16"
        [placeholder]="placeholder()"
      />
      @if (code()) {
        <span
          class="rv-badge pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
        >{{ code() }}</span>
      }
      @if (open() && suggestions().length > 0) {
        <ul
          role="listbox"
          [id]="id() + '-list'"
          class="rv-listbox absolute z-30 mt-1 max-h-64 w-full overflow-auto py-1"
        >
          @for (s of suggestions(); track s.code; let i = $index) {
            <li
              role="option"
              [attr.aria-selected]="i === active()"
              (mousedown)="$event.preventDefault(); pick(s)"
              (mouseenter)="active.set(i)"
              [class]="optionClass(i)"
            >
              <span class="truncate">{{ s.name }}</span>
              <span class="shrink-0 font-mono text-xs t-soft">{{ s.code }}</span>
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
    const base = 'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm t-ink';
    return i === this.active() ? `${base} rv-opt-active` : base;
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
