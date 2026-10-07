// ALMANAC publisher Worker. `almanac-ingest` (jiujitsuoutlet/excelsior-master
// PR #103) is deployed and its shared secret is set on both sides
// (2026-09-16). `PUBLISHER_ENABLED` is the kill switch, checked first in
// `scheduled` below, same pattern as `scout/src/index.js`'s `SCOUT_ENABLED`
// check: flipping it back to "false" and redeploying stops the pipe without
// touching any other code, faster than rotating the secret.

import { buildBatch, canonicalize, MAX_BATCH_ROWS } from './payload.js';
import { sign } from './sign.js';
import { SELECT_DUE_SQL, MARK_PUBLISHED_SQL } from './selection.js';

// The volume alert (ARCHITECTURE.md Section 9: "Batches carry a row cap and
// a volume alert"). Two numbers, two jobs:
//   - MAX_BATCH_ROWS (payload.js, 200) is the per-batch row cap, the same
//     cap almanac-ingest enforces on its side.
//   - ANOMALY_CEILING is the volume alert. More rows due than this in one
//     cycle means something upstream ran away (a rule approving in bulk, a
//     re-crawl rewriting every row), and the cycle sends NOTHING until a
//     person looks.
// Between the two, the backlog drains a batch per cycle, oldest first:
// rows past the first MAX_BATCH_ROWS stay due (published_at only moves for
// rows the app confirmed) and go out on the next cycle, ten minutes later.
// Nothing is dropped and nothing is silent: every such cycle reports how
// many are still pending. Before 2026-10-05 any backlog over the batch cap
// refused outright, which also refused the first legitimate backlog (275
// founder-approved rows waiting at the release gate) forever: the next
// cycle always saw the same 275.
export const ANOMALY_CEILING = 1000;

// One publish cycle: read what's due, sign it, send it, mark what the app
// confirmed. `deps` is injected (db, fetch, secret, appIngestUrl, now) so
// this runs in a test with no D1 binding and no socket, the same seam every
// other Worker in this repository uses.
export async function runPublishCycle(deps) {
  const { db, fetchFn, secret, appIngestUrl, now } = deps;
  const timestamp = new Date(now()).toISOString();

  const due = await db.prepare(SELECT_DUE_SQL).bind(ANOMALY_CEILING + 1).all();
  const dueRows = due.results ?? due;

  if (dueRows.length === 0) {
    return { sent: 0, outcome: 'nothing_due' };
  }
  if (dueRows.length > ANOMALY_CEILING) {
    // The volume alert: logged, never auto-resolved. Every later cycle sees
    // the same backlog and refuses again until a person has looked.
    return { sent: 0, outcome: 'volume_alert', pending: dueRows.length, ceiling: ANOMALY_CEILING };
  }
  // SELECT_DUE_SQL orders by updated_at, so this is the oldest batch.
  const rows = dueRows.slice(0, MAX_BATCH_ROWS);
  const remaining = dueRows.length - rows.length;

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
    return { sent: 0, outcome: 'app_rejected', status: response.status, batchId, pending: dueRows.length };
  }

  const ids = rows.map((r) => r.id);
  await db.prepare(MARK_PUBLISHED_SQL).bind(timestamp, JSON.stringify(ids)).run();

  return { sent: ids.length, outcome: 'published', batchId, pending: remaining };
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
