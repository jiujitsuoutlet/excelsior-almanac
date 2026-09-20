import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDiscovery } from '../src/discover.js';

const ALLOWED_SOURCE = {
  id: 'src-smoothcomp',
  host: 'smoothcomp.com',
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

const REAL_LISTING_HTML = `<html><body>${'filler '.repeat(80)}
  <a href="/en/event/900001/fixture-open-2027">Fixture Open</a>
  <a href="/en/event/900002/fixture-spring">Fixture Spring</a>
  <a href="/en/event/900001/scoreboard">Scoreboard (must never be kept)</a>
</body></html>`;

function fakeFetch(responsesByUrl) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url) => {
      calls.push(url);
      const r = responsesByUrl[url];
      if (!r) throw new Error(`no fake response configured for ${url}`);
      return { status: r.status, headers: { get: () => null }, text: async () => r.body };
    },
  };
}

function fakeClaimAlwaysGrants() {
  const claimed = [];
  return { claimed, claimSlot: async (sourceId) => { claimed.push(sourceId); return true; } };
}

test('a grounded listing page enqueues its real event links, excluding scoreboard/etc', async () => {
  const alias = { aliasId: 'a1', host: 'fujibjj.smoothcomp.com', listingPath: '/en/events', source: ALLOWED_SOURCE };
  const { fetchImpl, calls } = fakeFetch({
    'https://fujibjj.smoothcomp.com/en/events': { status: 200, body: REAL_LISTING_HTML },
  });
  const { claimSlot } = fakeClaimAlwaysGrants();
  const enqueued = [];
  const result = await runDiscovery({
    now: 1_000_000,
    fetchImpl,
    loadActiveAliasesWithSource: async () => [alias],
    claimSlot,
    enqueueDiscovered: async (args) => enqueued.push(args),
  });

  assert.equal(calls.length, 1);
  assert.equal(result.attempted, 1);
  assert.equal(result.skipped.length, 0);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].host, 'fujibjj.smoothcomp.com');
  assert.deepEqual(enqueued[0].urls, [
    'https://fujibjj.smoothcomp.com/en/event/900001/fixture-open-2027',
    'https://fujibjj.smoothcomp.com/en/event/900002/fixture-spring',
  ]);
  assert.equal(result.discovered, 2);
});

test('a source the gate refuses is skipped, never fetched', async () => {
  const alias = { aliasId: 'a1', host: 'fujibjj.smoothcomp.com', listingPath: '/', source: { id: 'src-smoothcomp', host: 'smoothcomp.com' } }; // no terms review fields at all
  const { fetchImpl, calls } = fakeFetch({});
  const { claimSlot } = fakeClaimAlwaysGrants();
  const result = await runDiscovery({
    now: 1_000_000,
    fetchImpl,
    loadActiveAliasesWithSource: async () => [alias],
    claimSlot,
    enqueueDiscovered: async () => { throw new Error('must never be called'); },
  });
  assert.equal(calls.length, 0);
  assert.equal(result.attempted, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /page types/);
});

test('a rate-limit claim refusal skips the fetch entirely -- another run/job already has this company\'s slot', async () => {
  const alias = { aliasId: 'a1', host: 'fujibjj.smoothcomp.com', listingPath: '/', source: ALLOWED_SOURCE };
  const { fetchImpl, calls } = fakeFetch({});
  const result = await runDiscovery({
    now: 1_000_000,
    fetchImpl,
    loadActiveAliasesWithSource: async () => [alias],
    claimSlot: async () => false, // simulates a concurrent invocation already owning this window
    enqueueDiscovered: async () => { throw new Error('must never be called'); },
  });
  assert.equal(calls.length, 0);
  assert.equal(result.attempted, 0);
  assert.match(result.skipped[0].reason, /rate limit/);
});

test('a Cloudflare interstitial instead of the real listing page is refused, not parsed', async () => {
  const alias = { aliasId: 'a1', host: 'fujibjj.smoothcomp.com', listingPath: '/', source: ALLOWED_SOURCE };
  const interstitial = `<html><title>Just a moment...</title><body>${'filler '.repeat(80)}Cloudflare needs to review the security of your connection.</body></html>`;
  const { fetchImpl } = fakeFetch({ 'https://fujibjj.smoothcomp.com/': { status: 200, body: interstitial } });
  const { claimSlot } = fakeClaimAlwaysGrants();
  const result = await runDiscovery({
    now: 1_000_000,
    fetchImpl,
    loadActiveAliasesWithSource: async () => [alias],
    claimSlot,
    enqueueDiscovered: async () => { throw new Error('must never be called: an ungrounded page must never reach the parser'); },
  });
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /not grounded/);
});

test('one alias\'s failure does not stop the others in the same run', async () => {
  const aliasBad = { aliasId: 'a1', host: 'broken.smoothcomp.com', listingPath: '/', source: ALLOWED_SOURCE };
  const aliasGood = { aliasId: 'a2', host: 'fujibjj.smoothcomp.com', listingPath: '/', source: ALLOWED_SOURCE };
  const { fetchImpl } = fakeFetch({
    'https://fujibjj.smoothcomp.com/': { status: 200, body: REAL_LISTING_HTML.replace(/fujibjj/g, 'fujibjj') },
  });
  const { claimSlot } = fakeClaimAlwaysGrants();
  const enqueued = [];
  const result = await runDiscovery({
    now: 1_000_000,
    fetchImpl,
    loadActiveAliasesWithSource: async () => [aliasBad, aliasGood],
    claimSlot,
    enqueueDiscovered: async (args) => enqueued.push(args),
  });
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /fetch failed/);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].host, 'fujibjj.smoothcomp.com');
});

test('a 403 pauses the source and is never treated as an ordinary skip -- deactivateSource is called', async () => {
  const alias = { aliasId: 'a1', host: 'fujibjj.smoothcomp.com', listingPath: '/', source: ALLOWED_SOURCE };
  const { fetchImpl } = fakeFetch({ 'https://fujibjj.smoothcomp.com/': { status: 403, body: 'forbidden' } });
  const { claimSlot } = fakeClaimAlwaysGrants();
  const deactivated = [];
  const result = await runDiscovery({
    now: 1_000_000,
    fetchImpl,
    loadActiveAliasesWithSource: async () => [alias],
    claimSlot,
    enqueueDiscovered: async () => { throw new Error('must never be called'); },
    deactivateSource: async (sourceId, reason) => deactivated.push({ sourceId, reason }),
  });
  assert.equal(deactivated.length, 1);
  assert.equal(deactivated[0].sourceId, 'src-smoothcomp');
  assert.deepEqual(result.deactivated, ['src-smoothcomp']);
  assert.match(result.skipped[0].reason, /403/);
});

test('a second alias of the same 403\'d company is skipped without another fetch, in the same run', async () => {
  const aliasOne = { aliasId: 'a1', host: 'fujibjj.smoothcomp.com', listingPath: '/', source: ALLOWED_SOURCE };
  const aliasTwo = { aliasId: 'a2', host: 'nuway.smoothcomp.com', listingPath: '/', source: ALLOWED_SOURCE };
  const { fetchImpl, calls } = fakeFetch({ 'https://fujibjj.smoothcomp.com/': { status: 403, body: 'forbidden' } });
  const { claimSlot } = fakeClaimAlwaysGrants();
  const result = await runDiscovery({
    now: 1_000_000,
    fetchImpl,
    loadActiveAliasesWithSource: async () => [aliasOne, aliasTwo],
    claimSlot,
    enqueueDiscovered: async () => { throw new Error('must never be called'); },
    deactivateSource: async () => {},
  });
  assert.equal(calls.length, 1, 'the second alias of the same company is never fetched once the company has 403\'d this run');
  assert.equal(result.skipped.length, 2);
  assert.match(result.skipped[1].reason, /backed off earlier in this same run/);
});

test('a 429 backs off the company for the rest of this run, but does not deactivate it', async () => {
  const alias = { aliasId: 'a1', host: 'fujibjj.smoothcomp.com', listingPath: '/', source: ALLOWED_SOURCE };
  const { fetchImpl } = fakeFetch({ 'https://fujibjj.smoothcomp.com/': { status: 429, body: 'slow down' } });
  const { claimSlot } = fakeClaimAlwaysGrants();
  const deactivated = [];
  const result = await runDiscovery({
    now: 1_000_000,
    fetchImpl,
    loadActiveAliasesWithSource: async () => [alias],
    claimSlot,
    enqueueDiscovered: async () => { throw new Error('must never be called'); },
    deactivateSource: async (sourceId, reason) => deactivated.push({ sourceId, reason }),
  });
  assert.equal(deactivated.length, 0);
  assert.deepEqual(result.deactivated, []);
  assert.match(result.skipped[0].reason, /429/);
});

test('every discovered url is real (dedup already handled inside parseListingPage), and each alias fetch is judged against its own host, not a hardcoded one', async () => {
  const alias = { aliasId: 'a1', host: 'classiccombat.smoothcomp.com', listingPath: '/en/events', source: ALLOWED_SOURCE };
  const html = `<a href="https://classiccombat.smoothcomp.com/en/event/1/x">X</a><a href="https://classiccombat.smoothcomp.com/en/event/1/x">X again (dup)</a>`;
  const { fetchImpl } = fakeFetch({ 'https://classiccombat.smoothcomp.com/en/events': { status: 200, body: `<html><body>${'filler '.repeat(80)}${html}</body></html>` } });
  const { claimSlot } = fakeClaimAlwaysGrants();
  const enqueued = [];
  await runDiscovery({
    now: 1_000_000,
    fetchImpl,
    loadActiveAliasesWithSource: async () => [alias],
    claimSlot,
    enqueueDiscovered: async (args) => enqueued.push(args),
  });
  assert.equal(enqueued[0].urls.length, 1, 'a duplicate link on the same page is enqueued once');
});
