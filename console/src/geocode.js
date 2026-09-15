// Geocoding on save (MAD v2.54 decision 7: OpenCage, results stored permanently).
// Runs only when the OPENCAGE_API_KEY Worker secret exists. Without it, the
// event saves without coordinates and the console shows it as not geocoded.
// Coordinates are kept only when OpenCage places the result in the same
// ISO 3166-2 subdivision the reviewer entered.

export async function geocode(event, env, fetchImpl = fetch) {
  if (!env.OPENCAGE_API_KEY) return null;
  const query = [event.venue_name, event.address, event.city, event.state, event.country].filter(Boolean).join(', ');
  const params = new URLSearchParams({
    q: query,
    key: env.OPENCAGE_API_KEY,
    countrycode: event.country.toLowerCase(),
    limit: '1',
    no_annotations: '1',
  });
  const res = await fetchImpl(`https://api.opencagedata.com/geocode/v1/json?${params}`);
  if (!res.ok) return null;
  const data = await res.json();
  const result = data.results?.[0];
  if (!result) return null;
  const subdivisions = result.components?.['ISO_3166-2'] ?? [];
  if (!subdivisions.includes(`${event.country}-${event.state}`)) return null;
  return { lat: result.geometry.lat, lon: result.geometry.lng, confidence: result.confidence };
}
