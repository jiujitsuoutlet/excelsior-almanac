import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../src/queue.js';

const ALLOWED_HOST = {
  host: 'allowed.example.com',
  active: 1,
  page_types: '["events", "venues", "results"]',
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

const REFUSED_HOST = { host: 'refused.example.com' }; // nothing on file

test('a refused host never appears in the plan, and is named in skipped with its reason', () => {
  const { plan, skipped } = buildPlan([REFUSED_HOST], 1_000_000);
  assert.equal(plan.length, 0);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].host, 'refused.example.com');
  assert.match(skipped[0].reason, /page types to fetch/);
});

test('an allowed host is admitted, one plan entry per page type', () => {
  const { plan, skipped } = buildPlan([ALLOWED_HOST], 1_000_000);
  assert.equal(skipped.length, 0);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((p) => p.pageType), ['events', 'venues', 'results']);
  assert.ok(plan.every((p) => p.host === 'allowed.example.com'));
});

test('a mix of hosts: the refused one contributes nothing to the plan', () => {
  const { plan, skipped } = buildPlan([REFUSED_HOST, ALLOWED_HOST], 1_000_000);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].host, 'refused.example.com');
  assert.ok(plan.every((p) => p.host === 'allowed.example.com'));
  assert.equal(plan.length, 3);
});

test('pages for the same host are spaced at least the minimum interval apart', () => {
  const { plan } = buildPlan([ALLOWED_HOST], 1_000_000);
  assert.equal(plan[0].scheduledAt, 1_000_000);
  assert.equal(plan[1].scheduledAt, 1_010_000);
  assert.equal(plan[2].scheduledAt, 1_020_000);
});

test('spacing honors a Crawl-delay longer than the floor', () => {
  const slow = { ...ALLOWED_HOST, host: 'slow.example.com', robots_crawl_delay_seconds: 30, page_types: '["events", "venues"]' };
  const { plan } = buildPlan([slow], 1_000_000);
  assert.equal(plan[0].scheduledAt, 1_000_000);
  assert.equal(plan[1].scheduledAt, 1_030_000);
});

test('a per-host page cap limits how many pages one host contributes to one run', () => {
  const many = { ...ALLOWED_HOST, page_types: JSON.stringify(['a', 'b', 'c', 'd', 'e']) };
  const { plan } = buildPlan([many], 1_000_000, { pageCapPerHost: 2 });
  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map((p) => p.pageType), ['a', 'b']);
});

test('two allowed hosts are scheduled independently of each other', () => {
  const second = { ...ALLOWED_HOST, host: 'second.example.com', page_types: '["events"]' };
  const { plan } = buildPlan([ALLOWED_HOST, second], 1_000_000);
  const first = plan.filter((p) => p.host === 'allowed.example.com');
  const another = plan.filter((p) => p.host === 'second.example.com');
  assert.equal(first[0].scheduledAt, 1_000_000);
  assert.equal(another[0].scheduledAt, 1_000_000); // independent hosts do not wait on each other
});

test('an empty sources list produces an empty plan and no skips', () => {
  assert.deepEqual(buildPlan([], 1_000_000), { plan: [], skipped: [] });
  assert.deepEqual(buildPlan(undefined, 1_000_000), { plan: [], skipped: [] });
});

test('unreadable page_types produces no pages, but is not treated as a gate refusal', () => {
  const broken = { ...ALLOWED_HOST, page_types: 'not json' };
  const { plan, skipped } = buildPlan([broken], 1_000_000);
  assert.equal(plan.length, 0);
  assert.equal(skipped.length, 0); // the gate allowed it; there is simply nothing to queue
});

test('a previous run\'s limiter state carries forward, so a run cannot restart the clock', () => {
  const priorState = { 'allowed.example.com': 1_005_000 };
  const { plan } = buildPlan([ALLOWED_HOST], 1_000_000, { limiterState: priorState });
  assert.equal(plan[0].scheduledAt, 1_015_000); // 1_005_000 + 10s, not the new run's `now`
});

// ---- Section 9's "one company, many hostnames" ----

const HOSTED = { ...ALLOWED_HOST, id: 'src-hosted', host: 'company.example.com', page_types: '["events"]' };

test('with no aliases, a source crawls under its own host, exactly as before aliases existed', () => {
  const { plan } = buildPlan([HOSTED], 1_000_000, { aliases: [] });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].host, 'company.example.com');
  assert.equal(plan[0].rateLimitHost, 'company.example.com');
});

test('active aliases replace the source host as the real fetch target, one page type per alias', () => {
  const aliases = [
    { source_id: 'src-hosted', host: 'org1.company.example.com', active: 1 },
    { source_id: 'src-hosted', host: 'org2.company.example.com', active: 1 },
  ];
  const { plan } = buildPlan([HOSTED], 1_000_000, { aliases });
  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map((p) => p.host).sort(), ['org1.company.example.com', 'org2.company.example.com']);
});

test('an inactive alias never becomes a fetch target', () => {
  const aliases = [
    { source_id: 'src-hosted', host: 'org1.company.example.com', active: 1 },
    { source_id: 'src-hosted', host: 'not-yet-reviewed.company.example.com', active: 0 },
  ];
  const { plan } = buildPlan([HOSTED], 1_000_000, { aliases });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].host, 'org1.company.example.com');
});

test('every alias of one company shares a single rate-limit clock -- ten subdomains, one clock, not ten', () => {
  const aliases = [
    { source_id: 'src-hosted', host: 'org1.company.example.com', active: 1 },
    { source_id: 'src-hosted', host: 'org2.company.example.com', active: 1 },
    { source_id: 'src-hosted', host: 'org3.company.example.com', active: 1 },
  ];
  const { plan } = buildPlan([HOSTED], 1_000_000, { aliases });
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((p) => p.rateLimitHost), ['company.example.com', 'company.example.com', 'company.example.com']);
  // Each alias still gets a real, spaced slot on that one shared clock --
  // aliases never fetch simultaneously just because they're different hosts.
  assert.deepEqual(plan.map((p) => p.scheduledAt), [1_000_000, 1_010_000, 1_020_000]);
});

test('an alias for a different, still-refused source never appears in the plan', () => {
  const aliases = [{ source_id: 'src-hosted', host: 'org1.company.example.com', active: 1 }];
  const { plan, skipped } = buildPlan([REFUSED_HOST], 1_000_000, { aliases });
  assert.equal(plan.length, 0);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].host, 'refused.example.com');
});
