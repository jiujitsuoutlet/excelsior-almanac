// ALMANAC scout Worker entry point (skeleton).
//
// This module exports a `scheduled()` handler, because Cron Triggers are the
// only way this Worker is ever meant to run (ARCHITECTURE.md section 4 /
// section 9). Two separate gates keep it inert in this pull request:
//
//   1. No Cron Trigger calls it. scout/wrangler.toml has no [triggers]
//      section, and this branch does not touch console/wrangler.toml or the
//      root wrangler.toml. Wiring a schedule is a separate, founder-gated
//      step, tracked outside this repository's automated tooling on
//      purpose, so a merge of this skeleton cannot start a schedule by
//      accident.
//   2. Even if something did call scheduled() (a manual dashboard trigger, a
//      future misconfiguration), the handler itself refuses to do anything
//      unless env.SCOUT_ENABLED is exactly the string "true". No checked-in
//      configuration sets that variable anywhere.
//
// And underneath both gates, the fetch function this Worker wires up
// (`disabledFetch`, from run.js) always throws. So even a caller that
// defeats both gates above still cannot reach a real network fetch, because
// the fetcher plugged into the runner is not a real fetcher in this PR.

import { runScoutRun, disabledFetch, d1SourceLoader, d1RunOpener, d1RunCloser } from './run.js';

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
    const run = runScoutRun({
      fetchImpl: disabledFetch,
      now: () => Date.now(),
      loadSources: d1SourceLoader(env.DB),
      openRun: d1RunOpener(env.DB),
      closeRun: d1RunCloser(env.DB),
    });
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(run);
    else await run;
  },
};
