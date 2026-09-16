import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPublishCycle } from '../src/index.js';
import { MAX_BATCH_ROWS } from '../src/payload.js';

function fixtureRow(overrides = {}) {
  return {
    id: 'evt_1',
    name: 'Test Open',
    organizer_name: 'Test Fed',
    start_date: '2026-10-01',
    city: 'Springfield',
    state: 'MO',
    venue_name: null,
    registration_url: 'https://example.com/register',
    registration_deadline: null,
    gi: 1,
    nogi: 0,
    kids: 0,
    source_url: 'https://example.com/events/test-open',
    status: 'approved',
    ...overrides,
  };
}

// A fake D1 binding: `.prepare(sql).bind(...args).all()/.run()`. Records
// every bind call so tests can assert exactly what the Worker asked for,
// without a real database... the same style the scout's fetcher tests use
// for `fetch`.
function fakeDb({ rows = [] } = {}) {
  const calls = { prepare: [], bind: [], run: [] };
  return {
    calls,
    prepare(sql) {
      calls.prepare.push(sql);
      return {
        bind(...args) {
          calls.bind.push(args);
          return {
            all: async () => ({ results: rows }),
            run: async () => {
              calls.run.push(args);
              return { success: true };
            },
          };
        },
      };
    },
  };
}

test('nothing due: the cycle sends nothing and touches no D1 write', async () => {
  const db = fakeDb({ rows: [] });
  let fetchCalled = false;
  const result = await runPublishCycle({
    db,
    fetchFn: async () => { fetchCalled = true; return { ok: true }; },
    secret: 'test-secret',
    appIngestUrl: 'https://app.example/almanac-ingest',
    now: () => Date.parse('2026-09-16T22:00:00.000Z'),
  });
  assert.equal(result.outcome, 'nothing_due');
  assert.equal(result.sent, 0);
  assert.equal(fetchCalled, false, 'an empty cycle must never call the app');
  assert.equal(db.calls.run.length, 0);
});

test('over the cap: nothing is sent, and the app is never called', async () => {
  const rows = Array.from({ length: MAX_BATCH_ROWS + 1 }, (_, i) => fixtureRow({ id: `evt_${i}` }));
  const db = fakeDb({ rows });
  let fetchCalled = false;
  const result = await runPublishCycle({
    db,
    fetchFn: async () => { fetchCalled = true; return { ok: true }; },
    secret: 'test-secret',
    appIngestUrl: 'https://app.example/almanac-ingest',
    now: () => Date.parse('2026-09-16T22:00:00.000Z'),
  });
  assert.equal(result.outcome, 'over_cap');
  assert.equal(result.pending, MAX_BATCH_ROWS + 1);
  assert.equal(fetchCalled, false, 'an over-cap cycle must not silently truncate and send anyway');
});

test('a normal batch is signed, sent, and marks exactly those rows published', async () => {
  const rows = [fixtureRow({ id: 'evt_a' }), fixtureRow({ id: 'evt_b' })];
  const db = fakeDb({ rows });
  let sentHeaders, sentBody;
  const result = await runPublishCycle({
    db,
    fetchFn: async (url, init) => {
      sentHeaders = init.headers;
      sentBody = init.body;
      return { ok: true, status: 200 };
    },
    secret: 'test-secret',
    appIngestUrl: 'https://app.example/almanac-ingest',
    now: () => Date.parse('2026-09-16T22:00:00.000Z'),
  });
  assert.equal(result.outcome, 'published');
  assert.equal(result.sent, 2);
  assert.match(sentHeaders['x-almanac-signature'], /^[0-9a-f]{64}$/);
  const body = JSON.parse(sentBody);
  assert.equal(body.rows.length, 2);
  assert.equal(body.timestamp, '2026-09-16T22:00:00.000Z');

  // The last prepare call was the mark-published UPDATE; its bound ids must
  // be exactly the two rows just sent, not "everything due" (a batch that
  // grew between the SELECT and the UPDATE would otherwise mark unsent rows
  // published).
  const markCallArgs = db.calls.bind.at(-1);
  const markedIds = JSON.parse(markCallArgs[1]);
  assert.deepEqual(markedIds.sort(), ['evt_a', 'evt_b']);
});

test('the app rejecting the batch leaves published_at untouched (no partial success)', async () => {
  const rows = [fixtureRow()];
  const db = fakeDb({ rows });
  const result = await runPublishCycle({
    db,
    fetchFn: async () => ({ ok: false, status: 401 }),
    secret: 'test-secret',
    appIngestUrl: 'https://app.example/almanac-ingest',
    now: () => Date.parse('2026-09-16T22:00:00.000Z'),
  });
  assert.equal(result.outcome, 'app_rejected');
  assert.equal(result.status, 401);
  assert.equal(db.calls.run.length, 0, 'a rejected batch must not mark any row published');
});

test('a stale, previously-published row is included as a retraction candidate', async () => {
  // The SELECT itself lives in selection.js and is exercised for real only
  // against a live database (scripts/verify-publisher.sh); this proves the
  // publish cycle correctly carries a stale row through to the app rather
  // than filtering it out somewhere in this file.
  const rows = [fixtureRow({ status: 'stale', id: 'evt_gone' })];
  const db = fakeDb({ rows });
  let sentBody;
  await runPublishCycle({
    db,
    fetchFn: async (_url, init) => { sentBody = init.body; return { ok: true }; },
    secret: 'test-secret',
    appIngestUrl: 'https://app.example/almanac-ingest',
    now: () => Date.parse('2026-09-16T22:00:00.000Z'),
  });
  const body = JSON.parse(sentBody);
  assert.equal(body.rows[0].status, 'expired', 'a stale ALMANAC row must reach the app as expired, per payload.js');
});
