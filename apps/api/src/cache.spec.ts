import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Cache } from './cache.js';

/** Steppable clock for expiry tests. */
function fakeClock() {
  let t = 1_000;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

test('get returns the stored value while fresh', () => {
  const cache = new Cache<string>();
  cache.set('a', 'hello', 60_000);
  assert.equal(cache.get('a'), 'hello');
});

test('get misses after the entry expires and drops the stale entry', () => {
  const clock = fakeClock();
  const cache = new Cache<string>(500, clock.now);
  cache.set('a', 'hello', 60_000);
  clock.advance(59_999);
  assert.equal(cache.get('a'), 'hello');
  clock.advance(1);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.size, 0);
});

test('overwriting re-stamps the fetch time and refreshes the TTL', () => {
  const clock = fakeClock();
  const cache = new Cache<string>(500, clock.now);
  cache.set('a', 'old', 1_000);
  clock.advance(900);
  cache.set('a', 'new', 1_000);
  clock.advance(900);
  assert.equal(cache.get('a'), 'new');
  clock.advance(101);
  assert.equal(cache.get('a'), undefined);
});

test('entries past the cap evict oldest-fetched first', () => {
  const clock = fakeClock();
  const cache = new Cache<string>(2, clock.now);
  cache.set('a', '1', 60_000);
  clock.advance(10);
  cache.set('b', '2', 60_000);
  clock.advance(10);
  cache.set('c', '3', 60_000);
  assert.equal(cache.get('a'), undefined); // oldest fetch, evicted
  assert.equal(cache.get('b'), '2');
  assert.equal(cache.get('c'), '3');
  assert.equal(cache.size, 2);
});

test('overwritten entries keep their place as newest for eviction', () => {
  const clock = fakeClock();
  const cache = new Cache<string>(2, clock.now);
  cache.set('a', '1', 60_000);
  clock.advance(10);
  cache.set('b', '2', 60_000);
  clock.advance(10);
  cache.set('a', '1b', 60_000); // re-stamped: now newer than b
  clock.advance(10);
  cache.set('c', '3', 60_000); // cap exceeded: oldest is now b
  assert.equal(cache.get('a'), '1b');
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('c'), '3');
});
