import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveState, haversineKm, boundingBox, MAX_MATCH_KM } from '../src/geo.js';

// Real coordinates, from the real first crawl: Submission Challenge's
// "Kansas City, MO" event is actually in Independence, MO, and Kansas City
// is the exact place where a nearest-city match can cross a state line.
const INDEPENDENCE_MO = { lat: 39.0278297, lon: -94.357637 };

const PLACES = [
  { city: 'Lake Tapawingo', state: 'MO', lat: 39.0214, lon: -94.31162 },
  { city: 'East Independence', state: 'MO', lat: 39.09556, lon: -94.35523 },
  { city: 'Blue Springs', state: 'MO', lat: 39.01695, lon: -94.28161 },
  { city: 'Independence', state: 'MO', lat: 39.09112, lon: -94.41551 },
];

test('haversine agrees with a known real distance (Kansas City to St Louis, ~380 km)', () => {
  const km = haversineKm(39.0997, -94.5786, 38.627, -90.1994);
  assert.ok(km > 360 && km < 400, `got ${km}`);
});

test('a real venue resolves to the state of the place actually nearest it', () => {
  const r = deriveState(INDEPENDENCE_MO.lat, INDEPENDENCE_MO.lon, PLACES);
  assert.equal(r.state, 'MO');
  assert.equal(r.method, 'derived');
  assert.equal(r.nearestCity, 'Lake Tapawingo');
  assert.ok(r.nearestKm < 5);
});

test('a point past the distance threshold is unknown, never the far-away nearest guess', () => {
  const r = deriveState(45.0, -100.0, PLACES);
  assert.equal(r.state, null);
  assert.match(r.reason, /past the 50 km match threshold|no gazetteer place/);
});

test('an empty gazetteer read is unknown, not a crash and not a default', () => {
  const r = deriveState(INDEPENDENCE_MO.lat, INDEPENDENCE_MO.lon, []);
  assert.equal(r.state, null);
});

test('THE BORDER GUARD: two nearly-equidistant places in different states are unknown, not a coin flip', () => {
  // A real Kansas City shape: a venue with a Kansas and a Missouri place
  // essentially the same distance away.
  const straddling = [
    { city: 'Kansas City', state: 'MO', lat: 39.0997, lon: -94.5786 },
    { city: 'Kansas City', state: 'KS', lat: 39.1141, lon: -94.6275 },
  ];
  const r = deriveState(39.106, -94.603, straddling);
  assert.equal(r.state, null);
  assert.match(r.reason, /ambiguous near a state line/);
  assert.match(r.reason, /MO/);
  assert.match(r.reason, /KS/);
});

test('a decisively-nearer place wins even with another state in range', () => {
  const straddling = [
    { city: 'Right here', state: 'MO', lat: 39.0, lon: -94.0 },
    { city: 'Far side', state: 'KS', lat: 39.3, lon: -94.4 },
  ];
  const r = deriveState(39.0, -94.0, straddling);
  assert.equal(r.state, 'MO');
});

test('missing or non-numeric coordinates are unknown, never 0,0', () => {
  assert.equal(deriveState(null, null, PLACES).state, null);
  assert.equal(deriveState(NaN, -94, PLACES).state, null);
  assert.equal(deriveState(39, undefined, PLACES).state, null);
});

test('gazetteer rows with broken data are ignored rather than trusted', () => {
  const r = deriveState(INDEPENDENCE_MO.lat, INDEPENDENCE_MO.lon, [
    { city: 'No state', state: '', lat: 39.02, lon: -94.35 },
    { city: 'No coords', state: 'KS', lat: null, lon: null },
    ...PLACES,
  ]);
  assert.equal(r.state, 'MO');
});

test('the bounding box widens with latitude, so a northern match cannot be missed', () => {
  const south = boundingBox(25, -80, MAX_MATCH_KM);
  const north = boundingBox(65, -150, MAX_MATCH_KM);
  const width = (b) => b.maxLon - b.minLon;
  assert.ok(width(north) > width(south));
  assert.ok(haversineKm(25, -80, 25, south.maxLon) >= MAX_MATCH_KM * 0.95);
});

test('A NON-US EVENT IS NEVER GIVEN A US STATE -- the real Vancouver BC case', () => {
  // Grappling Industries VANCOUVER, real coordinates from the first
  // listing-mode run. The nearest US gazetteer place is across the border,
  // and the run really did stamp these rows state='WA' before this guard.
  const nearBorderUsPlaces = [{ city: 'Blaine', state: 'WA', lat: 48.9937, lon: -122.7471 }];
  const r = deriveState(49.2487384, -123.0009073, nearBorderUsPlaces, { country: 'CA', maxKm: 100 });
  assert.equal(r.state, null);
  assert.match(r.reason, /US places only/);
  assert.match(r.reason, /CA/);
});

test('a US event with the same shape still resolves normally', () => {
  const r = deriveState(48.99, -122.74, [{ city: 'Blaine', state: 'WA', lat: 48.9937, lon: -122.7471 }], { country: 'US' });
  assert.equal(r.state, 'WA');
});
