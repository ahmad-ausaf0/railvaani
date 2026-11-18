import { isDevMode } from '@angular/core';

/** The one place an API URL may appear. Dev builds call the local RailVaani
 *  API; the production value is a placeholder that B6 replaces with the real
 *  deployed API URL. */
export const apiBaseUrl = isDevMode()
  ? 'http://localhost:3000'
  : 'https://api.railvaani.example';
