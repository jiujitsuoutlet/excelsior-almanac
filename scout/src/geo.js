// Deriving a US state from coordinates, against the places gazetteer
// (founder ruling, 2026-09-20: "derive it from the coordinates against the
// places gazetteer... reverse-match to the nearest one and take its state.
// Record it as derived, not scraped, and flag any match beyond a sensible
// distance threshold as unknown rather than guessing").
//
// Pure: candidates come from the caller (a bounding-box read of `places`),
// so this decides nothing about databases and can be tested with no D1.
//
// Two guards, because "nearest wins" alone is not honest near a border:
//
//   1. DISTANCE. A point more than MAX_MATCH_KM from any known place is not
//      described by that place. cities500 holds every US settlement over
//      500 people, so a real tournament venue is close to one; a match 80 km
//      out means we are reading an empty-country coordinate, or bad data.
//   2. AMBIGUITY. Within AMBIGUITY_RATIO of the nearest distance, if any
//      candidate names a DIFFERENT state, the answer is unknown. A venue
//      five miles from a state line is genuinely ambiguous to a
//      nearest-city match, and Kansas City is the exact case this crawl
//      meets first (ARCHITECTURE.md section 14 already records organizers
//      whose "Kansas City" events alternate between Missouri and Kansas).
//
// Unknown is a real answer here, never a fallback: the caller writes no row.

export const MAX_MATCH_KM = 50;
export const AMBIGUITY_RATIO = 1.5;

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

export function haversineKm(aLat, aLon, bLat, bLon) {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {Array<{state: string, city?: string, lat: number, lon: number}>} candidates
 * @returns {{ state: string, method: 'derived', nearestKm: number, nearestCity: string|null }
 *          | { state: null, reason: string }}
 */
export function deriveState(lat, lon, candidates, { maxKm = MAX_MATCH_KM, ambiguityRatio = AMBIGUITY_RATIO, country = 'US' } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { state: null, reason: 'the event carries no usable coordinates' };
  }
  // The gazetteer is US-only, so it can only answer for a US event. Found
  // by the first listing-mode run, which put three Grappling Industries
  // VANCOUVER (BC, Canada) rows in front of a reviewer stamped state='WA':
  // the nearest US place to Vancouver is across the border in Washington,
  // and "nearest place wins" answered a question it had no business
  // answering. A non-US event is unknown here, not nearly-Washington.
  if (country !== 'US') {
    return { state: null, reason: `the gazetteer covers US places only, and this event is in ${country}` };
  }
  const scored = (candidates ?? [])
    .filter((c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lon) && typeof c.state === 'string' && c.state !== '')
    .map((c) => ({ ...c, km: haversineKm(lat, lon, c.lat, c.lon) }))
    .sort((a, b) => a.km - b.km);

  if (scored.length === 0) {
    return { state: null, reason: 'no gazetteer place is anywhere near these coordinates' };
  }
  const nearest = scored[0];
  if (nearest.km > maxKm) {
    return { state: null, reason: `the nearest known place is ${nearest.km.toFixed(1)} km away, past the ${maxKm} km match threshold` };
  }
  const contenders = scored.filter((c) => c.km <= Math.max(nearest.km * ambiguityRatio, 1));
  const disagreeing = contenders.find((c) => c.state !== nearest.state);
  if (disagreeing) {
    return {
      state: null,
      reason: `ambiguous near a state line: ${nearest.city ?? 'a place'} (${nearest.state}, ${nearest.km.toFixed(1)} km) and ${disagreeing.city ?? 'another place'} (${disagreeing.state}, ${disagreeing.km.toFixed(1)} km) are both closest`,
    };
  }
  return { state: nearest.state, method: 'derived', nearestKm: nearest.km, nearestCity: nearest.city ?? null };
}

// The bounding box a caller should read from `places` before calling
// deriveState. One degree of latitude is ~111 km everywhere; one degree of
// longitude shrinks with latitude, so the box widens as it goes north --
// otherwise a match near the Canadian border would miss places that are
// genuinely closer in kilometres than the box's own corners.
export function boundingBox(lat, lon, km = MAX_MATCH_KM) {
  const latDelta = km / 111;
  const cos = Math.max(0.15, Math.cos(toRad(lat)));
  const lonDelta = km / (111 * cos);
  return { minLat: lat - latDelta, maxLat: lat + latDelta, minLon: lon - lonDelta, maxLon: lon + lonDelta };
}
