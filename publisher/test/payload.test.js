import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTournamentRow, canonicalize, buildBatch, MAX_BATCH_ROWS } from '../src/payload.js';

function fixtureEvent(overrides = {}) {
  return {
    id: 'evt_abc123',
    event_type: 'tournament',
    name: 'Test Open',
    organizer_name: 'Test Federation',
    start_date: '2026-10-01',
    city: 'Springfield',
    state: 'MO',
    country: 'US',
    venue_name: 'Test Arena',
    registration_url: 'https://example.com/register',
    registration_deadline: '2026-09-28',
    gi: 1,
    nogi: 0,
    kids: 1,
    source_url: 'https://example.com/events/test-open',
    status: 'approved',
    ...overrides,
  };
}

test('toTournamentRow maps every field the app tournaments table accepts today', () => {
  const row = toTournamentRow(fixtureEvent({ lat: 37.2, lon: -93.3 }));
  assert.deepEqual(row, {
    almanac_id: 'evt_abc123',
    name: 'Test Open',
    org: 'Test Federation',
    start_date: '2026-10-01',
    city: 'Springfield',
    state: 'MO',
    venue: 'Test Arena',
    registration_url: 'https://example.com/register',
    registration_deadline: '2026-09-28',
    gi: true,
    nogi: false,
    kids: true,
    source_url: 'https://example.com/events/test-open',
    country: 'US',
    event_type: 'tournament',
    entry_restriction: null,
    lat: 37.2,
    lon: -93.3,
    status: 'approved',
  });
});

// Found 2026-09-24: this function HAD been sending gi/nogi/kids on every
// batch since the pipe existed; almanac-ingest's own upsert whitelist was
// the half that silently dropped them (fixed the same day). Neither side's
// own isolated tests could see the gap -- this asserts THIS side's half of
// the contract explicitly, so a future refactor here cannot reintroduce it
// unnoticed. The live wire contract itself is proven end to end by
// app-contract.integration.mjs.
test('toTournamentRow carries gi/nogi/kids, lat/lon, country and event_type on the wire -- the exact fields a real ingest run silently dropped once', () => {
  const row = toTournamentRow(fixtureEvent({ lat: 37.2, lon: -93.3, gi: 1, nogi: 1, kids: 0 }));
  for (const field of ['gi', 'nogi', 'kids', 'lat', 'lon', 'country', 'event_type']) {
    assert.equal(field in row, true, `${field} must be present on the wire; the app has carried this column since 2026-09-23`);
  }
  assert.equal(row.gi, true);
  assert.equal(row.nogi, true);
  assert.equal(row.kids, false);
});

test('lat/lon fall back to null, never undefined or a non-number, when the source event has none', () => {
  const row = toTournamentRow(fixtureEvent({ lat: undefined, lon: undefined }));
  assert.equal(row.lat, null);
  assert.equal(row.lon, null);
});

test('a non-numeric lat/lon (a bad upstream value) is treated as absent, never forwarded as-is', () => {
  const row = toTournamentRow(fixtureEvent({ lat: 'not-a-number', lon: NaN }));
  assert.equal(row.lat, null);
  assert.equal(row.lon, null);
});

test('toTournamentRow maps a stale event to expired, never to a status the app enum lacks', () => {
  const row = toTournamentRow(fixtureEvent({ status: 'stale' }));
  assert.equal(row.status, 'expired');
});

test('toTournamentRow refuses a rejected or needs_review row outright', () => {
  for (const status of ['rejected', 'needs_review', 'draft']) {
    assert.throws(() => toTournamentRow(fixtureEvent({ status })), /not publishable/);
  }
});

test('toTournamentRow refuses a row missing a required field', () => {
  const broken = fixtureEvent();
  delete broken.registration_url;
  assert.throws(() => toTournamentRow(broken), /registration_url/);
});

test('toTournamentRow refuses a row with an empty required field, not just a missing one', () => {
  assert.throws(() => toTournamentRow(fixtureEvent({ city: '' })), /city/);
});

test('optional fields fall back to null, never undefined, so the wire payload has no gaps', () => {
  const row = toTournamentRow(fixtureEvent({ organizer_name: undefined, venue_name: undefined, registration_deadline: undefined }));
  assert.equal(row.org, null);
  assert.equal(row.venue, null);
  assert.equal(row.registration_deadline, null);
});

test('canonicalize sorts keys at every level, so two builds of the same object hash identically', () => {
  const a = canonicalize({ b: 1, a: { d: 2, c: 3 } });
  const b = canonicalize({ a: { c: 3, d: 2 }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":3,"d":2},"b":1}');
});

test('canonicalize preserves array order (arrays are not re-sorted)', () => {
  assert.equal(canonicalize([3, 1, 2]), '[3,1,2]');
});

test('canonicalize handles null and primitive values', () => {
  assert.equal(canonicalize(null), 'null');
  assert.equal(canonicalize('x'), '"x"');
  assert.equal(canonicalize(42), '42');
  assert.equal(canonicalize(true), 'true');
});

test('buildBatch requires a batchId and a timestamp', () => {
  assert.throws(() => buildBatch([], { timestamp: 'x' }), /batchId/);
  assert.throws(() => buildBatch([], { batchId: 'x' }), /timestamp/);
});

test('buildBatch maps every row through toTournamentRow', () => {
  const batch = buildBatch([fixtureEvent(), fixtureEvent({ id: 'evt_2' })], {
    batchId: 'b1',
    timestamp: '2026-09-16T22:00:00.000Z',
  });
  assert.equal(batch.batch_id, 'b1');
  assert.equal(batch.timestamp, '2026-09-16T22:00:00.000Z');
  assert.equal(batch.rows.length, 2);
  assert.equal(batch.rows[1].almanac_id, 'evt_2');
});

test('buildBatch refuses to build a batch over the row cap (the volume alert)', () => {
  const events = Array.from({ length: MAX_BATCH_ROWS + 1 }, (_, i) => fixtureEvent({ id: `evt_${i}` }));
  assert.throws(
    () => buildBatch(events, { batchId: 'b1', timestamp: '2026-09-16T22:00:00.000Z' }),
    /exceeds the cap/,
  );
});

test('buildBatch accepts exactly the cap', () => {
  const events = Array.from({ length: MAX_BATCH_ROWS }, (_, i) => fixtureEvent({ id: `evt_${i}` }));
  const batch = buildBatch(events, { batchId: 'b1', timestamp: '2026-09-16T22:00:00.000Z' });
  assert.equal(batch.rows.length, MAX_BATCH_ROWS);
});
