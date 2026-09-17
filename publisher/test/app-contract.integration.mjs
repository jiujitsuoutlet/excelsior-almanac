// Integration test: does the real almanac-ingest function accept the real
// batch shape payload.js actually builds? Every other publisher test checks
// buildBatch/canonicalize/sign in isolation, against fakes... none of them
// ever sent a real payload.js batch to the real app function. That gap is
// exactly how row.id vs row.almanac_id shipped and sat broken through a
// full night of cron cycles before anyone caught it (excelsior-master,
// almanac-ingest/index.ts, found 2026-09-17).
//
// This is deliberately NOT part of `npm run test:unit`: it needs a live
// network call, the real ALMANAC_PUBLISH_SECRET, and it writes one real
// (and immediately cleaned up) row to the live app's tournaments table.
// Same split as scout/console's local-vs-remote verification scripts.
//
// Run: node publisher/test/app-contract.integration.mjs <ALMANAC_PUBLISH_SECRET>
//
// The hand-copy law (docs/VERIFICATION.md) says: wherever two components
// must agree on a name or shape, one must read from the other, or a test
// must compare them directly. Across two repos that deliberately don't
// import each other's code, the only thing that CAN read both sides is a
// live call over the real wire contract. This test is that read.

import { buildBatch, canonicalize } from '../src/payload.js';
import { sign } from '../src/sign.js';

const INGEST_URL = 'https://pvqdyqquugxkypvrbwhs.supabase.co/functions/v1/almanac-ingest';
const MGMT_API = 'https://api.supabase.com/v1/projects/pvqdyqquugxkypvrbwhs/database/query';

const secret = process.argv[2];
if (!secret) {
  console.error('usage: node app-contract.integration.mjs <ALMANAC_PUBLISH_SECRET> [SUPABASE_ACCESS_TOKEN for cleanup]');
  process.exit(1);
}
const managementToken = process.argv[3]; // only needed to clean up the proof row after a pass

// A full SELECT * shape, the same fields selection.js's SELECT_DUE_SQL
// actually returns... not a hand-typed subset. That subset-vs-full gap is
// what produced a misleading `undefined` on the first diagnostic attempt at
// this exact bug, 2026-09-17, before the row shape was corrected to match.
const PROOF_EVENT = {
  id: 'integration-test-proof-app-contract',
  event_type: 'tournament',
  name: 'INTEGRATION TEST -- DO NOT APPROVE',
  organizer_name: 'test-harness',
  start_date: '2027-01-01',
  end_date: null,
  timezone: null,
  venue_name: null,
  address: null,
  city: 'Test City',
  state: 'MO',
  country: 'US',
  lat: null,
  lon: null,
  geocode_confidence: null,
  registration_url: 'https://example.com/integration-test',
  registration_deadline: null,
  gi: 1,
  nogi: 1,
  kids: 0,
  source_url: 'https://example.com/integration-test',
  source_host: 'example.com',
  source_event_ref: null,
  source_tier: 3,
  confidence: null,
  scoring_version: null,
  status: 'approved',
  approved_by: null,
  approved_at: null,
  approval_rule: null,
  dedupe_key: 'integration-test-proof-app-contract',
  first_seen_at: '2027-01-01T00:00:00.000Z',
  last_seen_at: '2027-01-01T00:00:00.000Z',
  link_checked_at: null,
  published_at: null,
  created_at: '2027-01-01T00:00:00.000Z',
  updated_at: '2027-01-01T00:00:00.000Z',
};

async function cleanup() {
  if (!managementToken) return;
  await fetch(MGMT_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${managementToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `delete from public.tournaments where almanac_id = 'integration-test-proof-app-contract';`,
    }),
  });
}

const batchId = crypto.randomUUID();
const timestamp = new Date().toISOString();
const batch = buildBatch([PROOF_EVENT], { batchId, timestamp });
const canonical = canonicalize(batch);
const signature = await sign(canonical, secret);

const response = await fetch(INGEST_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-almanac-signature': signature },
  body: canonical,
});
const body = await response.text();

console.log('status:', response.status);
console.log('body:', body);

if (response.ok) {
  console.log('PASS  a real payload.js batch is accepted by the real ingest function');
  await cleanup();
  process.exit(0);
} else {
  console.log('FAIL  a real payload.js batch was rejected by the real ingest function');
  process.exit(1);
}
