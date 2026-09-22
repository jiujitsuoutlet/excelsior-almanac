// Proof that there is no fetch path in Scout except the one gate (founder
// ruling, 2026-09-21: "a test proves there is no other fetch path. If a
// fourth instance of this bug is possible after that, the chokepoint is
// wrong").
//
// Two independent proofs, because either alone has a hole:
//
//   1. STATIC. Read every source file and refuse any network call site, or
//      any import of the raw fetch functions, outside scout/src/fetchgate.js
//      (and fetcher.js, which defines them). This catches a NEW path the
//      moment someone writes one, before it ever runs.
//   2. BEHAVIOURAL. Drive all four real phases with a listing_only source,
//      realistic inputs and a spy fetchImpl, and assert no event page ever
//      reaches the network. This catches a path the static scan cannot see
//      (a URL built somewhere unexpected, a gate that decides wrongly).
//
// Neither reads a hand-typed list of "the phases": the static proof reads
// the directory, so a new file is covered the moment it exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCOUT_SRC = path.join(ROOT, 'scout', 'src');
const SCRIPTS = path.join(ROOT, 'scripts');
const rel = (p) => path.relative(ROOT, p);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// Comments are prose, not code: a comment saying "fetchOnce() returns" is
// not a call. Strip them, keeping line breaks so reported line numbers stay
// real.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, lead) => lead);
}

// Every way code here can reach the network. `fetch` as a bare call only --
// `.fetch(` (e.g. env.ASSETS.fetch) and the Worker's own `async fetch(`
// handler definition are not requests this crawl makes.
const CALL_PATTERNS = [
  { name: 'fetchOnce()', re: /(?<![\w$.])fetchOnce\s*\(/ },
  { name: 'fetchRobots()', re: /(?<![\w$.])fetchRobots\s*\(/ },
  { name: 'fetchImpl()', re: /(?<![\w$.])fetchImpl\s*\(/ },
  { name: 'global fetch()', re: /(?<![\w$.])(?<!async\s)fetch\s*\(/ },
];

function callSites(file) {
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    if (/^\s*async\s+fetch\s*\(/.test(line)) return; // a Worker handler definition, not a call
    if (/\bfunction\s+\w+\s*\(/.test(line)) return; // a definition, not a call
    for (const p of CALL_PATTERNS) if (p.re.test(line)) hits.push({ file: rel(file), line: i + 1, what: p.name, text: line.trim() });
  });
  return hits;
}

function rawFetcherImports(file) {
  const src = stripComments(readFileSync(file, 'utf8'));
  const hits = [];
  const re = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]*fetcher\.js)['"]/g;
  let m = re.exec(src);
  while (m) {
    const what = m[1];
    if (/\*\s+as/.test(what) || /\bfetchOnce\b/.test(what) || /\bfetchRobots\b/.test(what)) hits.push({ file: rel(file), what: what.replace(/\s+/g, ' ') });
    m = re.exec(src);
  }
  if (/import\s*\(\s*['"][^'"]*fetcher\.js['"]\s*\)/.test(src)) hits.push({ file: rel(file), what: 'dynamic import of fetcher.js' });
  return hits;
}

// ---- 1. static ----

test('inside scout/src, the ONLY network call sites are the gate and the fetcher that defines its primitives', () => {
  const allowed = {
    'scout/src/fetcher.js': new Set(['fetchImpl()']), // the ONE place a real request is issued, inside fetchOnce
    'scout/src/fetchgate.js': new Set(['fetchOnce()']), // the ONE caller
  };
  const violations = walk(SCOUT_SRC)
    .filter((f) => f.endsWith('.js'))
    .flatMap(callSites)
    .filter((h) => !(allowed[h.file]?.has(h.what)));
  assert.deepEqual(violations, [], `a network call outside the fetch gate:\n${JSON.stringify(violations, null, 2)}`);
});

test('inside scout/src, nothing but the gate may even IMPORT the raw fetch functions (no namespace import, no dynamic import)', () => {
  const violations = walk(SCOUT_SRC)
    .filter((f) => f.endsWith('.js') && rel(f) !== 'scout/src/fetchgate.js')
    .flatMap(rawFetcherImports);
  assert.deepEqual(violations, [], `raw fetch functions imported outside the gate:\n${JSON.stringify(violations, null, 2)}`);
});

test('the gate really does make its one request through fetchOnce -- the allowance above is not describing a file that moved', () => {
  const gate = stripComments(readFileSync(path.join(SCOUT_SRC, 'fetchgate.js'), 'utf8'));
  assert.equal((gate.match(/(?<![\w$.])fetchOnce\s*\(/g) ?? []).length, 1, 'exactly one request site in the gate');
  assert.match(gate, /decideFetch\(rawUrl/, 'and it decides before it requests');
});

// Scripts are human-run, never scheduled, but a crawl-target fetch from a
// script is still a fetch. Each exemption below is named with the reason it
// cannot go through the gate, and the list must match reality exactly: an
// unlisted call site fails, and so does an exemption for a file that no
// longer needs one.
const SCRIPT_EXEMPTIONS = {
  'scripts/verify-fetcher.sh': 'the fetcher\'s OWN battery: it exercises fetchOnce directly, and only ever against a local HTTPS server on localhost (asserted below)',
  'scripts/console-walkthrough.mjs': 'drives the console\'s own API on localhost; not a crawl target',
  'scripts/review-aliases.mjs': 'pre-activation terms review: a host is reviewed BEFORE it can be an active alias, so the gate cannot authorise it by construction; human-run; reads only robots.txt and the terms page',
};

test('in scripts/, every network call site either goes through the gate or is a named, reasoned exemption -- and no exemption is stale', () => {
  const files = walk(SCRIPTS).filter((f) => /\.(m?js|sh)$/.test(f));
  const withCalls = new Set(files.filter((f) => callSites(f).length > 0 || rawFetcherImports(f).length > 0).map(rel));
  const unlisted = [...withCalls].filter((f) => !(f in SCRIPT_EXEMPTIONS));
  const stale = Object.keys(SCRIPT_EXEMPTIONS).filter((f) => !withCalls.has(f));
  assert.deepEqual(unlisted, [], `script fetch sites outside the gate with no exemption: ${unlisted.join(', ')}`);
  assert.deepEqual(stale, [], `exemptions for files that no longer fetch (remove them): ${stale.join(', ')}`);
});

test('the fetcher battery\'s direct calls really are localhost-only, which is the whole basis of its exemption', () => {
  const src = readFileSync(path.join(SCRIPTS, 'verify-fetcher.sh'), 'utf8');
  const targets = [...src.matchAll(/fetchOnce\(\s*`([^`]*)`/g)].map((m) => m[1]);
  assert.ok(targets.length > 0, 'found the battery\'s calls (if this fails the check below reads nothing)');
  for (const t of targets) assert.match(t, /^(\$\{base\}|https?:\/\/localhost[:/])/, `non-local target in the fetcher battery: ${t}`);
});

test('the hand-run crawl tool (fetch-one) goes through the gate, not around it', () => {
  const src = stripComments(readFileSync(path.join(SCRIPTS, 'fetch-one.mjs'), 'utf8'));
  assert.equal(callSites(path.join(SCRIPTS, 'fetch-one.mjs')).length, 0);
  assert.match(src, /gatedFetch\(/);
});

// ---- 2. behavioural ----

const LISTING_ONLY = {
  id: 'src-smoothcomp', host: 'smoothcomp.com', parser: 'smoothcomp_v1', crawl_mode: 'listing_only', active: 1,
  page_types: '["events"]', terms_url: 'https://smoothcomp.com/en/agreements', terms_last_updated: '2026-01-01',
  terms_read_on: '2026-09-16', terms_automated_access: 'none found', terms_reuse: 'none found', login_required: 0,
  official_api: 'none', excluded_paths: '[]', robots_disallowed: '[]', robots_crawl_delay_seconds: 10,
  robots_sha256: 'a'.repeat(64), robots_read_on: '2026-09-16', verdict: 'allowed_with_conditions',
  verdict_conditions: 'public listing/detail pages only', reviewed_by: 'founder@example.com', reviewed_on: '2026-09-16',
};
const HOST = 'naga.smoothcomp.com';
const LISTING_PATH = '/en/federation/32/events/upcoming';
const ALIAS_ROW = { aliasId: 'alias-naga', host: HOST, listingPath: LISTING_PATH, robotsSha256: 'b'.repeat(64), source: LISTING_ONLY };
const ALIASES_BY_SOURCE = { 'src-smoothcomp': [{ host: HOST, listingPath: LISTING_PATH }] };
const EVENT_URL = `https://${HOST}/en/event/32996`;

test('EVERY PHASE, listing_only source, realistic inputs: not one event page ever reaches the network', async () => {
  const { runRobotsRecheck } = await import('../src/robotscheck.js');
  const { runDiscovery } = await import('../src/discover.js');
  const { runIngest } = await import('../src/ingest.js');
  const { runLinkCheck } = await import('../src/linkcheck.js');

  const requested = [];
  const listingHtml = `<html><body>${'x'.repeat(500)}<a href="${EVENT_URL}">e</a><script>var events = [];</script></body></html>`;
  const fetchImpl = async (url) => {
    requested.push(url);
    const body = url.endsWith('/robots.txt') ? 'User-agent: *\nDisallow: /order/\n' : listingHtml;
    return { status: 200, headers: { get: () => null }, text: async () => body };
  };
  const claimSlot = async () => true;

  await runRobotsRecheck({ now: 1, fetchImpl, loadActiveAliasesWithSource: async () => [ALIAS_ROW], markAliasRobotsFresh: async () => {}, pauseAliasForDrift: async () => {} });
  await runDiscovery({ now: 1, fetchImpl, claimSlot, loadActiveAliasesWithSource: async () => [ALIAS_ROW], enqueueDiscovered: async () => {}, upsertListingDrafts: async () => ({ written: 0 }) });
  // A stale queue entry for an event page -- exactly what the first
  // listing-mode run tripped over.
  await runIngest({
    now: 1, fetchImpl, claimSlot, aliasesBySource: ALIASES_BY_SOURCE,
    loadPendingPages: async () => [{ id: 'pg-1', host: HOST, url: EVENT_URL, source: LISTING_ONLY }],
    loadExistingEvent: async () => null, applyUpsert: async () => {}, markPageFetched: async () => {}, markPageFailed: async () => {}, markPageExcluded: async () => {},
  });
  // A legacy approved row with NO link_check_method -- exactly the
  // production NAGA row that paused the source on 2026-09-21.
  await runLinkCheck({
    now: 1, fetchImpl, claimSlot, aliasesBySource: ALIASES_BY_SOURCE,
    loadStaleApprovedLinks: async () => [{ id: 'naga', sourceUrl: EVENT_URL, registrationUrl: EVENT_URL, host: HOST, linkCheckMethod: null, sourceId: LISTING_ONLY.id, source: LISTING_ONLY }],
    markLinkLive: async () => {}, demoteDeadLink: async () => {},
  });

  const eventPages = requested.filter((u) => /\/en\/event\//.test(u));
  assert.deepEqual(eventPages, [], `an event page reached the network: ${eventPages.join(', ')}`);
  // ...and the phases really ran: robots and the listing page were fetched.
  assert.ok(requested.includes(`https://${HOST}/robots.txt`), 'robots phase ran');
  assert.ok(requested.includes(`https://${HOST}${LISTING_PATH}`), 'discovery phase ran');
});
