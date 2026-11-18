import assert from 'node:assert/strict';
import { test } from 'node:test';

import { expandedSearchNote } from './search-status';

test('no expansion means no note', () => {
  assert.equal(expandedSearchNote([]), null);
});

test('one expanded city names it alone', () => {
  assert.equal(expandedSearchNote(['Delhi']), 'Searched all Delhi stations');
});

test('both ends expanding join their cities in one line', () => {
  assert.equal(
    expandedSearchNote(['Gorakhpur', 'Delhi']),
    'Searched all Gorakhpur and Delhi stations',
  );
});
