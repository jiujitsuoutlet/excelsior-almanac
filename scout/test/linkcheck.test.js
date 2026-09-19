import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLinkCheck } from '../src/linkcheck.js';

const REAL_PAGE = `<html><body>${'filler '.repeat(80)}Register now for Fixture Open 2027.</body></html>`;

function fakeFetch(byUrl) {
  const calls = [];
  return { calls, fetchImpl: async (url) => {
    calls.push(url);
    const r = byUrl[url];
    if (!r) throw new Error(`no fake response for ${url}`);
    return { status: r.status, headers: { get: () => null }, text: async () => r.body ?? '' };
  } };
}

function fakeState() {
  const live = [];
  const demoted = [];
  return { live, demoted, markLinkLive: async (id, nowIso) => live.push({ id, nowIso }), demoteDeadLink: async (id, nowIso, reason, actor) => demoted.push({ id, nowIso, reason, actor }) };
}

const LINK = {
  id: 'evt-1',
  registrationUrl: 'https://fujibjj.smoothcomp.com/en/event/900001/register',
  host: 'fujibjj.smoothcomp.com',
  sourceId: 'src-smoothcomp',
};

test('a live link is confirmed and never demoted', async () => {
  const { fetchImpl } = fakeFetch({ [LINK.registrationUrl]: { status: 200, body: REAL_PAGE } });
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

test('a 404 demotes the row for a human to look at again -- it is not silently rejected', async () => {
  const { fetchImpl } = fakeFetch({ [LINK.registrationUrl]: { status: 404, body: 'not found' } });
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
  assert.equal(demoted[0].reason, 'registration link no longer grounds: http 404, not a successful response');
  assert.match(demoted[0].actor, /^system:/);
});

test('an unrelated redirect is inconclusive, not proof of a working page -- it demotes, per the brief\'s own words', async () => {
  async function fetchImplRedirect() {
    return { status: 302, headers: { get: (h) => (h === 'location' ? 'https://smoothcomp.com/en/login' : null) } };
  }
  const { demoted, markLinkLive, demoteDeadLink } = fakeState();
  // fetchOnce itself reports redirects via redirectTo, computed inside
  // fetcher.js from the real Response; this fake exercises linkcheck's
  // own handling of that shape via groundPage, same contract fetchOnce
  // guarantees.
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
  const { fetchImpl } = fakeFetch({ [LINK.registrationUrl]: { status: 200, body: challenge } });
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

test('loadStaleApprovedLinks receives the real stale-before cutoff and a bounded limit', async () => {
  let seenArgs = null;
  await runLinkCheck({
    now: 1_000_000_000,
    fetchImpl: async () => ({ status: 200, headers: { get: () => null }, text: async () => REAL_PAGE }),
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
