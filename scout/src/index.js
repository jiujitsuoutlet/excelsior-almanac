// ALMANAC scout Worker entry point.
//
// The real crawl (founder ruling, 2026-09-19: "multi-step listing->detail
// fetching, rate limit enforced across parallel runs, link liveness, page
// grounding") is wired here now -- robotscheck.js (phase 0: daily robots
// drift, per alias), discover.js (phase 1: listing pages ->
// discovered_pages), ingest.js (phase 2: detail pages -> real events
// rows, respecting every trigger the schema enforces), linkcheck.js
// (re-verifying already-approved rows' event pages still show a
// registration link). Every one of their requests goes through ONE
// function, fetchgate.js's gatedFetch (founder ruling, 2026-09-21).
//
// Every phase runs even when it finds nothing to do: zero active aliases is
// a legitimate, fully-exercised empty run, not a skipped one.
//
// Gates (see scout/wrangler.toml): staging and production both run nightly
// (staging authorized 2026-09-20, production 2026-09-21 after a clean
// unattended staging tick). scheduled() still refuses unless
// env.SCOUT_ENABLED is exactly "true". Nothing this Worker writes can reach a
// member: every row lands needs_review, and only a human reviewer approves.

import { runRobotsRecheck } from './robotscheck.js';
import { runDiscovery } from './discover.js';
import { writeListingDrafts } from './listingdrafts.js';
import * as smoothcompParser from './parsers/smoothcomp.js';
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
  d1MarkPageExcluded,
  d1RequeueStalePages,
  d1NearbyPlaces,
  d1DeactivateSource,
  d1MarkAliasRobotsFresh,
  d1PauseAliasForRobotsDrift,
  d1StaleApprovedLinksLoader,
  d1MarkLinkLive,
  d1DemoteDeadLink,
} from './d1adapters.js';
import { d1RunOpener, d1RunCloser, truncate } from './run.js';

// Every crawl_runs row's `component` MUST be one of the six values the
// table's own CHECK constraint permits (core_schema.sql); the phases this
// crawl actually runs (robots re-check, discovery, ingest, link-check)
// are not among them. Opus review, 2026-09-19, B4: the original code used
// its own invented values ('scout_discovery' etc.), which the schema
// rejected on the Worker's very first write -- runCrawlCycle had never
// once been executed against the real schema. `region` carries the
// specific phase name instead; it has no CHECK, and crawl_runs' own
// purpose ("cost and error reporting") is served just as well by it.
// What a thrown thing was, in words a person reading crawl_runs can act on.
export function describeError(err) {
  if (!err) return 'unknown failure (nothing was thrown)';
  const name = err.name && err.name !== 'Error' ? `${err.name}: ` : '';
  return truncate(`${name}${err.message ?? String(err)}`);
}

// Why a SUCCEEDED phase still reported errors: the distinct reasons, so a
// recurring count explains itself instead of being a number nobody can
// account for later.
export function summariseSkips(entries) {
  const reasons = [...new Set((entries ?? []).map((e) => e?.reason).filter(Boolean))];
  if (reasons.length === 0) return null;
  return truncate(`${entries.length} skipped: ${reasons.join(' | ')}`);
}

const TIER1_COMPONENT = 'tier1_scout';
const LINKCHECK_COMPONENT = 'link_checker';

export async function runCrawlCycle(env) {
  const now = Date.now();
  const claimSlot = d1ClaimSlot(env.DB);
  const deactivateSource = (sourceId) => d1DeactivateSource(env.DB)(sourceId);
  const openRun = d1RunOpener(env.DB);
  const closeRun = d1RunCloser(env.DB);
  const loadActiveAliasesWithSource = d1ActiveAliasesWithSourceLoader(env.DB);

  // A cycle killed mid-flight (runtime cancellation, deploy) leaves its
  // crawl_runs row 'running' forever; nothing else ever closes it. Any row
  // still running past the platform's own wall-time limit is dead.
  await env.DB
    .prepare(`UPDATE crawl_runs SET status = 'failed', finished_at = ?1, errors = errors + 1, error_text = coalesce(error_text, 'abandoned: still running when a later cycle started, so the invocation was killed mid-flight (deploy, interrupt, or platform eviction)') WHERE status = 'running' AND started_at < ?2`)
    .bind(new Date(now).toISOString(), new Date(now - 20 * 60 * 1000).toISOString())
    .run();

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
    await closeRun({ runId: robotsRunId, status: 'succeeded', finishedAt: Date.now(), pagesFetched: robotsResult.checked, errors: robotsResult.paused.length, hostsSkipped: robotsResult.skipped.length, errorText: summariseSkips([...robotsResult.paused, ...robotsResult.skipped]) });
  } catch (err) {
    await closeRun({ runId: robotsRunId, status: 'failed', finishedAt: Date.now(), pagesFetched: 0, errors: 1, hostsSkipped: 0, errorText: describeError(err) });
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
      upsertListingDrafts: ({ source, events }) => writeListingDrafts({
        source,
        events,
        now: Date.now(),
        nearbyPlaces: d1NearbyPlaces(env.DB),
        loadExistingEvent: d1ExistingEventLoader(env.DB),
        applyUpsert: d1ApplyUpsert(env.DB),
        toDraftRow: smoothcompParser.toListingDraftRow,
      }),
      deactivateSource,
    });
    await closeRun({ runId: discoveryRunId, status: 'succeeded', finishedAt: Date.now(), pagesFetched: discoveryResult.attempted, errors: discoveryResult.skipped.length, hostsSkipped: discoveryResult.skipped.length, draftsCreated: discoveryResult.drafted, errorText: summariseSkips([...discoveryResult.skipped, ...(discoveryResult.unresolved ?? [])]) });
  } catch (err) {
    await closeRun({ runId: discoveryRunId, status: 'failed', finishedAt: Date.now(), pagesFetched: 0, errors: 1, hostsSkipped: 0, errorText: describeError(err) });
    throw err;
  }

  // Read AFTER the robots phase, which may have just paused an alias for
  // drift: every later phase's fetch gate must see only what is active now.
  const aliasesBySource = {};
  for (const a of await loadActiveAliasesWithSource()) (aliasesBySource[a.source.id] ??= []).push({ host: a.host, listingPath: a.listingPath });

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
      markPageExcluded: d1MarkPageExcluded(env.DB),
      requeueStalePages: d1RequeueStalePages(env.DB),
      deactivateSource,
      aliasesBySource,
    });
    await closeRun({ runId: ingestRunId, status: 'succeeded', finishedAt: Date.now(), pagesFetched: ingestResult.fetched, errors: ingestResult.failed.length, hostsSkipped: 0, errorText: summariseSkips(ingestResult.failed) });
  } catch (err) {
    await closeRun({ runId: ingestRunId, status: 'failed', finishedAt: Date.now(), pagesFetched: 0, errors: 1, hostsSkipped: 0, errorText: describeError(err) });
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
      aliasesBySource,
    });
    // pages_fetched counts real requests only. A structural check makes no
    // request, so counting it here would report a fetch that never happened
    // (found in production 2026-09-21: "pages_fetched: 1" for a cycle that
    // touched no event page at all).
    await closeRun({ runId: linkCheckRunId, status: 'succeeded', finishedAt: Date.now(), pagesFetched: linkCheckResult.checked - (linkCheckResult.structural ?? 0), errors: linkCheckResult.demoted, hostsSkipped: 0, errorText: summariseSkips(linkCheckResult.skipped) });
  } catch (err) {
    await closeRun({ runId: linkCheckRunId, status: 'failed', finishedAt: Date.now(), pagesFetched: 0, errors: 1, hostsSkipped: 0, errorText: describeError(err) });
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
    // Awaited, never ctx.waitUntil (found by the first LIVE run,
    // 2026-09-20; Opus N9/N10): waitUntil work is cancelled ~30s after the
    // handler returns, and one cycle spends real wall time honoring the
    // 10s-per-company clock. Awaiting keeps the invocation alive for the
    // whole cycle and lets a rejection surface as a failed cron run.
    await runCrawlCycle(env);
  },
};
