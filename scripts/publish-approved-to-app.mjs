// One-off bridge: send a D1 environment's due rows into a NAMED app target,
// via the real publisher payload code, without touching D1's published_at.
//
// Why this exists (2026-09-24): the staging publisher Worker's D1 binding is
// `almanac-staging`, its own separate crawl target -- it does NOT hold the
// founder's real Scout-approved rows, which live only in PRODUCTION's
// `almanac` D1. Cross-wiring the staging publisher's D1 binding to
// production would work for one cycle, but `runPublishCycle` always marks
// every sent row's `published_at` in the D1 it read from -- so a staging
// rehearsal would poison production's own real publish-to-production run
// later (SELECT_DUE_SQL requires published_at IS NULL OR updated_at >
// published_at; a row marked published now would be silently skipped when
// the real production cron is finally turned on for real). This script is
// the safe alternative: it reads the source D1 read-only (a separate
// `wrangler d1 execute` call, never a binding this script writes through),
// and calls the real buildBatch/canonicalize/sign code to send a REAL batch
// to whatever app ingest URL you name. There is no MARK_PUBLISHED_SQL call
// anywhere in this file -- that omission is the whole point, not an
// oversight.
//
// This is for refreshing a STAGING PREVIEW with real approved data before a
// founder walkthrough. It is never how rows reach PRODUCTION members --
// that stays the real publisher Worker's cron, reading and marking
// production's own D1, once PUBLISHER_ENABLED is flipped on for real at the
// gate.
//
// Usage:
//   ALMANAC_PUBLISH_SECRET=<staging or prod secret> \
//   node scripts/publish-approved-to-app.mjs <source-d1-name> <app-project-ref>
//
// Example (refresh staging preview from production's real approvals):
//   ALMANAC_PUBLISH_SECRET=<staging secret> \
//   node scripts/publish-approved-to-app.mjs almanac ecronfxsaoilagcwvfyw

import { execFileSync } from 'node:child_process';
import { buildBatch, canonicalize, MAX_BATCH_ROWS } from '../publisher/src/payload.js';
import { sign } from '../publisher/src/sign.js';
import { SELECT_DUE_SQL } from '../publisher/src/selection.js';

const [sourceD1, appProjectRef] = process.argv.slice(2);
const secret = process.env.ALMANAC_PUBLISH_SECRET;

if (!sourceD1 || !appProjectRef) {
  console.error('usage: node scripts/publish-approved-to-app.mjs <source-d1-name> <app-project-ref>');
  process.exit(1);
}
if (!secret) {
  console.error('ALMANAC_PUBLISH_SECRET env var required (the target app project\'s own secret, never guessed or reused across projects)');
  process.exit(1);
}

const limitedSql = SELECT_DUE_SQL.replace('LIMIT ?', `LIMIT ${MAX_BATCH_ROWS + 1}`);
const raw = execFileSync(
  'npx',
  ['wrangler', 'd1', 'execute', sourceD1, '--remote', '--json', '--command', limitedSql],
  { cwd: new URL('../publisher', import.meta.url).pathname, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
const rows = JSON.parse(raw)[0].results;
console.log(`read ${rows.length} due row(s) from ${sourceD1} (read-only; published_at not touched)`);

if (rows.length === 0) {
  console.log('nothing due, nothing sent');
  process.exit(0);
}
if (rows.length > MAX_BATCH_ROWS) {
  console.error(`over the cap of ${MAX_BATCH_ROWS}; refusing to send (volume alert)`);
  process.exit(1);
}

const batchId = crypto.randomUUID();
const timestamp = new Date().toISOString();
const batch = buildBatch(rows, { batchId, timestamp });
const canonicalBody = canonicalize(batch);
const signature = await sign(canonicalBody, secret);

const ingestUrl = `https://${appProjectRef}.supabase.co/functions/v1/almanac-ingest`;
const response = await fetch(ingestUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-almanac-signature': signature },
  body: canonicalBody,
});
const body = await response.text();
console.log('status:', response.status);
console.log('body:', body);
console.log(response.ok ? `PASS  ${rows.length} row(s) sent to ${appProjectRef}` : 'FAIL  app rejected the batch');
process.exit(response.ok ? 0 : 1);
