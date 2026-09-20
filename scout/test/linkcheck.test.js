import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLinkCheck } from '../src/linkcheck.js';

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

const EVENT_DETAIL_URL = 'https://fujibjj.smoothcomp.com/en/event/900001/fixture-open-2027';

function eventDetailHtml({ registrationHref = 'https://fujibjj.smoothcomp.com/order/900001' } = {}) {
  const jsonLd = JSON.stringify({
    '@type': 'SportsEvent',
    name: 'Fixture Open 2027',
    startDate: '2027-06-01',
    location: { name: 'Fixture Arena', address: { streetAddress: '1 Main St', addressLocality: 'Testburg', addressRegion: 'MO', addressCountry: 'US' } },
  });
  return `<html><body>${'filler '.repeat(80)}
    <script type="application/ld+json">${jsonLd}</script>
    <a class="js-register-link" href="${registrationHref}">Register</a>
  </body></html>`;
}

function fakeFetch(byUrl) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url) => {
      calls.push(url);
      const r = byUrl[url];
      if (!r) throw new Error(`no fake response for ${url}`);
      return { status: r.status, headers: { get: () => null }, text: async () => r.body ?? '' };
    },
  };
}

function fakeState() {
  const live = [];
  const demoted = [];
  const deactivated = [];
  return {
    live,
    demoted,
    deactivated,
    markLinkLive: async (id, nowIso) => live.push({ id, nowIso }),
    demoteDeadLink: async (id, nowIso, reason, actor) => demoted.push({ id, nowIso, reason, actor }),
    deactivateSource: async (sourceId, reason) => deactivated.push({ sourceId, reason }),
  };
}

const LINK = {
  id: 'evt-1',
  sourceUrl: EVENT_DETAIL_URL,
  host: 'fujibjj.smoothcomp.com',
  sourceId: 'src-smoothcomp',
  source: ALLOWED_SOURCE,
};

test('a live event page, still showing a registration link, is confirmed and never demoted', async () => {
  const { fetchImpl } = fakeFetch({ [EVENT_DETAIL_URL]: { status: 200, body: eventDetailHtml() } });
  const { live, demoted, markLinkLive, demoteDeadLink } = fakeState();
  const result = await runLinkCheck({
    now: 1_000_000,
    fetchImpl,
    claimSlot: async () => true,
    loadStaleApprovedLinks: async () => [LINK],
    markLinkLive,
    demoteDeadLink,
  });
  assert.equal(result.confirmedLive, 1);
  assert.equal(result.demoted, 0);
  assert.equal(live.length, 1);
  assert.equal(live[0].id, 'evt-1');
  assert.equal(demoted.length, 0);
});

test('never fetches the registration_url itself -- only the event detail page (source_url) is requested', async () => {
  const { fetchImpl, calls } = fakeFetch({ [EVENT_DETAIL_URL]: { status: 200, body: eventDetailHtml() } });
  const { markLinkLive, demoteDeadLink } = fakeState();
  await runLinkCheck({
    now: 1_000_000,
    fetchImpl,
    claimSlot: async () => true,
    loadStaleApprovedLinks: async () => [LINK],
    markLinkLive,
    demoteDeadLink,
  });
  assert.deepEqual(calls, [EVENT_DETAIL_URL]);
  assert.ok(!calls.some((u) => u.includes('/order/')), 'an /order/ URL must never be fetched by the link checker');
});

test('a 404 on the event page demotes the row for a human to look at again -- it is not silently rejected', async () => {
  const { fetchImpl } = fakeFetch({ [EVENT_DETAIL_URL]: { status: 404, body: 'not found' } });
  const { demoted, markLinkLive, demoteDeadLink } = fakeState();
  const result = await runLinkCheck({
    now: 1_000_000,
    fetchImpl,
    claimSlot: async () => true,
    loadStaleApprovedLinks: async () => [LINK],
    markLinkLive,
    demoteDeadLink,
  });
  assert.equal(result.demoted, 1);
  assert.match(demoted[0].reason, /no longer grounds/);
  assert.match(demoted[0].actor, /^system:/);
});

test('an unrelated redirect is inconclusive, not proof of a working page -- it demotes, per the brief\'s own words', async () => {
  async function fetchImplRedirect() {
    return { status: 302, headers: { get: (h) => (h === 'location' ? 'https://smoothcomp.com/en/login' : null) } };
  }
  const { demoted, markLinkLive, demoteDeadLink } = fakeState();
  const result = await runLinkCheck({
    now: 1_000_000,
    fetchImpl: fetchImplRedirect,
    claimSlot: async () => true,
    loadStaleApprovedLinks: async () => [LINK],
    markLinkLive,
    demoteDeadLink,
  });
  assert.equal(result.demoted, 1);
  assert.match(demoted[0].reason, /redirected/);
});

test('a Cloudflare challenge on a "live" 200 response still demotes, not confirms', async () => {
  const challenge = `<html><title>Just a moment...</title><body>${'filler '.repeat(80)}Cloudflare needs to review the security of your connection.</body></html>`;
  const { fetchImpl } = fakeFetch({ [EVENT_DETAIL_URL]: { status: 200, body: challenge } });
  const { demoted, markLinkLive, demoteDeadLink } = fakeState();
  const result = await runLinkCheck({
    now: 1_000_000,
    fetchImpl,
    claimSlot: async () => true,
    loadStaleApprovedLinks: async () => [LINK],
    markLinkLive,
    demoteDeadLink,
  });
  assert.equal(result.demoted, 1);
  assert.equal(result.confirmedLive, 0);
});

test('a real, grounded event page that no longer shows a registration link demotes -- the registration went away', async () => {
  const html = `<html><body>${'filler '.repeat(80)}
    <script type="application/ld+json">${JSON.stringify({ '@type': 'SportsEvent', name: 'Fixture Open 2027', startDate: '2027-06-01', location: { name: 'X', address: { streetAddress: '1', addressLocality: 'Testburg', addressRegion: 'MO', addressCountry: 'US' } } })}</script>
  </body></html>`;
  const { fetchImpl } = fakeFetch({ [EVENT_DETAIL_URL]: { status: 200, body: html } });
  const { demoted, markLinkLive, demoteDeadLink } = fakeState();
  const result = await runLinkCheck({
    now: 1_000_000,
    fetchImpl,
    claimSlot: async () => true,
    loadStaleApprovedLinks: async () => [LINK],
    markLinkLive,
    demoteDeadLink,
  });
  assert.equal(result.demoted, 1);
  assert.match(demoted[0].reason, /no longer shows a registration link/);
});

test('a fetch that throws (network failure, host refusal) demotes rather than crashing the whole run', async () => {
  const { demoted, markLinkLive, demoteDeadLink } = fakeState();
  const result = await runLinkCheck({
    now: 1_000_000,
    fetchImpl: async () => { throw new Error('ECONNRESET'); },
    claimSlot: async () => true,
    loadStaleApprovedLinks: async () => [LINK],
    markLinkLive,
    demoteDeadLink,
  });
  assert.equal(result.demoted, 1);
  assert.match(demoted[0].reason, /fetch failed/);
});

test('a claim refusal skips the link entirely this run -- it stays approved, tried again later, not demoted on a rate-limit technicality', async () => {
  const { demoted, live, markLinkLive, demoteDeadLink } = fakeState();
  const result = await runLinkCheck({
    now: 1_000_000,
    fetchImpl: async () => { throw new Error('must never be called'); },
    claimSlot: async () => false,
    loadStaleApprovedLinks: async () => [LINK],
    markLinkLive,
    demoteDeadLink,
  });
  assert.equal(result.checked, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(demoted.length, 0);
  assert.equal(live.length, 0);
});

test('a source the gate refuses is skipped, never fetched, and never demotes anything', async () => {
  const unreviewed = { ...LINK, source: { id: 'src-smoothcomp', host: 'smoothcomp.com' } };
  const { demoted, live, markLinkLive, demoteDeadLink } = fakeState();
  const result = await runLinkCheck({
    now: 1_000_000,
    fetchImpl: async () => { throw new Error('must never be called'); },
    claimSlot: async () => true,
    loadStaleApprovedLinks: async () => [unreviewed],
    markLinkLive,
    demoteDeadLink,
  });
  assert.equal(result.checked, 0);
  assert.match(result.skipped[0].reason, /page types/);
  assert.equal(demoted.length, 0);
  assert.equal(live.length, 0);
});

test('a 403 pauses the source (not just this row) and is never treated as a dead link', async () => {
  const { fetchImpl } = fakeFetch({ [EVENT_DETAIL_URL]: { status: 403, body: 'forbidden' } });
  const { demoted, deactivated, markLinkLive, demoteDeadLink, deactivateSource } = fakeState();
  const result = await runLinkCheck({
    now: 1_000_000,
    fetchImpl,
    claimSlot: async () => true,
    loadStaleApprovedLinks: async () => [LINK],
    markLinkLive,
    demoteDeadLink,
    deactivateSource,
  });
  assert.equal(demoted.length, 0, 'a 403 is our own access being refused, not evidence the event is gone');
  assert.equal(deactivated.length, 1);
  assert.equal(deactivated[0].sourceId, 'src-smoothcomp');
  assert.equal(result.confirmedLive, 0);
});

test('a second link from the same backed-off company is skipped, not fetched again, in the same run', async () => {
  const linkTwo = { ...LINK, id: 'evt-2' };
  const { fetchImpl, calls } = fakeFetch({ [EVENT_DETAIL_URL]: { status: 403, body: 'forbidden' } });
  const { demoted, markLinkLive, demoteDeadLink, deactivateSource } = fakeState();
  const result = await runLinkCheck({
    now: 1_000_000,
    fetchImpl,
    claimSlot: async () => true,
    loadStaleApprovedLinks: async () => [LINK, linkTwo],
    markLinkLive,
    demoteDeadLink,
    deactivateSource,
  });
  assert.equal(calls.length, 1, 'only the first link of the backed-off company is ever fetched this run');
  assert.equal(result.skipped.some((s) => s.id === 'evt-2'), true);
  assert.equal(demoted.length, 0);
});

test('loadStaleApprovedLinks receives the real stale-before cutoff and a bounded limit', async () => {
  let seenArgs = null;
  await runLinkCheck({
    now: 1_000_000_000,
    fetchImpl: async () => ({ status: 200, headers: { get: () => null }, text: async () => eventDetailHtml() }),
    claimSlot: async () => true,
    loadStaleApprovedLinks: async (staleBeforeIso, limit) => { seenArgs = { staleBeforeIso, limit }; return []; },
    markLinkLive: async () => {},
    demoteDeadLink: async () => {},
    staleAfterMs: 86_400_000,
    maxChecks: 7,
  });
  assert.equal(seenArgs.staleBeforeIso, new Date(1_000_000_000 - 86_400_000).toISOString());
  assert.equal(seenArgs.limit, 7);
});
