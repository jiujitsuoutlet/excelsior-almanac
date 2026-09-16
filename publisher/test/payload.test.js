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

test('toTournamentRow maps only the fields the app tournaments table has today', () => {
  const row = toTournamentRow(fixtureEvent());
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
    status: 'approved',
  });
});

test('toTournamentRow never carries country, lat, lon, or event_type', () => {
  const row = toTournamentRow(fixtureEvent({ lat: 37.2, lon: -93.3, event_type: 'superfight' }));
  for (const field of ['country', 'lat', 'lon', 'event_type']) {
    assert.equal(field in row, false, `${field} must not appear until the app migrates for it`);
  }
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
