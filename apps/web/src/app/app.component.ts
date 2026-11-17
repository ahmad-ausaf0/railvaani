import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** App shell: header with the gradient logo tile, the routed page, footer. */
@Component({
  selector: 'rv-root',
  imports: [RouterOutlet],
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
        <span class="rv-lang" title="Interface language: English">EN</span>
      </div>
    </header>

    <router-outlet />

    <footer class="rv-footer mt-10 pt-4 text-center text-xs">
      <p>Data: ConfirmTkt (fares, availability) and erail.in (routes), unofficial mirrors. Booking: IRCTC, the official site.</p>
      <p class="mt-1">RailVaani &middot; voice-first, accessible train search</p>
    </footer>
  `,
})
export class AppComponent {}
