import type { Routes } from '@angular/router';

import { SearchPageComponent } from './pages/search-page.component';

/** "" is the search form; /results reads its search from the URL params and
 *  lazy-loads, so the initial bundle carries only the form. Unknown paths go home. */
export const routes: Routes = [
  { path: '', component: SearchPageComponent, title: 'RailVaani: voice-first train search' },
  {
    path: 'results',
    loadComponent: () =>
      import('./pages/results-page.component').then((m) => m.ResultsPageComponent),
    title: 'Results · RailVaani',
  },
  { path: '**', redirectTo: '' },
];
