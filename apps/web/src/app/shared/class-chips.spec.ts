import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classChips } from './class-chips';

test('chips: one per class, cheapest first, stamp text and tone carried', () => {
  const chips = classChips([
    { cls: 'SL', fare: 235, availability: { state: 'AVAILABLE', count: 50 } },
    { cls: '3A', fare: 625, availability: { state: 'WL', count: 12, wlPrefix: 'GNWL12' } },
    { cls: '2A', fare: 890, availability: { state: 'RAC', count: 4 } },
  ]);
  assert.deepEqual(chips.map((c) => c.cls), ['SL', '3A', '2A']);
  assert.deepEqual(chips.map((c) => c.fare), [235, 625, 890]);
  assert.equal(chips[0]!.status, 'Available 50');
  // IRCTC notation: the provider's waitlist prefix rides along, as on the stamps.
  assert.equal(chips[1]!.status, 'WL GNWL12/12');
  assert.equal(chips[2]!.status, 'RAC 4');
  assert.equal(chips[0]!.tone, 'rv-avail-ok');
  assert.equal(chips[1]!.tone, 'rv-avail-warn');
  assert.equal(chips[2]!.tone, 'rv-avail-ok');
});

test('chips: empty or missing per-class list means single-class mode, no chips', () => {
  assert.deepEqual(classChips(undefined), []);
  assert.deepEqual(classChips([]), []);
});
