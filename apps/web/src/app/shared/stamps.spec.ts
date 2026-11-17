import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availTone, stampText, stampTone } from './stamps';

test('stampTone gives waitlist its own violet tone', () => {
  assert.equal(stampTone({ state: 'WL', count: 12 }), 'rv-stamp-wl');
  assert.equal(stampTone({ state: 'AVAILABLE', count: 3 }), 'rv-stamp-ok');
  assert.equal(stampTone({ state: 'RAC', count: 2 }), 'rv-stamp-rac');
  assert.equal(stampTone({ state: 'REGRET' }), 'rv-stamp-bad');
  assert.equal(stampTone({ state: 'NOT_AVAILABLE' }), 'rv-stamp-bad');
  assert.equal(stampTone(undefined), 'rv-stamp-muted');
  assert.equal(stampTone({}), 'rv-stamp-muted');
});

test('availTone keeps violet for waitlist and maps the rest via stampTone', () => {
  assert.equal(availTone({ state: 'WL', count: 12 }), 'rv-avail-wl');
  assert.equal(availTone({ state: 'AVAILABLE', count: 3 }), 'rv-avail-ok');
  assert.equal(availTone({ state: 'RAC', count: 2 }), 'rv-avail-rac');
  assert.equal(availTone({ state: 'REGRET' }), 'rv-avail-bad');
  assert.equal(availTone(undefined), 'rv-avail-muted');
});

test('stampText keeps IRCTC waitlist notation', () => {
  assert.equal(stampText({ state: 'WL', count: 98, wlPrefix: 'GNWL' }), 'WL GNWL/98');
  assert.equal(stampText({ state: 'WL', count: 8 }), 'WL 8');
  assert.equal(stampText({ state: 'WL', count: 0 }), 'Waitlist');
});
