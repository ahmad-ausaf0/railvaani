import { Component } from '@angular/core';

/** App shell. Real screens arrive in Milestone 4; a11y structure is in place from day one. */
@Component({
  selector: 'rv-root',
  imports: [],
  template: `
    <a class="skip-link" href="#main">Skip to main content</a>
    <header class="app-header">
      <p class="app-title">RailVaani</p>
    </header>
    <main id="main" class="app-main">
      <h1>Find trains by voice</h1>
      <p>Search trains and seat availability by speaking or typing. The full search screen arrives with the results milestone.</p>
    </main>
  `,
  styles: [`
    .skip-link {
      position: absolute;
      left: -999px;
      top: 0;
      background: var(--rv-color-bg);
      color: var(--rv-color-text);
      padding: 8px 16px;
      z-index: 100;
    }
    .skip-link:focus { left: 8px; top: 8px; }
    .app-header { padding: 8px 16px; border-bottom: 1px solid #d0d0d0; }
    .app-title { margin: 0; font-weight: 700; }
    .app-main { padding: 16px; max-width: 720px; margin: 0 auto; }
  `],
})
export class AppComponent {}
