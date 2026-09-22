import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRobotsRecheck } from '../src/robotscheck.js';
import { sha256Hex } from '../src/fetcher.js';

const REAL_ROBOTS = 'User-agent: *\nDisallow: /order/\nCrawl-delay: 10\n';

const SOURCE = {
  id: 'src-smoothcomp', host: 'smoothcomp.com', parser: 'smoothcomp_v1', active: 1,
  page_types: '["events"]', terms_url: 'https://smoothcomp.com/en/agreements', terms_last_updated: '2026-01-01',
  terms_read_on: '2026-09-16', terms_automated_access: 'none found', terms_reuse: 'none found', login_required: 0,
  official_api: 'none', excluded_paths: '[]', robots_disallowed: '[]', robots_crawl_delay_seconds: null,
  robots_sha256: 'a'.repeat(64), robots_read_on: '2026-09-16', verdict: 'allowed_with_conditions',
  verdict_conditions: 'public listing/detail pages only', reviewed_by: 'founder@example.com', reviewed_on: '2026-09-16',
};

function alias({ host = 'fujibjj.smoothcomp.com', robotsSha256, source = SOURCE } = {}) {
  return { aliasId: `alias-${host}`, host, listingPath: '/en/events', robotsSha256, source };
}

function fakeFetch(byUrl) {
  const calls = [];
  return { calls, fetchImpl: async (url) => { calls.push(url); const r = byUrl[url]; if (!r) throw new Error(`no fake for ${url}`); return { status: r.status, headers: { get: () => null }, text: async () => r.body ?? '' }; } };
}

test('an unchanged robots.txt just refreshes robots_read_on, never pauses the alias', async () => {
  const hash = await sha256Hex(REAL_ROBOTS);
  const a = alias({ robotsSha256: hash });
  const { fetchImpl } = fakeFetch({ 'https://fujibjj.smoothcomp.com/robots.txt': { status: 200, body: REAL_ROBOTS } });
  const fresh = [];
  const paused = [];
  const result = await runRobotsRecheck({
    now: 1_000_000,
    fetchImpl,
    loadActiveAliasesWithSource: async () => [a],
    markAliasRobotsFresh: async (aliasId, todayIso) => fresh.push({ aliasId, todayIso }),
    pauseAliasForDrift: async (aliasId) => paused.push(aliasId),
  });
  assert.equal(result.checked, 1);
  assert.equal(result.unchanged, 1);
  assert.equal(paused.length, 0);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].aliasId, a.aliasId);
});

test('a changed robots.txt pauses the alias, does not touch the recorded hash, and never marks it fresh', async () => {
  const oldHash = await sha256Hex(REAL_ROBOTS);
  const a = alias({ robotsSha256: oldHash });
  const changed = `${REAL_ROBOTS}Disallow: /new-secret-path/\n`;
  const { fetchImpl } = fakeFetch({ 'https://fujibjj.smoothcomp.com/robots.txt': { status: 200, body: changed } });
  const fresh = [];
  const paused = [];
  const result = await runRobotsRecheck({
    now: 1_000_000,
    fetchImpl,
    loadActiveAliasesWithSource: async () => [a],
    markAliasRobotsFresh: async (aliasId) => fresh.push(aliasId),
    pauseAliasForDrift: async (aliasId) => paused.push(aliasId),
  });
  assert.equal(result.paused.length, 1);
  assert.match(result.paused[0].reason, /changed/);
  assert.deepEqual(paused, [a.aliasId]);
  assert.equal(fresh.length, 0);
});

test('robots.txt disappearing (404) after being reviewed with real content is drift too -- it pauses, never silently allow_all', async () => {
  const a = alias({ robotsSha256: 'a'.repeat(64) });
  const { fetchImpl } = fakeFetch({ 'https://fujibjj.smoothcomp.com/robots.txt': { status: 404, body: '' } });
  const paused = [];
  const result = await runRobotsRecheck({
    now: 1_000_000,
    fetchImpl,
    loadActiveAliasesWithSource: async () => [a],
    markAliasRobotsFresh: async () => {},
    pauseAliasForDrift: async (aliasId) => paused.push(aliasId),
  });
  assert.equal(paused.length, 1);
  assert.equal(result.checked, 1);
});

test('a Cloudflare challenge instead of the real robots.txt is skipped, not trusted as either "same" or "changed"', async () => {
  const a = alias({ robotsSha256: 'a'.repeat(64) });
  const challenge = `<html><title>Just a moment...</title><body>${'filler '.repeat(80)}Cloudflare needs to review the security of your connection.</body></html>`;
  const { fetchImpl } = fakeFetch({ 'https://fujibjj.smoothcomp.com/robots.txt': { status: 200, body: challenge } });
  const paused = [];
  const fresh = [];
  const result = await runRobotsRecheck({
    now: 1_000_000,
    fetchImpl,
    loadActiveAliasesWithSource: async () => [a],
    markAliasRobotsFresh: async (aliasId) => fresh.push(aliasId),
    pauseAliasForDrift: async (aliasId) => paused.push(aliasId),
  });
  assert.equal(paused.length, 0);
  assert.equal(fresh.length, 0);
  assert.equal(result.skipped.length, 1);
});

test('a fetch failure is skipped, not treated as drift', async () => {
  const a = alias({ robotsSha256: 'a'.repeat(64) });
  const paused = [];
  const result = await runRobotsRecheck({
    now: 1_000_000,
    fetchImpl: async () => { throw new Error('ECONNRESET'); },
    loadActiveAliasesWithSource: async () => [a],
    markAliasRobotsFresh: async () => {},
    pauseAliasForDrift: async (aliasId) => paused.push(aliasId),
  });
  assert.equal(paused.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /fetch failed/);
});

test('an alias with no recorded hash at all is skipped, never guessed at', async () => {
  const a = alias({ robotsSha256: null });
  const result = await runRobotsRecheck({
    now: 1_000_000,
    fetchImpl: async () => { throw new Error('must never be called'); },
    loadActiveAliasesWithSource: async () => [a],
    markAliasRobotsFresh: async () => {},
    pauseAliasForDrift: async () => {},
  });
  assert.equal(result.checked, 0);
  assert.equal(result.skipped.length, 1);
});

test('multiple active aliases are each checked independently', async () => {
  const hash = await sha256Hex(REAL_ROBOTS);
  const a1 = alias({ host: 'fujibjj.smoothcomp.com', robotsSha256: hash });
  const a2 = alias({ host: 'nuway.smoothcomp.com', robotsSha256: 'f'.repeat(64) });
  const { fetchImpl } = fakeFetch({
    'https://fujibjj.smoothcomp.com/robots.txt': { status: 200, body: REAL_ROBOTS },
    'https://nuway.smoothcomp.com/robots.txt': { status: 200, body: REAL_ROBOTS },
  });
  const paused = [];
  const fresh = [];
  const result = await runRobotsRecheck({
    now: 1_000_000,
    fetchImpl,
    loadActiveAliasesWithSource: async () => [a1, a2],
    markAliasRobotsFresh: async (aliasId) => fresh.push(aliasId),
    pauseAliasForDrift: async (aliasId) => paused.push(aliasId),
  });
  assert.equal(result.checked, 2);
  assert.deepEqual(fresh, [a1.aliasId]);
  assert.deepEqual(paused, [a2.aliasId]);
});
