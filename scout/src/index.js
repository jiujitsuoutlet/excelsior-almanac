// ALMANAC scout Worker entry point.
//
// The real crawl (founder ruling, 2026-09-19: "multi-step listing->detail
// fetching, rate limit enforced across parallel runs, link liveness, page
// grounding") is wired here now -- discover.js (phase 1: listing pages ->
// discovered_pages), ingest.js (phase 2: detail pages -> real events
// rows, respecting every trigger the schema enforces), linkcheck.js
// (re-verifying already-approved rows' registration links stay live).
// This SUPERSEDES the older page_types/buildPlan single-pass model
// (run.js/queue.js), which predates the alias architecture and the real
// two-phase crawl; that code is left in place (still tested, still
// working) rather than deleted, since removing it is a separate,
// deliberate cleanup, not a side effect of this change.
//
// Still fully inert, on purpose, exactly as the original skeleton was:
//
//   1. No Cron Trigger calls it. scout/wrangler.toml has no [triggers]
//      section. Wiring a schedule is a separate, founder-gated step.
//   2. Even if something did call scheduled(), the handler refuses
//      unless env.SCOUT_ENABLED is exactly "true". No checked-in
//      configuration sets that variable anywhere.
//
// A real fetchImpl now exists where disabledFetch's inert third layer
// used to be -- that is exactly why gates 1 and 2 above are load-bearing
// now, not decorative. The founder's own review of this whole crawl path
// is the remaining gate before either one is ever lifted.

import { runDiscovery } from './discover.js';
import { runIngest } from './ingest.js';
import { runLinkCheck } from './linkcheck.js';
import {
  d1ClaimSlot,
  d1ActiveAliasesWithSourceLoader,
  d1EnqueueDiscovered,
  d1PendingPagesLoader,
  d1ExistingEventLoader,
  d1ApplyUpsert,
  d1MarkPageFetched,
  d1MarkPageFailed,
  d1StaleApprovedLinksLoader,
  d1MarkLinkLive,
  d1DemoteDeadLink,
} from './d1adapters.js';
import { d1RunOpener, d1RunCloser } from './run.js';

async function runCrawlCycle(env) {
  const now = Date.now();
  const claimSlot = d1ClaimSlot(env.DB);
  const openRun = d1RunOpener(env.DB);
  const closeRun = d1RunCloser(env.DB);

  const discoveryRunId = await openRun({ component: 'scout_discovery', region: null, startedAt: now });
  let discoveryResult;
  try {
    discoveryResult = await runDiscovery({
      now,
      fetchImpl: fetch,
      loadActiveAliasesWithSource: d1ActiveAliasesWithSourceLoader(env.DB),
      claimSlot,
      enqueueDiscovered: d1EnqueueDiscovered(env.DB),
    });
    await closeRun({ runId: discoveryRunId, status: 'succeeded', finishedAt: Date.now(), pagesFetched: discoveryResult.attempted, errors: discoveryResult.skipped.length, hostsSkipped: discoveryResult.skipped.length });
  } catch (err) {
    await closeRun({ runId: discoveryRunId, status: 'failed', finishedAt: Date.now(), pagesFetched: 0, errors: 1, hostsSkipped: 0 });
    throw err;
  }

  const ingestRunId = await openRun({ component: 'scout_ingest', region: null, startedAt: Date.now() });
  let ingestResult;
  try {
    ingestResult = await runIngest({
      now: Date.now(),
      fetchImpl: fetch,
      claimSlot,
      loadPendingPages: d1PendingPagesLoader(env.DB),
      loadExistingEvent: d1ExistingEventLoader(env.DB),
      applyUpsert: d1ApplyUpsert(env.DB),
      markPageFetched: d1MarkPageFetched(env.DB),
      markPageFailed: d1MarkPageFailed(env.DB),
    });
    await closeRun({ runId: ingestRunId, status: 'succeeded', finishedAt: Date.now(), pagesFetched: ingestResult.fetched, errors: ingestResult.failed.length, hostsSkipped: 0 });
  } catch (err) {
    await closeRun({ runId: ingestRunId, status: 'failed', finishedAt: Date.now(), pagesFetched: 0, errors: 1, hostsSkipped: 0 });
    throw err;
  }

  const linkCheckRunId = await openRun({ component: 'scout_linkcheck', region: null, startedAt: Date.now() });
  let linkCheckResult;
  try {
    linkCheckResult = await runLinkCheck({
      now: Date.now(),
      fetchImpl: fetch,
      claimSlot,
      loadStaleApprovedLinks: d1StaleApprovedLinksLoader(env.DB),
      markLinkLive: d1MarkLinkLive(env.DB),
      demoteDeadLink: d1DemoteDeadLink(env.DB),
    });
    await closeRun({ runId: linkCheckRunId, status: 'succeeded', finishedAt: Date.now(), pagesFetched: linkCheckResult.checked, errors: linkCheckResult.demoted, hostsSkipped: 0 });
  } catch (err) {
    await closeRun({ runId: linkCheckRunId, status: 'failed', finishedAt: Date.now(), pagesFetched: 0, errors: 1, hostsSkipped: 0 });
    throw err;
  }

  return { discovery: discoveryResult, ingest: ingestResult, linkCheck: linkCheckResult };
}

export default {
  // The scout has no member-facing surface (MAD hold 4: "the scout is never
  // reachable by a member"). This Worker is not routed to any public
  // hostname; this handler exists only so the module is well-formed.
  async fetch() {
    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    if (env.SCOUT_ENABLED !== 'true') {
      console.log('scout: SCOUT_ENABLED is not "true"; refusing to run. Scheduling this Worker is a separate, founder-gated step.');
      return;
    }
    const run = runCrawlCycle(env);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(run);
    else await run;
  },
};
