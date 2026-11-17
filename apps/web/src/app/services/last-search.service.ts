import { Injectable, signal } from '@angular/core';

/** What the search page prefills when the URL carries no params (browser Back). */
export interface LastSearch {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  date: string;
  quota: string;
  budget: string;
}

@Injectable({ providedIn: 'root' })
export class LastSearchService {
  private readonly last = signal<LastSearch | null>(null);

  save(params: LastSearch): void {
    this.last.set(params);
  }

  read(): LastSearch | null {
    return this.last();
  }
}
