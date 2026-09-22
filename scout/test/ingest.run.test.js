// Coverage for runIngest itself (the orchestration loop) -- previously
// zero: ingest.plan.test.js only ever exercised planEventUpsert, the pure
// decision, never the loop that claims a slot, fetches, grounds, parses
// and marks a discovered_pages row done. Opus review, 2026-09-19,
// surfaced several of the real bugs (B5/B8/B12) inside this exact loop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runIngest } from '../src/ingest.js';

const ALLOWED_SOURCE = {
  id: 'src-smoothcomp',
  host: 'smoothcomp.com',
  parser: 'smoothcomp_v1',
  active: 1,
  page_types: '["events"]',
  terms_url: 'https://smoothcomp.com/en/agreements',
  terms_last_updated: '2026-01-01',
  terms_read_on: '2026-09-16',
  terms_automated_access: 'none found',
  terms_reuse: 'none found',
  login_required: 0,
  official_api: 'none',
  excluded_paths: '[]',
  robots_disallowed: '[]',
  robots_crawl_delay_seconds: null,
  robots_sha256: 'a'.repeat(64),
  robots_read_on: '2026-09-16',
  verdict: 'allowed_with_conditions',
  verdict_conditions: 'public listing/detail pages only',
  reviewed_by: 'founder@example.com',
  reviewed_on: '2026-09-16',
};

function eventHtml({ name = 'Fixture Open 2027', startDate = '2027-06-01' } = {}) {
  const jsonLd = JSON.stringify({
    '@type': 'SportsEvent',
    name,
    startDate,
    location: { name: 'Fixture Arena', address: { streetAddress: '1 Main St', addressLocality: 'Testburg', addressRegion: 'MO', addressCountry: 'US' } },
  });
  return `<html><body>${'filler '.repeat(80)}
    <script type="application/ld+json">${jsonLd}</script>
    <a class="js-register-link" href="https://fujibjj.smoothcomp.com/order/900001">Register</a>
  </body></html>`;
}

function page(id, n) {
  return { id, host: 'fujibjj.smoothcomp.com', url: `https://fujibjj.smoothcomp.com/en/event/90000${n}/x`, source: ALLOWED_SOURCE };
}

function fakeFetch(byUrl) {
  const calls = [];
  return { calls, fetchImpl: async (url) => { calls.push(url); const r = byUrl[url]; if (!r) throw new Error(`no fake for ${url}`); return { status: r.status, headers: { get: () => null }, text: async () => r.body ?? '' }; } };
}

const ALIASES = { 'src-smoothcomp': [{ host: 'fujibjj.smoothcomp.com', listingPath: '/en/federation/201/events/upcoming' }] };

function noopDeps(overrides = {}) {
  return {
    aliasesBySource: ALIASES,
    loadExistingEvent: async () => null,
    applyUpsert: async () => {},
    markPageFetched: async () => {},
    markPageFailed: async () => {},
    ...overrides,
  };
}

test('a claim grant lets a page fetch, parse, and land as inserted, marked fetched', async () => {
  const p = page('pg-1', 1);
  const { fetchImpl } = fakeFetch({ [p.url]: { status: 200, body: eventHtml() } });
  const fetchedIds = [];
  const result = await runIngest({
    now: 1_000_000,
    fetchImpl,
    claimSlot: async () => true,
    loadPendingPages: async () => [p],
    ...noopDeps({ markPageFetched: async (id) => fetchedIds.push(id) }),
  });
  assert.equal(result.fetched, 1);
  assert.equal(result.inserted, 1);
  assert.deepEqual(fetchedIds, ['pg-1']);
});

test('THE STARVATION BUG (Opus review, B5): a company that claims its slot on page 1 must still get page 2 within the same run once real time (via the injected claimSlot) allows it -- claimSlot is called once per page, not skipped after the first', async () => {
  const p1 = page('pg-1', 1);
  const p2 = page('pg-2', 2);
  const { fetchImpl } = fakeFetch({ [p1.url]: { status: 200, body: eventHtml({ name: 'Event One' }) }, [p2.url]: { status: 200, body: eventHtml({ name: 'Event Two' }) } });
  const claimCalls = [];
  // A claimSlot that behaves like the real cross-run clock WOULD once it
  // is allowed to wait: first call claims, second call (same company)
  // also succeeds -- proving runIngest's loop calls claimSlot again for
  // page 2 rather than giving up on the whole company after page 1. This
  // is the contract the real d1ClaimSlot (with its real wait-and-retry)
  // fulfills; this fake proves runIngest's OWN loop never short-circuits
  // that contract by only trying once per run.
  const claimSlot = async (source) => { claimCalls.push(source.id); return true; };
  const result = await runIngest({
    now: 1_000_000,
    fetchImpl,
    claimSlot,
    loadPendingPages: async () => [p1, p2],
    ...noopDeps(),
  });
  assert.equal(claimCalls.length, 2, 'runIngest must attempt a claim for every pending page, not just the first');
  assert.equal(result.fetched, 2);
  assert.equal(result.inserted, 2);
});

test('a claim refusal leaves the page pending (not failed), for a later run to try again', async () => {
  const p = page('pg-1', 1);
  const result = await runIngest({
    now: 1_000_000,
    fetchImpl: async () => { throw new Error('must never be called'); },
    claimSlot: async () => false,
    loadPendingPages: async () => [p],
    ...noopDeps({ markPageFailed: async () => { throw new Error('must never be called: a rate-limit skip is not a failure'); } }),
  });
  assert.equal(result.fetched, 0);
  assert.equal(result.failed.length, 0);
});

test('a 403 marks the page failed, deactivates the source, and stops the rest of that company\'s pages for this run', async () => {
  const p1 = page('pg-1', 1);
  const p2 = page('pg-2', 2);
  const { fetchImpl, calls } = fakeFetch({ [p1.url]: { status: 403, body: 'forbidden' } });
  const failedIds = [];
  const deactivated = [];
  const result = await runIngest({
    now: 1_000_000,
    fetchImpl,
    claimSlot: async () => true,
    loadPendingPages: async () => [p1, p2],
    ...noopDeps({ markPageFailed: async (id) => failedIds.push(id) }),
    deactivateSource: async (sourceId, reason) => deactivated.push({ sourceId, reason }),
  });
  assert.equal(calls.length, 1, 'page 2 of the same 403\'d company is never fetched in this run');
  assert.deepEqual(failedIds, ['pg-1']);
  assert.equal(deactivated.length, 1);
  assert.equal(deactivated[0].sourceId, 'src-smoothcomp');
  assert.equal(result.failed.length, 1);
});

test('a 429 leaves the page pending (not failed) and stops the rest of that company\'s pages for this run', async () => {
  const p1 = page('pg-1', 1);
  const p2 = page('pg-2', 2);
  const { fetchImpl, calls } = fakeFetch({ [p1.url]: { status: 429, body: 'slow down' } });
  const result = await runIngest({
    now: 1_000_000,
    fetchImpl,
    claimSlot: async () => true,
    loadPendingPages: async () => [p1, p2],
    ...noopDeps({ markPageFailed: async () => { throw new Error('must never be called: a 429 is not this page\'s fault'); } }),
  });
  assert.equal(calls.length, 1);
  assert.equal(result.failed.length, 0);
});

test('requeueStalePages is called with the real stale-before cutoff before pending pages load', async () => {
  let seenArgs = null;
  await runIngest({
    now: 1_000_000_000,
    fetchImpl: async () => { throw new Error('must never be called'); },
    claimSlot: async () => true,
    loadPendingPages: async () => [],
    requeueStalePages: async (staleBeforeIso, limit) => { seenArgs = { staleBeforeIso, limit }; return 3; },
    requeueAfterMs: 86_400_000,
    requeueLimit: 5,
    ...noopDeps(),
  });
  assert.equal(seenArgs.staleBeforeIso, new Date(1_000_000_000 - 86_400_000).toISOString());
  assert.equal(seenArgs.limit, 5);
});

test('the count of requeued pages is reported back, even when zero', async () => {
  const result = await runIngest({
    now: 1_000_000,
    fetchImpl: async () => { throw new Error('must never be called'); },
    claimSlot: async () => true,
    loadPendingPages: async () => [],
    ...noopDeps(),
  });
  assert.equal(result.requeued, 0);
});

test('a source the gate refuses is failed with the gate\'s own reason, never fetched', async () => {
  const p = { ...page('pg-1', 1), source: { id: 'src-smoothcomp', host: 'smoothcomp.com' } };
  const failedReasons = [];
  const result = await runIngest({
    now: 1_000_000,
    fetchImpl: async () => { throw new Error('must never be called'); },
    claimSlot: async () => true,
    loadPendingPages: async () => [p],
    ...noopDeps({ markPageFailed: async (id, reason) => failedReasons.push(reason) }),
  });
  assert.equal(result.failed.length, 1);
  assert.match(failedReasons[0], /page types/);
});

test("a listing_only source's queued event pages are NEVER fetched -- they are drained as excluded", async () => {
  const p1 = { ...page('pg-1', 1), source: { ...ALLOWED_SOURCE, crawl_mode: 'listing_only' } };
  const excluded = [];
  const result = await runIngest({
    now: 1_000_000,
    fetchImpl: async () => { throw new Error('must never be called: a listing_only source never has its event page fetched'); },
    claimSlot: async () => { throw new Error('must never be called'); },
    loadPendingPages: async () => [p1],
    markPageExcluded: async (id, reason) => excluded.push({ id, reason }),
    ...noopDeps(),
  });
  assert.equal(result.fetched, 0);
  assert.equal(result.excluded, 1);
  assert.equal(excluded[0].id, 'pg-1');
  assert.match(excluded[0].reason, /listing_only/);
});
