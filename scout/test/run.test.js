import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScoutRun, disabledFetch } from '../src/run.js';

const ALLOWED_HOST = {
  host: 'allowed.example.com',
  active: 1,
  page_types: '["events"]',
  terms_url: 'https://allowed.example.com/terms',
  terms_last_updated: '2026-01-01',
  terms_read_on: '2026-09-01',
  terms_automated_access: 'none found',
  terms_reuse: 'none found',
  login_required: 0,
  official_api: 'none',
  excluded_paths: '[]',
  robots_disallowed: '[]',
  robots_crawl_delay_seconds: null,
  robots_sha256: 'a'.repeat(64),
  robots_read_on: '2026-09-01',
  verdict: 'allowed',
  verdict_conditions: null,
  reviewed_by: 'reviewer@example.com',
  reviewed_on: '2026-09-01',
};

const REFUSED_HOST = { host: 'refused.example.com' };

// A fake "database": records what run.js asked it to do, with no real I/O
// and no real network anywhere in reach.
function fakeStore(sources) {
  const closed = [];
  let opened = null;
  return {
    closed,
    get opened() {
      return opened;
    },
    loadSources: async () => sources,
    openRun: async (args) => {
      opened = args;
      return 'run-1';
    },
    closeRun: async (args) => {
      closed.push(args);
    },
  };
}

function countingFetch(impl = async () => {}) {
  const calls = [];
  const fn = async (entry) => {
    calls.push(entry);
    return impl(entry);
  };
  fn.calls = calls;
  return fn;
}

test('runScoutRun refuses to run without an injected fetchImpl (never defaults to a real fetch)', async () => {
  const store = fakeStore([]);
  await assert.rejects(
    () => runScoutRun({ loadSources: store.loadSources, openRun: store.openRun, closeRun: store.closeRun }),
    /injected fetchImpl/,
  );
});

test('when every host is gated, the injected fetcher is never called and the run succeeds with zero pages', async () => {
  const store = fakeStore([REFUSED_HOST, REFUSED_HOST]);
  const fetchImpl = countingFetch();
  const result = await runScoutRun({
    fetchImpl,
    now: () => 1_000_000,
    loadSources: store.loadSources,
    openRun: store.openRun,
    closeRun: store.closeRun,
  });

  assert.equal(fetchImpl.calls.length, 0, 'a gate refusal must never reach the fetch step');
  assert.equal(result.status, 'succeeded');
  assert.equal(result.pagesFetched, 0);
  assert.equal(result.errors, 0);
  assert.equal(result.skipped.length, 2);
  assert.equal(store.closed[0].hostsSkipped, 2);
  assert.equal(store.closed[0].pagesFetched, 0);
  assert.equal(store.closed[0].errors, 0);
  assert.equal(store.closed[0].status, 'succeeded');
});

test('when a host is allowed, the runner attempts a fetch, and the disabled fetcher fails the run loudly', async () => {
  const store = fakeStore([ALLOWED_HOST]);
  const result = await runScoutRun({
    fetchImpl: disabledFetch,
    now: () => 1_000_000,
    loadSources: store.loadSources,
    openRun: store.openRun,
    closeRun: store.closeRun,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.errors, 1);
  assert.equal(result.pagesFetched, 0);
  assert.equal(store.closed[0].status, 'failed');
  assert.equal(store.closed[0].errors, 1);
});

test('the fetcher wired up in this pull request always throws the exact skeleton message', () => {
  assert.throws(() => disabledFetch({ host: 'anything.example.com' }), /fetching is not enabled in the skeleton/);
});

test('a mix of gated and allowed hosts: only the allowed host reaches the fetch step, once per page', async () => {
  const store = fakeStore([REFUSED_HOST, ALLOWED_HOST]);
  const fetchImpl = countingFetch();
  const result = await runScoutRun({
    fetchImpl,
    now: () => 1_000_000,
    loadSources: store.loadSources,
    openRun: store.openRun,
    closeRun: store.closeRun,
  });

  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].host, 'allowed.example.com');
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].host, 'refused.example.com');
  assert.equal(result.pagesFetched, 1);
  assert.equal(result.status, 'succeeded');
});

test('opens the run before touching sources, and closes it exactly once with final counts', async () => {
  const store = fakeStore([ALLOWED_HOST]);
  const fetchImpl = countingFetch();
  await runScoutRun({
    component: 'tier1_scout',
    region: 'MO',
    fetchImpl,
    now: () => 1_000_000,
    loadSources: store.loadSources,
    openRun: store.openRun,
    closeRun: store.closeRun,
  });

  assert.deepEqual(store.opened, { component: 'tier1_scout', region: 'MO', startedAt: 1_000_000 });
  assert.equal(store.closed.length, 1);
  assert.equal(store.closed[0].runId, 'run-1');
});

test('a run with no sources at all still opens and closes cleanly', async () => {
  const store = fakeStore([]);
  const fetchImpl = countingFetch();
  const result = await runScoutRun({
    fetchImpl,
    now: () => 1_000_000,
    loadSources: store.loadSources,
    openRun: store.openRun,
    closeRun: store.closeRun,
  });
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(result.status, 'succeeded');
  assert.equal(store.closed[0].hostsSkipped, 0);
});
