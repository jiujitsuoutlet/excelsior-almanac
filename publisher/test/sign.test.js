import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify, isTimestampFresh, MAX_TIMESTAMP_AGE_MS } from '../src/sign.js';

test('sign produces a hex string that verify accepts with the same secret', async () => {
  const signature = await sign('{"a":1}', 'test-secret');
  assert.match(signature, /^[0-9a-f]{64}$/, 'HMAC-SHA256 is 32 bytes, 64 hex characters');
  assert.equal(await verify('{"a":1}', signature, 'test-secret'), true);
});

test('verify rejects a valid signature checked against the wrong secret', async () => {
  const signature = await sign('{"a":1}', 'test-secret');
  assert.equal(await verify('{"a":1}', signature, 'wrong-secret'), false);
});

test('verify rejects a signature over payload text that was altered after signing', async () => {
  const signature = await sign('{"a":1}', 'test-secret');
  assert.equal(await verify('{"a":2}', signature, 'test-secret'), false);
});

test('verify rejects garbage that is not valid hex, without throwing', async () => {
  assert.equal(await verify('{"a":1}', 'not-hex-at-all!!', 'test-secret'), false);
  assert.equal(await verify('{"a":1}', '', 'test-secret'), false);
});

test('sign and verify refuse an empty secret rather than silently signing with nothing', async () => {
  await assert.rejects(() => sign('{"a":1}', ''), /secret/);
  await assert.rejects(() => verify('{"a":1}', 'aa', ''), /secret/);
});

test('two different payloads produce two different signatures under the same secret', async () => {
  const sig1 = await sign('{"a":1}', 'test-secret');
  const sig2 = await sign('{"a":2}', 'test-secret');
  assert.notEqual(sig1, sig2);
});

test('isTimestampFresh accepts a timestamp from right now', () => {
  const now = Date.parse('2026-09-16T22:00:00.000Z');
  assert.equal(isTimestampFresh('2026-09-16T22:00:00.000Z', now), true);
});

test('isTimestampFresh accepts a timestamp just inside the window', () => {
  const now = Date.parse('2026-09-16T22:00:00.000Z');
  const justInside = new Date(now - (MAX_TIMESTAMP_AGE_MS - 1000)).toISOString();
  assert.equal(isTimestampFresh(justInside, now), true);
});

test('isTimestampFresh rejects a timestamp just outside the window (the replay law)', () => {
  const now = Date.parse('2026-09-16T22:00:00.000Z');
  const justOutside = new Date(now - (MAX_TIMESTAMP_AGE_MS + 1000)).toISOString();
  assert.equal(isTimestampFresh(justOutside, now), false);
});

test('isTimestampFresh rejects a timestamp from the future (clock skew is not a free pass)', () => {
  const now = Date.parse('2026-09-16T22:00:00.000Z');
  const future = new Date(now + 60_000).toISOString();
  assert.equal(isTimestampFresh(future, now), false);
});

test('isTimestampFresh rejects an unparseable timestamp rather than treating it as fresh', () => {
  assert.equal(isTimestampFresh('not-a-date', Date.now()), false);
  assert.equal(isTimestampFresh('', Date.now()), false);
});
