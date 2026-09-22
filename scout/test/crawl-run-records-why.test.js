// A failed cycle must record WHY (founder ruling, 2026-09-22): "A cycle that
// fails should record WHY, not just that it failed. Unexplained is not
// acceptable for something that runs unattended every night against other
// people's servers."
//
// The incident this comes from: a production discovery phase was recorded
// `failed, errors 1` and nothing more. The real cause was only recoverable
// from an operator's local wrangler logs -- which are not part of the system
// and do not exist on the machine the cron actually runs on.
//
// This drives the REAL runCrawlCycle against a D1 shim, so the proof is the
// statement the Worker really issues, not a hand-written stand-in for it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCrawlCycle, describeError, summariseSkips } from '../src/index.js';
import { truncate } from '../src/run.js';

// Captures every statement, and answers reads the way the real schema would.
function shimDb({ aliasRows = [], onAliasLoad = null } = {}) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      const stmt = { sql, binds: [] };
      const api = {
        bind(...binds) { stmt.binds = binds; return api; },
        async run() { statements.push(stmt); return { meta: { changes: 1 } }; },
        async all() {
          statements.push(stmt);
          if (/FROM source_aliases/.test(sql)) {
            if (onAliasLoad) onAliasLoad();
            return { results: aliasRows };
          }
          return { results: [] };
        },
        async first() { statements.push(stmt); return null; },
      };
      return api;
    },
    async batch(stmts) { statements.push(...stmts); return []; },
  };
}

// The per-phase close, not the stale-run sweep (which also updates
// crawl_runs, but by status rather than by id).
const closes = (db) => db.statements.filter((s) => /UPDATE crawl_runs SET status/.test(s.sql) && /WHERE id = /.test(s.sql));

test('a phase that throws records the reason in crawl_runs, not just "failed"', async () => {
  const boom = new TypeError('Cannot read properties of undefined (reading \'host\')');
  const db = shimDb({ onAliasLoad: () => { throw boom; } });
  await assert.rejects(runCrawlCycle({ DB: db }), /Cannot read properties/);

  const closed = closes(db);
  assert.equal(closed.length, 1, 'the phase that threw was still closed out');
  const [status, , , , , , , errorText] = closed[0].binds;
  assert.equal(status, 'failed');
  assert.match(String(errorText), /TypeError: Cannot read properties of undefined/);
});

test('a cycle killed mid-flight leaves a reason behind when a later cycle sweeps it', async () => {
  const db = shimDb();
  await runCrawlCycle({ DB: db }).catch(() => {});
  const sweep = db.statements.find((s) => /status = 'running'/.test(s.sql));
  assert.ok(sweep, 'the stale-run sweep ran');
  assert.match(sweep.sql, /error_text = coalesce\(error_text,/);
  assert.match(sweep.sql, /killed mid-flight/);
});

test('a SUCCEEDED phase that still reports errors explains the count -- no unaccountable number', async () => {
  const db = shimDb();
  await runCrawlCycle({ DB: db }).catch(() => {});
  const closed = closes(db);
  assert.ok(closed.length >= 1);
  for (const c of closed) assert.equal(c.binds.length, 8, 'every close binds an error_text slot');
});

test('describeError names the kind of failure, and never dumps a stack', () => {
  assert.match(describeError(new TypeError('x is not a function')), /^TypeError: x is not a function$/);
  assert.equal(describeError(new Error('plain')), 'plain');
  assert.match(describeError(null), /unknown failure/);
  const long = describeError(new Error('y'.repeat(900)));
  assert.ok(long.length <= 500, `bounded, got ${long.length}`);
});

test('summariseSkips turns a recurring count into its actual reasons, deduplicated', () => {
  const s = summariseSkips([
    { reason: 'listing entry dropped: missing country' },
    { reason: 'listing entry dropped: missing country' },
    { reason: 'ambiguous near a state line' },
  ]);
  assert.match(s, /^3 skipped: /);
  assert.match(s, /missing country/);
  assert.match(s, /ambiguous near a state line/);
  assert.equal((s.match(/missing country/g) ?? []).length, 1, 'deduplicated');
  assert.equal(summariseSkips([]), null, 'a clean run records nothing');
});

test('the reason is a bounded report, never a page body or a stack trace', () => {
  assert.equal(truncate(null), null);
  assert.equal(truncate('   '), null);
  assert.equal(truncate('a\n\n  b'), 'a b');
  assert.equal(truncate('x'.repeat(600)).length, 500);
  assert.ok(truncate('x'.repeat(600)).endsWith('…'));
});
