// Building the signed batch the publisher sends to the app. Pure functions,
// no D1 and no network here... `index.js` is the only place that touches
// either, so this file can be tested without a database or a socket.
//
// The app's tournaments table gained country/lat/lon/event_type/
// entry_restriction 2026-09-23 (excelsior-master migrations
// 20260918120000-20260918150000, applied to staging then production as
// part of the GUARDIAN release). This mapping now ships them. Found the
// same day: this function HAD been emitting gi/nogi/kids all along, but
// almanac-ingest's own upsert never wrote them -- a two-repo gap neither
// side's own tests could see alone, since each tested its half in
// isolation. There is still no 'stale' equivalent on the app side beyond
// mapStatus()'s existing stale->expired translation below.

// The fields the app's `tournaments` table accepts today, in the shape its
// migration defines them (`supabase/migrations/20260706000001_tournaments.sql`
// in the app repo, `jiujitsuoutlet/excelsior-master`).
export function toTournamentRow(event) {
  if (!event || typeof event !== 'object') {
    throw new TypeError('toTournamentRow requires an event object');
  }
  for (const field of ['id', 'name', 'start_date', 'city', 'state', 'registration_url', 'status']) {
    if (event[field] === undefined || event[field] === null || event[field] === '') {
      throw new Error(`event missing required field for publish: ${field}`);
    }
  }
  return {
    almanac_id: event.id,
    name: event.name,
    org: event.organizer_name ?? null,
    start_date: event.start_date,
    city: event.city,
    state: event.state,
    venue: event.venue_name ?? null,
    registration_url: event.registration_url,
    registration_deadline: event.registration_deadline ?? null,
    gi: Boolean(event.gi),
    nogi: Boolean(event.nogi),
    kids: Boolean(event.kids),
    source_url: event.source_url,
    country: event.country ?? null,
    event_type: event.event_type ?? null,
    entry_restriction: event.entry_restriction ?? null,
    lat: Number.isFinite(event.lat) ? event.lat : null,
    lon: Number.isFinite(event.lon) ? event.lon : null,
    status: mapStatus(event.status),
  };
}

// The app's tournament_status enum is draft/needs_review/approved/rejected/
// expired... it has no 'stale' value (that is an ALMANAC-only, D1-only
// status; see the schema comment on `events.status`). A stale ALMANAC row
// still needs to stop showing to a member, and the correct app-side state
// for "was approved, no longer confirmed" is 'expired': the existing
// `tournaments_visible_idx` and the member RLS policy already exclude
// anything that isn't 'approved', so 'expired' disappears from the member
// read the same way 'rejected' does. A rejected ALMANAC row publishes
// nothing... it never crossed to 'approved' in the first place, and this
// function is never called for it (see `rowsToPublish` in index.js).
function mapStatus(almanacStatus) {
  if (almanacStatus === 'approved') return 'approved';
  if (almanacStatus === 'stale') return 'expired';
  throw new Error(`event status '${almanacStatus}' is not publishable; only approved and stale rows reach this function`);
}

// Deterministic JSON: keys sorted at every level, so the same batch always
// serializes to the same bytes and the signature is reproducible on both
// ends. JSON.stringify's key order follows insertion order, which is NOT
// guaranteed to match between two independent builds of "the same" object,
// so this cannot be skipped.
export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

// The batch cap (ARCHITECTURE.md Section 11: "Batches carry a row cap and a
// volume alert"). A single publish cycle that suddenly wants to send more
// than this is far more likely to be a bug (a bad query, a status-migration
// gone wrong) than a real editorial surge, so it is refused rather than sent.
export const MAX_BATCH_ROWS = 200;

export function buildBatch(events, { batchId, timestamp }) {
  if (!batchId) throw new Error('buildBatch requires a batchId');
  if (!timestamp) throw new Error('buildBatch requires a timestamp');
  if (events.length > MAX_BATCH_ROWS) {
    throw new Error(`batch of ${events.length} rows exceeds the cap of ${MAX_BATCH_ROWS}; refusing to send (volume alert)`);
  }
  return {
    batch_id: batchId,
    timestamp,
    rows: events.map(toTournamentRow),
  };
}
