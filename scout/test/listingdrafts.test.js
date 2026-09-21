import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeListingDrafts } from '../src/listingdrafts.js';
import { toListingDraftRow } from '../src/parsers/smoothcomp.js';
import { structuralLinkVerdict } from '../src/structural.js';

const SOURCE = { id: 'src-smoothcomp', host: 'smoothcomp.com' };

const EVENT = {
  name: 'Submission Challenge Kansas City, MO October 3rd 2026',
  startDate: '2026-10-03',
  endDate: '2026-10-03',
  city: 'Independence',
  country: 'US',
  lat: 39.0278297,
  lon: -94.357637,
  sourceUrl: 'https://submissionchallenge.smoothcomp.com/en/event/28290',
  sourceEventRef: '28290',
};

const NEARBY_MO = [{ city: 'Lake Tapawingo', state: 'MO', lat: 39.0214, lon: -94.31162 }];

function deps(overrides = {}) {
  return {
    source: SOURCE,
    events: [EVENT],
    now: 1_700_000_000_000,
    nearbyPlaces: async () => NEARBY_MO,
    loadExistingEvent: async () => null,
    applyUpsert: async () => {},
    toDraftRow: toListingDraftRow,
    ...overrides,
  };
}

test('a listing event with a confident state becomes a real draft, marked derived and structural', async () => {
  const applied = [];
  const r = await writeListingDrafts(deps({ applyUpsert: async (s) => applied.push(s) }));
  assert.equal(r.written, 1);
  assert.equal(r.inserted, 1);
  assert.deepEqual(r.unresolved, []);

  const insert = applied[0].find((s) => s.kind === 'insert_event');
  assert.equal(insert.row.state, 'MO');
  assert.equal(insert.row.state_source, 'derived');
  assert.equal(insert.row.link_check_method, 'structural');
  assert.equal(insert.row.source_host, 'submissionchallenge.smoothcomp.com');
  assert.equal(insert.row.source_tier, 1);
  assert.ok(!('status' in insert.row), 'the insert never sets a status; the trigger owns it');
  // The registration link is the event page URL, and nothing pretends it
  // was fetched.
  assert.equal(insert.row.registration_url, EVENT.sourceUrl);
});

test('divisions are left unknown, never invented -- gi/nogi/kids all 0, no venue or organizer guessed', async () => {
  const applied = [];
  await writeListingDrafts(deps({ applyUpsert: async (s) => applied.push(s) }));
  const row = applied[0].find((s) => s.kind === 'insert_event').row;
  assert.deepEqual([row.gi, row.nogi, row.kids], [0, 0, 0]);
  assert.equal(row.venue_name, null);
  assert.equal(row.organizer_name, null);
  assert.equal(row.registration_deadline, null);
  assert.equal(row.address, null);
});

test('AN UNRESOLVABLE STATE WRITES NO ROW AT ALL -- it is reported, not guessed', async () => {
  const applied = [];
  const r = await writeListingDrafts(deps({
    nearbyPlaces: async () => [],
    applyUpsert: async (s) => applied.push(s),
  }));
  assert.equal(r.written, 0);
  assert.equal(applied.length, 0, 'nothing may be written when the state is unknown');
  assert.equal(r.unresolved.length, 1);
  assert.equal(r.unresolved[0].url, EVENT.sourceUrl);
  assert.match(r.unresolved[0].reason, /no gazetteer place/);
});

test('a state-line ambiguity also writes nothing, and says which two states', async () => {
  const r = await writeListingDrafts(deps({
    events: [{ ...EVENT, lat: 39.106, lon: -94.603 }],
    nearbyPlaces: async () => [
      { city: 'Kansas City', state: 'MO', lat: 39.0997, lon: -94.5786 },
      { city: 'Kansas City', state: 'KS', lat: 39.1141, lon: -94.6275 },
    ],
    applyUpsert: async () => { throw new Error('must never be called'); },
  }));
  assert.equal(r.written, 0);
  assert.match(r.unresolved[0].reason, /ambiguous near a state line/);
});

test('an unresolvable event does not stop the resolvable ones beside it', async () => {
  const r = await writeListingDrafts(deps({
    events: [{ ...EVENT, lat: 80, lon: -30, sourceUrl: 'https://submissionchallenge.smoothcomp.com/en/event/1' }, EVENT],
    nearbyPlaces: async (lat) => (lat === 80 ? [] : NEARBY_MO),
  }));
  assert.equal(r.written, 1);
  assert.equal(r.unresolved.length, 1);
});

test('re-running over an unchanged event touches last_seen_at instead of churning the review log', async () => {
  const applied = [];
  const existing = { ...toListingDraftRow(EVENT, { state: 'MO' }), id: 'evt-existing', status: 'needs_review' };
  const r = await writeListingDrafts(deps({
    loadExistingEvent: async () => existing,
    applyUpsert: async (s) => applied.push(s),
  }));
  assert.equal(r.unchanged, 1);
  assert.deepEqual(applied[0].map((s) => s.kind), ['touch_last_seen']);
});

test('the actor is a real system identity, which can never approve anything', async () => {
  const applied = [];
  await writeListingDrafts(deps({ applyUpsert: async (s) => applied.push(s) }));
  for (const s of applied[0]) if (s.actor) assert.match(s.actor, /^system:scout-/);
});

// ---- the structural check itself ----

const APPROVED = new Set(['submissionchallenge.smoothcomp.com', 'fujibjj.smoothcomp.com']);

test('structural check passes only a well-formed https URL on an approved alias', () => {
  assert.equal(structuralLinkVerdict('https://submissionchallenge.smoothcomp.com/en/event/28290', APPROVED).ok, true);
});

test('structural check refuses http, an unapproved host, and a non-URL -- it never just says yes', () => {
  assert.match(structuralLinkVerdict('http://submissionchallenge.smoothcomp.com/en/event/1', APPROVED).reason, /not https/);
  assert.match(structuralLinkVerdict('https://evil.example.com/en/event/1', APPROVED).reason, /not an approved alias/);
  assert.match(structuralLinkVerdict('not a url', APPROVED).reason, /not a URL/);
  assert.match(structuralLinkVerdict('https://smoothcomp.com.evil.com/x', APPROVED).reason, /not an approved alias/);
});

test('a non-US listing event writes no row at all, whatever the gazetteer says is nearby', async () => {
  const r = await writeListingDrafts(deps({
    events: [{ ...EVENT, name: 'Grappling Industries VANCOUVER', city: 'Burnaby, BC', country: 'CA', lat: 49.2487384, lon: -123.0009073 }],
    nearbyPlaces: async () => [{ city: 'Blaine', state: 'WA', lat: 48.9937, lon: -122.7471 }],
    applyUpsert: async () => { throw new Error('must never be called for a non-US event'); },
  }));
  assert.equal(r.written, 0);
  assert.match(r.unresolved[0].reason, /US places only/);
});
