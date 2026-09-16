import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextAllowedAt, recordFetch, minIntervalSeconds, MINIMUM_INTERVAL_SECONDS } from '../src/limiter.js';

test('a host never fetched before is allowed right now', () => {
  assert.equal(nextAllowedAt('example.com', 1_000_000, {}), 1_000_000);
});

test('the minimum interval is 10 seconds even with no declared Crawl-delay', () => {
  assert.equal(minIntervalSeconds(null), MINIMUM_INTERVAL_SECONDS);
  assert.equal(minIntervalSeconds(undefined), MINIMUM_INTERVAL_SECONDS);
  assert.equal(minIntervalSeconds(NaN), MINIMUM_INTERVAL_SECONDS);
  assert.equal(minIntervalSeconds(3), MINIMUM_INTERVAL_SECONDS); // shorter than the floor never wins
});

test('a Crawl-delay longer than 10 seconds is honored', () => {
  assert.equal(minIntervalSeconds(25), 25);
});

test('spacing: the next request waits the full interval after the last one', () => {
  const state = recordFetch('example.com', 1_000_000, {});
  assert.equal(nextAllowedAt('example.com', 1_000_000, state), 1_010_000); // 10s floor
  assert.equal(nextAllowedAt('example.com', 1_005_000, state), 1_010_000); // asking early still waits
  assert.equal(nextAllowedAt('example.com', 1_020_000, state), 1_020_000); // asking late needs no extra wait
});

test('spacing honors a Crawl-delay longer than the floor', () => {
  const state = recordFetch('slow.example.com', 1_000_000, {});
  assert.equal(nextAllowedAt('slow.example.com', 1_000_000, state, 30), 1_030_000);
});

test('recordFetch is pure: it returns a new state and never mutates the input', () => {
  const before = { 'a.example.com': 1 };
  const after = recordFetch('b.example.com', 2, before);
  assert.deepEqual(before, { 'a.example.com': 1 });
  assert.deepEqual(after, { 'a.example.com': 1, 'b.example.com': 2 });
  assert.notEqual(before, after);
});

test('hosts are independent: one host being due does not affect another', () => {
  let state = recordFetch('a.example.com', 1_000_000, {});
  state = recordFetch('b.example.com', 1_000_005, state);
  assert.equal(nextAllowedAt('a.example.com', 1_000_006, state), 1_010_000);
  assert.equal(nextAllowedAt('b.example.com', 1_000_006, state), 1_010_005);
});
