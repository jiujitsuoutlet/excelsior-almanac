import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimRateLimitSlot } from '../src/limiter.js';

// A minimal fake of the one D1 call shape claimRateLimitSlot makes
// (prepare -> bind -> run), faithful to THIS exact statement's semantics
// -- not a general SQL engine. What this proves: the function binds its
// parameters in the right order, and interprets `meta.changes` correctly
// (a claim succeeded only when the UPDATE actually changed a row). What
// it does NOT prove: that D1 itself executes a single UPDATE ... WHERE
// atomically across two truly concurrent Worker invocations -- that is a
// property of D1/SQLite's own single-writer model, which this function
// relies on by construction (one statement, no read-then-write in
// application code) rather than something a JS-level unit test can
// independently verify.
function fakeSourcesTable(rows) {
  return {
    prepare(sql) {
      return {
        bind(nowIso, sourceId, cutoffIso) {
          return {
            async run() {
              const row = rows.find((r) => r.id === sourceId);
              const eligible = row && (row.last_claimed_at === null || row.last_claimed_at <= cutoffIso);
              if (eligible) row.last_claimed_at = nowIso;
              return { meta: { changes: eligible ? 1 : 0 } };
            },
          };
        },
      };
    },
  };
}

test('a source never claimed before is claimable', async () => {
  const db = fakeSourcesTable([{ id: 'src-1', last_claimed_at: null }]);
  assert.equal(await claimRateLimitSlot(db, 'src-1', 1_000_000), true);
});

test('claiming again immediately, before the interval elapses, is refused', async () => {
  const db = fakeSourcesTable([{ id: 'src-1', last_claimed_at: null }]);
  assert.equal(await claimRateLimitSlot(db, 'src-1', 1_000_000, 10), true);
  assert.equal(await claimRateLimitSlot(db, 'src-1', 1_000_005, 10), false); // 5s later, floor is 10s
});

test('claiming again after the interval elapses succeeds', async () => {
  const db = fakeSourcesTable([{ id: 'src-1', last_claimed_at: null }]);
  assert.equal(await claimRateLimitSlot(db, 'src-1', 1_000_000, 10), true);
  assert.equal(await claimRateLimitSlot(db, 'src-1', 1_010_000, 10), true); // exactly 10s later
});

test('a longer interval (a real Crawl-delay) is honored', async () => {
  const db = fakeSourcesTable([{ id: 'src-1', last_claimed_at: null }]);
  assert.equal(await claimRateLimitSlot(db, 'src-1', 1_000_000, 30), true);
  assert.equal(await claimRateLimitSlot(db, 'src-1', 1_010_000, 30), false); // 10s later, floor is 30s
  assert.equal(await claimRateLimitSlot(db, 'src-1', 1_030_000, 30), true);
});

test('two different sources have independent clocks', async () => {
  const db = fakeSourcesTable([
    { id: 'src-1', last_claimed_at: null },
    { id: 'src-2', last_claimed_at: null },
  ]);
  assert.equal(await claimRateLimitSlot(db, 'src-1', 1_000_000, 10), true);
  assert.equal(await claimRateLimitSlot(db, 'src-2', 1_000_001, 10), true); // src-2 unaffected by src-1's claim
});

// The scenario this function exists for: two separate calls representing
// two separate Worker invocations (a Tier 1 run and a link-recheck run)
// both trying to touch the same company within the same window -- only
// one may win.
test("simulated concurrent invocations: only one of two overlapping claims for the same source succeeds", async () => {
  const db = fakeSourcesTable([{ id: 'src-1', last_claimed_at: null }]);
  const [a, b] = await Promise.all([
    claimRateLimitSlot(db, 'src-1', 1_000_000, 10),
    claimRateLimitSlot(db, 'src-1', 1_000_000, 10),
  ]);
  assert.equal([a, b].filter(Boolean).length, 1, `exactly one claim should win, got a=${a} b=${b}`);
});

test('an unknown source id is never claimable', async () => {
  const db = fakeSourcesTable([{ id: 'src-1', last_claimed_at: null }]);
  assert.equal(await claimRateLimitSlot(db, 'src-does-not-exist', 1_000_000), false);
});
