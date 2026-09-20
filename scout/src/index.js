// ALMANAC scout Worker entry point.
//
// The real crawl (founder ruling, 2026-09-19: "multi-step listing->detail
// fetching, rate limit enforced across parallel runs, link liveness, page
// grounding") is wired here now -- robotscheck.js (phase 0: daily robots
// drift, per alias), discover.js (phase 1: listing pages ->
// discovered_pages), ingest.js (phase 2: detail pages -> real events
// rows, respecting every trigger the schema enforces), linkcheck.js
// (re-verifying already-approved rows' event pages still show a
// registration link). This SUPERSEDES the older page_types/buildPlan
// single-pass model (run.js/queue.js), which predates the alias
// architecture and the real multi-phase crawl; that code is left in
// place (still tested, still working) rather than deleted, since
// removing it is a separate, deliberate cleanup, not a side effect of
// this change.
//
// Every phase runs even when it finds nothing to do -- zero active
// aliases (today's real state; ALMANAC has never activated one) is a
// legitimate, fully-exercised empty run, not a skipped one.
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

import { runRobotsRecheck } from './robotscheck.js';
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
  d1RequeueStalePages,
  d1DeactivateSource,
  d1MarkAliasRobotsFresh,
  d1PauseAliasForRobotsDrift,
  d1StaleApprovedLinksLoader,
  d1MarkLinkLive,
  d1DemoteDeadLink,
} from './d1adapters.js';
import { d1RunOpener, d1RunCloser } from './run.js';

// Every crawl_runs row's `component` MUST be one of the six values the
// table's own CHECK constraint permits (core_schema.sql); the phases this
// crawl actually runs (robots re-check, discovery, ingest, link-check)
// are not among them. Opus review, 2026-09-19, B4: the original code used
// its own invented values ('scout_discovery' etc.), which the schema
// rejected on the Worker's very first write -- runCrawlCycle had never
// once been executed against the real schema. `region` carries the
// specific phase name instead; it has no CHECK, and crawl_runs' own
// purpose ("cost and error reporting") is served just as well by it.
const TIER1_COMPONENT = 'tier1_scout';
const LINKCHECK_COMPONENT = 'link_checker';

async function runCrawlCycle(env) {
  const now = Date.now();
  const claimSlot = d1ClaimSlot(env.DB);
  const deactivateSource = (sourceId) => d1DeactivateSource(env.DB)(sourceId);
  const openRun = d1RunOpener(env.DB);
  const closeRun = d1RunCloser(env.DB);
  const loadActiveAliasesWithSource = d1ActiveAliasesWithSourceLoader(env.DB);

  // Phase 0: robots.txt drift, per active alias, before anything else
  // fetches a single page tonight (ARCHITECTURE.md section 9 rule 4;
  // Opus review, 2026-09-19, B3).
  const robotsRunId = await openRun({ component: TIER1_COMPONENT, region: 'robots_check', startedAt: now });
  let robotsResult;
  try {
    robotsResult = await runRobotsRecheck({
      now,
      fetchImpl: fetch,
      loadActiveAliasesWithSource,
      markAliasRobotsFresh: d1MarkAliasRobotsFresh(env.DB),
      pauseAliasForDrift: d1PauseAliasForRobotsDrift(env.DB),
    });
    await closeRun({ runId: robotsRunId, status: 'succeeded', finishedAt: Date.now(), pagesFetched: robotsResult.checked, errors: robotsResult.paused.length, hostsSkipped: robotsResult.skipped.length });
  } catch (err) {
    await closeRun({ runId: robotsRunId, status: 'failed', finishedAt: Date.now(), pagesFetched: 0, errors: 1, hostsSkipped: 0 });
    throw err;
  }

  const discoveryRunId = await openRun({ component: TIER1_COMPONENT, region: 'discovery', startedAt: Date.now() });
  let discoveryResult;
  try {
    discoveryResult = await runDiscovery({
      now: Date.now(),
      fetchImpl: fetch,
      loadActiveAliasesWithSource,
      claimSlot,
      enqueueDiscovered: d1EnqueueDiscovered(env.DB),
      deactivateSource,
    });
    await closeRun({ runId: discoveryRunId, status: 'succeeded', finishedAt: Date.now(), pagesFetched: discoveryResult.attempted, errors: discoveryResult.skipped.length, hostsSkipped: discoveryResult.skipped.length });
  } catch (err) {
    await closeRun({ runId: discoveryRunId, status: 'failed', finishedAt: Date.now(), pagesFetched: 0, errors: 1, hostsSkipped: 0 });
    throw err;
  }

  const ingestRunId = await openRun({ component: TIER1_COMPONENT, region: 'ingest', startedAt: Date.now() });
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
      requeueStalePages: d1RequeueStalePages(env.DB),
      deactivateSource,
    });
    await closeRun({ runId: ingestRunId, status: 'succeeded', finishedAt: Date.now(), pagesFetched: ingestResult.fetched, errors: ingestResult.failed.length, hostsSkipped: 0 });
  } catch (err) {
    await closeRun({ runId: ingestRunId, status: 'failed', finishedAt: Date.now(), pagesFetched: 0, errors: 1, hostsSkipped: 0 });
    throw err;
  }

  const linkCheckRunId = await openRun({ component: LINKCHECK_COMPONENT, region: null, startedAt: Date.now() });
  let linkCheckResult;
  try {
    linkCheckResult = await runLinkCheck({
      now: Date.now(),
      fetchImpl: fetch,
      claimSlot,
      loadStaleApprovedLinks: d1StaleApprovedLinksLoader(env.DB),
      markLinkLive: d1MarkLinkLive(env.DB),
      demoteDeadLink: d1DemoteDeadLink(env.DB),
      deactivateSource,
    });
    await closeRun({ runId: linkCheckRunId, status: 'succeeded', finishedAt: Date.now(), pagesFetched: linkCheckResult.checked, errors: linkCheckResult.demoted, hostsSkipped: 0 });
  } catch (err) {
    await closeRun({ runId: linkCheckRunId, status: 'failed', finishedAt: Date.now(), pagesFetched: 0, errors: 1, hostsSkipped: 0 });
    throw err;
  }

  return { robots: robotsResult, discovery: discoveryResult, ingest: ingestResult, linkCheck: linkCheckResult };
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
