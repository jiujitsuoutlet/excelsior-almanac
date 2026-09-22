// The one fetch gate's own rules, case by case. Every refusal below is a
// refusal EVERY phase inherits, because every phase asks this one function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideFetch, gatedFetch } from '../src/fetchgate.js';
import { USER_AGENT } from '../src/identity.js';

const SOURCE = {
  id: 'src-smoothcomp', host: 'smoothcomp.com', parser: 'smoothcomp_v1', crawl_mode: 'listing_and_detail', active: 1,
  page_types: '["events"]', terms_url: 'https://smoothcomp.com/en/agreements', terms_last_updated: '2026-01-01',
  terms_read_on: '2026-09-16', terms_automated_access: 'none found', terms_reuse: 'none found', login_required: 0,
  official_api: 'none', excluded_paths: '[]', robots_disallowed: '[]', robots_crawl_delay_seconds: 10,
  robots_sha256: 'a'.repeat(64), robots_read_on: '2026-09-16', verdict: 'allowed_with_conditions',
  verdict_conditions: 'public listing/detail pages only', reviewed_by: 'founder@example.com', reviewed_on: '2026-09-16',
};
const LISTING_ONLY = { ...SOURCE, crawl_mode: 'listing_only' };
const ALIASES = [{ host: 'fujibjj.smoothcomp.com', listingPath: '/en/federation/201/events/upcoming' }];
const ctx = (source = SOURCE) => ({ source, aliases: ALIASES });

test('the three reviewed shapes are allowed, and named for what they are', () => {
  assert.deepEqual(decideFetch('https://fujibjj.smoothcomp.com/robots.txt', ctx()), { ok: true, kind: 'robots', host: 'fujibjj.smoothcomp.com' });
  assert.deepEqual(decideFetch('https://fujibjj.smoothcomp.com/en/federation/201/events/upcoming', ctx()), { ok: true, kind: 'listing', host: 'fujibjj.smoothcomp.com' });
  assert.deepEqual(decideFetch('https://fujibjj.smoothcomp.com/en/event/30778', ctx()), { ok: true, kind: 'event_page', host: 'fujibjj.smoothcomp.com' });
});

test('THE RULE THAT BROKE THREE TIMES: a listing_only source never gets an event page, whoever asks', () => {
  const d = decideFetch('https://fujibjj.smoothcomp.com/en/event/30778', ctx(LISTING_ONLY));
  assert.equal(d.ok, false);
  assert.equal(d.code, 'listing_only');
  // ...while its robots.txt and its reviewed listing page stay reachable.
  assert.equal(decideFetch('https://fujibjj.smoothcomp.com/robots.txt', ctx(LISTING_ONLY)).ok, true);
  assert.equal(decideFetch('https://fujibjj.smoothcomp.com/en/federation/201/events/upcoming', ctx(LISTING_ONLY)).ok, true);
});

test('a source the terms gate refuses cannot reach ANY URL, robots.txt included -- stopping a source stops everything', () => {
  for (const url of ['https://fujibjj.smoothcomp.com/robots.txt', 'https://fujibjj.smoothcomp.com/en/federation/201/events/upcoming', 'https://fujibjj.smoothcomp.com/en/event/1']) {
    assert.equal(decideFetch(url, ctx({ ...SOURCE, active: 0 })).code, 'source_gate', url);
  }
});

test('a host that is not an active alias is refused, including the bare parent domain and look-alikes', () => {
  for (const url of [
    'https://smoothcomp.com/robots.txt',
    'https://agf.smoothcomp.com/en/event/1',
    'https://fujibjj.smoothcomp.com.evil.com/en/event/1',
    'https://evil.com/en/event/1',
  ]) {
    assert.equal(decideFetch(url, ctx()).code, 'not_active_alias', url);
  }
});

test('the parser\'s exclusion list is the gate\'s exclusion list: /order/, brackets, athletes, percent-encoded traversal', () => {
  for (const path of ['/order/900001', '/en/event/1/brackets', '/en/athlete/5', '/en/event/1/%2e%2e%2forder%2fx', '/en/about', '/']) {
    assert.equal(decideFetch(`https://fujibjj.smoothcomp.com${path}`, ctx()).code, 'path_not_allowed', path);
  }
});

test('only the alias\'s OWN reviewed listing path counts as a listing -- not another alias\'s, not a variant', () => {
  assert.notEqual(decideFetch('https://fujibjj.smoothcomp.com/en/federation/202/events/upcoming', ctx()).kind, 'listing');
  assert.notEqual(decideFetch('https://fujibjj.smoothcomp.com/en/federation/201/events/upcoming?x=1', ctx()).kind, 'listing');
});

test('non-https, malformed and credential-carrying URLs are refused before anything else is considered', () => {
  assert.equal(decideFetch('http://fujibjj.smoothcomp.com/robots.txt', ctx()).code, 'not_https');
  assert.equal(decideFetch('not a url', ctx()).code, 'malformed');
  assert.equal(decideFetch('https://u:p@fujibjj.smoothcomp.com/robots.txt', ctx()).code, 'malformed');
});

test('a source with no registered parser gets its robots and listing, but never an event page', () => {
  const noParser = { ...SOURCE, parser: 'nope_v1' };
  assert.equal(decideFetch('https://fujibjj.smoothcomp.com/robots.txt', ctx(noParser)).ok, true);
  assert.equal(decideFetch('https://fujibjj.smoothcomp.com/en/event/1', ctx(noParser)).code, 'no_parser');
});

test('gatedFetch: a refusal never reaches fetchImpl OR the rate-limit clock', async () => {
  const r = await gatedFetch('https://fujibjj.smoothcomp.com/en/event/1', {
    ...ctx(LISTING_ONLY),
    fetchImpl: async () => { throw new Error('must never be called'); },
    claimSlot: async () => { throw new Error('a refused request must not consume the shared clock'); },
    now: 1,
  });
  assert.equal(r.refused.code, 'listing_only');
});

test('gatedFetch: robots.txt claims no slot; listing and event pages always do', async () => {
  const claims = [];
  const fetchImpl = async () => ({ status: 200, headers: { get: () => null }, text: async () => 'x'.repeat(500) });
  const claimSlot = async (source) => { claims.push(source.id); return true; };
  await gatedFetch('https://fujibjj.smoothcomp.com/robots.txt', { ...ctx(), fetchImpl, claimSlot, now: 1 });
  assert.equal(claims.length, 0);
  await gatedFetch('https://fujibjj.smoothcomp.com/en/federation/201/events/upcoming', { ...ctx(), fetchImpl, claimSlot, now: 1 });
  await gatedFetch('https://fujibjj.smoothcomp.com/en/event/1', { ...ctx(), fetchImpl, claimSlot, now: 1 });
  assert.equal(claims.length, 2);
});

test('gatedFetch: a refused claim is reported, and nothing is fetched', async () => {
  const r = await gatedFetch('https://fujibjj.smoothcomp.com/en/event/1', {
    ...ctx(), fetchImpl: async () => { throw new Error('must never be called'); }, claimSlot: async () => false, now: 1,
  });
  assert.equal(r.rateLimited, true);
});

test('robots.txt: requested at its own path on the alias, with the pinned honest user agent, and refused on any other host', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response('User-agent: *\nDisallow:\n', { status: 200 }); };
  const r = await gatedFetch('https://fujibjj.smoothcomp.com/robots.txt', { ...ctx(), fetchImpl, now: 1 });
  assert.equal(r.kind, 'robots');
  assert.equal(calls[0].url, 'https://fujibjj.smoothcomp.com/robots.txt');
  assert.equal(calls[0].init.headers['User-Agent'], USER_AGENT);
  const other = await gatedFetch('https://example.com/robots.txt', { ...ctx(), fetchImpl: async () => { throw new Error('must not run'); }, now: 1 });
  assert.equal(other.refused.code, 'not_active_alias');
});
