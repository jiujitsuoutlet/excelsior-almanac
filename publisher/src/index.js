// ALMANAC publisher Worker. `almanac-ingest` (jiujitsuoutlet/excelsior-master
// PR #103) is deployed and its shared secret is set on both sides
// (2026-09-16). `PUBLISHER_ENABLED` is the kill switch, checked first in
// `scheduled` below, same pattern as `scout/src/index.js`'s `SCOUT_ENABLED`
// check: flipping it back to "false" and redeploying stops the pipe without
// touching any other code, faster than rotating the secret.

import { buildBatch, canonicalize, MAX_BATCH_ROWS } from './payload.js';
import { sign } from './sign.js';
import { SELECT_DUE_SQL, MARK_PUBLISHED_SQL } from './selection.js';

// One publish cycle: read what's due, sign it, send it, mark what the app
// confirmed. `deps` is injected (db, fetch, secret, appIngestUrl, now) so
// this runs in a test with no D1 binding and no socket, the same seam every
// other Worker in this repository uses.
export async function runPublishCycle(deps) {
  const { db, fetchFn, secret, appIngestUrl, now } = deps;
  const timestamp = new Date(now()).toISOString();

  const due = await db.prepare(SELECT_DUE_SQL).bind(MAX_BATCH_ROWS + 1).all();
  const rows = due.results ?? due;

  if (rows.length === 0) {
    return { sent: 0, outcome: 'nothing_due' };
  }
  if (rows.length > MAX_BATCH_ROWS) {
    // Over the cap: send nothing this cycle rather than silently truncate,
    // which would drop rows a human approved without telling anyone.
    // ARCHITECTURE.md Section 11's "volume alert" is this branch: it is
    // logged, not auto-resolved, and the next cycle sees the same backlog.
    return { sent: 0, outcome: 'over_cap', pending: rows.length, cap: MAX_BATCH_ROWS };
  }

  const batchId = crypto.randomUUID();
  const batch = buildBatch(rows, { batchId, timestamp });
  const canonical = canonicalize(batch);
  const signature = await sign(canonical, secret);

  const response = await fetchFn(appIngestUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-almanac-signature': signature,
    },
    body: canonical,
  });

  if (!response.ok) {
    return { sent: 0, outcome: 'app_rejected', status: response.status, batchId };
  }

  const ids = rows.map((r) => r.id);
  await db.prepare(MARK_PUBLISHED_SQL).bind(timestamp, JSON.stringify(ids)).run();

  return { sent: ids.length, outcome: 'published', batchId };
}

export default {
  async scheduled(_event, env, ctx) {
    if (env.PUBLISHER_ENABLED !== 'true') {
      console.log('publisher: PUBLISHER_ENABLED is not "true"; refusing to run.');
      return;
    }
    const run = runPublishCycle({
      db: env.DB,
      fetchFn: fetch,
      secret: env.ALMANAC_PUBLISH_SECRET,
      appIngestUrl: env.APP_INGEST_URL,
      now: () => Date.now(),
    }).then((result) => {
      console.log(JSON.stringify({ event: 'publish_cycle', ...result }));
      return result;
    });
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(run);
    else await run;
  },
};
