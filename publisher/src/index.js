// ALMANAC publisher Worker (skeleton). Deliberately unwired: no Cron Trigger
// in `wrangler.toml`, and `runPublishCycle` is never called from a live
// handler in this file. Wiring it is a separate, founder-gated step, decided
// after this skeleton, its tests, and its own verification script are
// reviewed on their own pull request... same discipline the scout skeleton
// shipped under (see scout/src/index.js).
//
// The app-side receiving function (`almanac-ingest`, in
// `jiujitsuoutlet/excelsior-master`) does not exist yet. This Worker cannot
// be turned on until it does; see ARCHITECTURE.md Section 11 for the
// app-side prerequisite and its exact spec.

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
  async scheduled(_event, _env, _ctx) {
    // Nothing calls runPublishCycle here yet. The app-side function this
    // Worker depends on does not exist; turning this on would sign and send
    // batches to a URL with nothing listening. See the file header.
  },
};
