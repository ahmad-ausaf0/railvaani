import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SEAT_CHECK_CAP_MS,
  SLOW_SEARCH_LINE,
  budgetHiddenNote,
  seatCheckLine,
  slowSearchLine,
  visibleError,
} from './search-status';

test('slow search: the step line swaps after 20 seconds only while no options exist', () => {
  assert.equal(slowSearchLine(true, false, true), SLOW_SEARCH_LINE);
  assert.equal(slowSearchLine(true, false, false), null, 'before the 20-second mark the stage text shows');
  assert.equal(slowSearchLine(true, true, true), null, 'options on screen bring the stage text back');
  assert.equal(slowSearchLine(false, false, true), null, 'a settled search shows no step line');
});

test('slow search: an error banner never coexists with options on screen', () => {
  assert.equal(visibleError('The search took too long. Try again.', true), '', 'arriving options clear the error');
  assert.equal(visibleError('Train data could not be reached.', false), 'Train data could not be reached.');
  assert.equal(visibleError('', false), '', 'no error, no banner');
});

test('budget note: the header states how many options the budget hid', () => {
  assert.equal(budgetHiddenNote(3, 600), '3 options hidden by your ₹600 budget');
  assert.equal(budgetHiddenNote(1, 600), '1 option hidden by your ₹600 budget');
  assert.equal(budgetHiddenNote(0, 600), null, 'nothing hidden, no note');
  assert.equal(budgetHiddenNote(3, undefined), null, 'no budget, no note');
});

test('seatCheckLine: pending checks show Checking seats', () => {
  assert.equal(seatCheckLine(true, 1000, 1000 + 29_999), 'Checking seats…');
});

test('seatCheckLine: checks abandoned at the 30s cap, the line clears', () => {
  assert.equal(seatCheckLine(true, 1000, 1000 + SEAT_CHECK_CAP_MS), '');
  assert.equal(seatCheckLine(true, 1000, 1000 + 90_000), '');
});

test('seatCheckLine: empty when the pass settled or never started', () => {
  assert.equal(seatCheckLine(false, 1000, 2000), '');
  assert.equal(seatCheckLine(true, null, 2000), '');
});
