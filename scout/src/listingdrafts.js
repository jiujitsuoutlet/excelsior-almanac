// Turning listing-page facts into real draft rows (founder ruling,
// 2026-09-20). This is the writer discover.js hands a 'listing_only'
// source's parsed events to.
//
// The whole point of this module is what it REFUSES to write. A listing
// entry carries no state, so the state is derived from the event's own
// coordinates against the places gazetteer; when that derivation is not
// confident -- too far from any known place, or ambiguous across a state
// line -- the row is NOT written, and the reason is reported. `events.state`
// is NOT NULL, and the honest answer to "which state is this in?" is
// sometimes "I do not know", which is not a value that column can hold.
// Writing the nearest guess anyway would put an unmarked wrong answer in
// front of a reviewer, which is exactly what the founder ruled against.
//
// Everything this module DOES write is marked for what it is:
// state_source='derived', link_check_method='structural'.

import { deriveState, MAX_MATCH_KM } from './geo.js';
import { planEventUpsert } from './ingest.js';

/**
 * @param {object} deps
 * @param {object} deps.source - the full `sources` row
 * @param {Array} deps.events - parser.parseListingEvents()'s `events`
 * @param {Function} deps.nearbyPlaces - async (lat, lon, km) => gazetteer rows
 * @param {Function} deps.loadExistingEvent - async ({sourceHost, sourceEventRef, dedupeKey}) => row|null
 * @param {Function} deps.applyUpsert - async (statements) => void
 * @param {Function} deps.toDraftRow - parser.toListingDraftRow
 * @param {number} deps.now
 * @returns {Promise<{written:number, inserted:number, updated:number, unchanged:number, unresolved:Array}>}
 */
export async function writeListingDrafts({
  source,
  events,
  nearbyPlaces,
  loadExistingEvent,
  applyUpsert,
  toDraftRow,
  now,
  maxMatchKm = MAX_MATCH_KM,
}) {
  for (const fn of [nearbyPlaces, loadExistingEvent, applyUpsert, toDraftRow]) {
    if (typeof fn !== 'function') throw new Error('writeListingDrafts requires every dependency as an injected function');
  }

  const nowIso = new Date(now).toISOString();
  const actor = `system:scout-${source.id}`;
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const unresolved = [];

  for (const candidate of events) {
    // eslint-disable-next-line no-await-in-loop -- one gazetteer read per event, against a small bounding box
    const places = await nearbyPlaces(candidate.lat, candidate.lon, maxMatchKm);
    const derived = deriveState(candidate.lat, candidate.lon, places, { maxKm: maxMatchKm, country: candidate.country });
    if (!derived.state) {
      unresolved.push({ url: candidate.sourceUrl, name: candidate.name, city: candidate.city, reason: derived.reason });
      continue;
    }

    const draft = toDraftRow(candidate, { state: derived.state });
    // eslint-disable-next-line no-await-in-loop
    const existing = await loadExistingEvent({ sourceHost: draft.source_host, sourceEventRef: draft.source_event_ref, dedupeKey: draft.dedupe_key });
    const { outcome, statements } = planEventUpsert({ existing, draft, actor, nowIso });
    // eslint-disable-next-line no-await-in-loop
    await applyUpsert(statements);
    if (outcome === 'inserted') inserted += 1;
    else if (outcome === 'unchanged') unchanged += 1;
    else updated += 1;
  }

  return { written: inserted + updated, inserted, updated, unchanged, unresolved };
}
