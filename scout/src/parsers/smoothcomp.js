// Tier 1 parser for smoothcomp.com (ARCHITECTURE.md section 5; terms review:
// scout/terms-reviews/smoothcomp.sql). Pure functions only: no fetch, no
// import of anything that fetches. A parser takes an HTML string this
// process already has in memory and returns candidate facts; it never goes
// and gets the string itself.
//
// Founder conditions this parser must respect, word for word from the terms
// review record: public event listing and event detail pages only; never a
// registrations, brackets, results, athlete-profile, scoreboard, /order/ or
// /checkout page, and never any page that lists people; facts and source
// URLs only, never copied prose.
//
// Extraction is regex-based, on purpose. This module never runs a <script>
// tag, never evaluates page content, and never uses a DOM library that
// would. A page's own script tags and quoted strings are just characters to
// match against; JSON.parse either returns data or throws, and a throw here
// is caught and treated as "no JSON-LD found", never surfaced as a crash.

import { dedupeKey, isRealDate, isHttpUrl, hostOf } from '../../../console/src/lib.js';

const SOURCE_HOST = 'smoothcomp.com';

// The host's own event id lives in the URL path, e.g.
// /en/event/900001/fixture-open-2027. This is the "host's own event
// reference" the schema's events_source_ref index is keyed on.
const EVENT_ID_FROM_URL = /\/en\/event\/(\d+)(?:\/|$)/i;

// A public event detail page: /en/event/<id> or /en/event/<id>/<slug>, one
// slug segment at most. Deliberately narrow: this is the allow-list, not a
// deny-list, so an unrecognized shape drops out of a listing page rather
// than being guessed at.
const EVENT_DETAIL_PATH = /^\/en\/event\/\d+(?:\/[^/]+)?\/?$/i;

// Paths the founder's terms review names as never to be fetched, because
// each one either lists people or is a registration/payment flow. Checked
// before EVENT_DETAIL_PATH, since several of these shapes (for example
// /en/event/900001/brackets) would otherwise also match that allow-list.
const EXCLUDED_PATH_RULES = [
  { test: (p) => /\/order\//i.test(p), reason: 'excluded path: order/checkout flow (terms review)' },
  { test: (p) => /\/checkout(?:\/|$)/i.test(p), reason: 'excluded path: order/checkout flow (terms review)' },
  { test: (p) => /\/scoreboard(?:\/|$)/i.test(p), reason: 'excluded path: scoreboard, live participant data (terms review)' },
  { test: (p) => /\/brackets(?:\/|$)/i.test(p), reason: 'excluded path: brackets, lists participants (terms review)' },
  { test: (p) => /\/results(?:\/|$)/i.test(p), reason: 'excluded path: results, lists participants (terms review)' },
  { test: (p) => /\/registrations(?:\/|$)/i.test(p), reason: 'excluded path: registrant list, lists participants (terms review)' },
  { test: (p) => /^\/en\/athlete\//i.test(p), reason: 'excluded path: athlete profile, personal data (terms review)' },
];

// ---- tiny, safe HTML readers (regex only, never a DOM, never `eval`) ----

// Every JSON-LD block on the page, parsed with JSON.parse (data in, data
// out; never executed). A block that fails to parse is skipped, not thrown.
function jsonLdBlocks(html) {
  const blocks = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match = re.exec(html);
  while (match) {
    try {
      blocks.push(JSON.parse(match[1]));
    } catch {
      // malformed or truncated JSON-LD is not a page we can trust; skip it
    }
    match = re.exec(html);
  }
  return blocks;
}

// The first JSON-LD item whose @type names an event (Event, SportsEvent,
// and so on). Smoothcomp fixtures use SportsEvent; the match is loose on
// purpose so a differently-typed event block is not silently missed.
function extractJsonLdEvent(html) {
  for (const block of jsonLdBlocks(html)) {
    const items = Array.isArray(block) ? block : [block];
    for (const item of items) {
      const type = item && item['@type'];
      const types = Array.isArray(type) ? type : [type];
      if (types.some((t) => typeof t === 'string' && /event/i.test(t))) return item;
    }
  }
  return null;
}

// The opening tag of the first element whose `attr` contains `needle`, for
// example the <div id="event-meta" ...> block or the <a class="js-register-
// link" ...> anchor. Returns the tag text only (never its children), so a
// later `extractAttr` call reads attributes, not page content.
function findOpeningTag(html, attr, needle) {
  const re = new RegExp(`<[a-z][a-z0-9]*\\b[^>]*\\b${attr}\\s*=\\s*["'][^"']*${needle}[^"']*["'][^>]*>`, 'i');
  const match = html.match(re);
  return match ? match[0] : null;
}

function extractAttr(tag, attr) {
  if (!tag) return null;
  const match = tag.match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? match[1] : null;
}

function extractEventMeta(html) {
  const tag = findOpeningTag(html, 'id', 'event-meta');
  if (!tag) return {};
  return {
    gi: extractAttr(tag, 'data-gi') === '1',
    nogi: extractAttr(tag, 'data-nogi') === '1',
    kids: extractAttr(tag, 'data-kids') === '1',
    registrationDeadline: extractAttr(tag, 'data-registration-deadline') || null,
  };
}

function extractRegistrationUrl(html) {
  const tag = findOpeningTag(html, 'class', 'js-register-link');
  return extractAttr(tag, 'href');
}

function extractAllHrefs(html) {
  const hrefs = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match = re.exec(html);
  while (match) {
    hrefs.push(match[1]);
    match = re.exec(html);
  }
  return hrefs;
}

// Percent-decoded, so an encoded traversal (%2F, %2E) is judged by what the
// path actually resolves to, not by the literal characters that happened to
// precede decoding. WHATWG URL deliberately leaves %2F etc. encoded in
// .pathname (Opus review, 2026-09-19: a listing-page link like
// "/en/event/900001/%2e%2e%2f%2e%2e%2forder%2fx" walked straight past
// EXCLUDED_PATH_RULES because the raw pathname never looked like /order/ at
// all). Decoded repeatedly, bounded, to also catch double-encoding; a
// malformed sequence fails closed (null), never silently falls back to the
// raw (unsafe) string.
function decodedPathname(pathname) {
  let value = pathname;
  for (let i = 0; i < 3; i += 1) {
    let next;
    try {
      next = decodeURIComponent(value);
    } catch {
      return null;
    }
    if (next === value) return value;
    value = next;
  }
  return value;
}

// ---- one place that decides whether a smoothcomp.com URL may be touched ----

// Both the listing parser (deciding which links to keep) and the fetcher
// (deciding whether a request may leave at all) call this. There is exactly
// one exclusion list in the repository; a second copy is how a rule quietly
// stops being enforced while the tests still pass.
// allowedHosts defaults to [SOURCE_HOST] alone, exactly the original
// behavior every existing caller and fixture relies on. The real crawl
// path passes the company's actual active alias hostnames (ARCHITECTURE.md
// section 9, "one company, many hostnames": the terms review is a ruling
// about Smoothcomp the company, not about the literal string
// "smoothcomp.com" -- a link on an organizer's own reviewed subdomain,
// fujibjj.smoothcomp.com, is exactly as real an event link as one on the
// bare domain, and rejecting it here would make this parser unable to
// read the pages it exists to read).
export function classifyUrl(rawUrl, { base = null, allowedHosts = [SOURCE_HOST] } = {}) {
  let resolved;
  try {
    resolved = new URL(rawUrl, base ?? undefined);
  } catch {
    return { ok: false, reason: 'not a resolvable URL' };
  }
  // https only. discovered_pages.url carries CHECK (url LIKE 'https://%'),
  // and fetcher.js never sends anything else -- an http: link on a real
  // listing page (ordinary; mixed-scheme anchors are common) used to reach
  // this far and abort the whole enqueue batch downstream (Opus review,
  // 2026-09-19). Refusing it HERE means it is simply dropped, not enqueued,
  // exactly like any other link this parser declines to keep.
  if (resolved.protocol !== 'https:') {
    return { ok: false, reason: `only https is crawled, this is ${resolved.protocol.replace(':', '')}`, url: resolved };
  }
  const hosts = allowedHosts.map((h) => h.toLowerCase());
  if (!hosts.includes(resolved.hostname.toLowerCase())) {
    return { ok: false, reason: `not on ${hosts.join(', ')}`, url: resolved };
  }
  const decoded = decodedPathname(resolved.pathname);
  if (decoded === null) {
    return { ok: false, reason: 'malformed percent-encoding in path', url: resolved };
  }
  const excluded = EXCLUDED_PATH_RULES.find((rule) => rule.test(decoded));
  if (excluded) return { ok: false, reason: excluded.reason, url: resolved };
  if (!EVENT_DETAIL_PATH.test(decoded)) {
    return { ok: false, reason: 'not an event detail page path', url: resolved };
  }
  return { ok: true, url: resolved };
}

// The shape `fetcher.js` wants: a path in, an { ok, reason } out. Kept
// deliberately thin so the fetcher inherits the rules above rather than
// restating them. `host` defaults to SOURCE_HOST for every existing
// caller; the real crawl path passes the specific alias host it is
// actually about to fetch from, so a path is judged against the host it
// will really be requested on.
export function pathAllowed(path, { host = SOURCE_HOST } = {}) {
  return classifyUrl(`https://${host}${path}`, { allowedHosts: [host] });
}

// ---- listing pages ----

// Returns { eventUrls, dropped }. `eventUrls` are absolute, deduplicated,
// smoothcomp.com event detail page links only. `dropped` reports every
// other link found, each with the reason it was not kept, so a listing page
// full of registration/bracket/athlete links proves what it excluded, not
// just what it kept.
export function parseListingPage(html, { url, allowedHosts = [SOURCE_HOST] } = {}) {
  const safeHtml = typeof html === 'string' ? html : '';
  const seen = new Set();
  const eventUrls = [];
  const dropped = [];

  // Smoothcomp's federation "upcoming events" pages serve their list as a
  // JSON-LD ItemList, not as <a href> anchors (found by the first live
  // crawl, 2026-09-20: 6 real listing pages, 0 anchors, 100+ ItemList
  // urls). Same data-only reading as parseEventPage's JSON-LD: JSON.parse,
  // never evaluated; every url still goes through classifyUrl below.
  const candidates = extractAllHrefs(safeHtml);
  for (const block of jsonLdBlocks(safeHtml)) {
    for (const item of Array.isArray(block) ? block : [block]) {
      if (item && item['@type'] === 'ItemList' && Array.isArray(item.itemListElement)) {
        for (const el of item.itemListElement) if (el && typeof el.url === 'string') candidates.push(el.url);
      }
    }
  }

  for (const raw of candidates) {
    const verdict = classifyUrl(raw, { base: url, allowedHosts });
    if (!verdict.ok) {
      dropped.push({ url: verdict.url ? verdict.url.toString() : raw, reason: verdict.reason });
      continue;
    }

    const href = verdict.url.toString();
    if (!seen.has(href)) {
      seen.add(href);
      eventUrls.push(href);
    }
  }

  return { eventUrls, dropped };
}

// ---- listing pages, as a SOURCE OF FACTS ----

// Smoothcomp's federation listing pages carry a `var events = [...]` array
// server-side, holding exactly the facts the matcher needs: title, url,
// start/end date, city, country and coordinates. Founder ruling
// (2026-09-20): build drafts from this, and never fetch the event page,
// which returns 403 to us.
//
// Read as DATA, never executed: the array text is sliced out by bracket
// depth and handed to JSON.parse, the same discipline as the JSON-LD
// readers above. A malformed or truncated array yields no events, never a
// throw.
const LISTING_EVENTS_VAR = /var\s+events\s*=\s*\[/;

function sliceJsonArray(html, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < html.length; i += 1) {
    const ch = html[i];
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return html.slice(startIndex, i + 1);
    }
  }
  return null;
}

function listingEventObjects(html) {
  const match = LISTING_EVENTS_VAR.exec(html);
  if (!match) return [];
  const text = sliceJsonArray(html, match.index + match[0].length - 1);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Facts only, same rule as parseEventPage: no description, no prose, no
// person. `state` is deliberately absent -- the listing does not carry it,
// and it is derived from the coordinates by the caller (scout/src/geo.js),
// never guessed here.
export function parseListingEvents(html, { url, allowedHosts = [SOURCE_HOST] } = {}) {
  const safeHtml = typeof html === 'string' ? html : '';
  const events = [];
  const dropped = [];
  for (const raw of listingEventObjects(safeHtml)) {
    const verdict = classifyUrl(String(raw?.url ?? ''), { base: url, allowedHosts });
    if (!verdict.ok) {
      dropped.push({ url: String(raw?.url ?? ''), reason: verdict.reason });
      continue;
    }
    const name = typeof raw.title === 'string' ? raw.title.trim() : '';
    const startDate = typeof raw.startdate === 'string' ? raw.startdate.slice(0, 10) : '';
    const endDate = typeof raw.enddate === 'string' && raw.enddate ? raw.enddate.slice(0, 10) : null;
    // Smoothcomp's listing puts the whole place in one field, sometimes
    // with the state or country appended ("Springfield, MO", "Fargo, North
    // Dakota"). `city` is the city, so the trailing qualifier is dropped --
    // otherwise the console renders "Springfield, MO, MO, US". The state is
    // derived from coordinates regardless, never read from this string.
    const city = typeof raw.location_city === 'string' ? raw.location_city.split(',')[0].trim() : '';
    const country = typeof raw.location_country === 'string' ? raw.location_country.trim().toUpperCase() : '';
    const lat = Number(raw.location_lat);
    const lon = Number(raw.location_long);

    const missing = [];
    if (!name) missing.push('name');
    if (!startDate) missing.push('start date');
    if (!city) missing.push('city');
    if (country.length !== 2) missing.push('country');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) missing.push('coordinates');
    if (missing.length > 0) {
      dropped.push({ url: verdict.url.toString(), reason: `listing entry is missing required field(s): ${missing.join(', ')}` });
      continue;
    }
    if (!isRealDate(startDate)) {
      dropped.push({ url: verdict.url.toString(), reason: `the start date "${startDate}" is not a real calendar date` });
      continue;
    }
    if (endDate && (!isRealDate(endDate) || endDate < startDate)) {
      dropped.push({ url: verdict.url.toString(), reason: `the end date "${endDate}" is not a real date on or after the start date` });
      continue;
    }
    events.push({ name, startDate, endDate, city, country, lat, lon, sourceUrl: verdict.url.toString(), sourceEventRef: (verdict.url.pathname.match(EVENT_ID_FROM_URL) ?? [])[1] ?? null });
  }
  return { events, dropped };
}

// A draft row built from LISTING data only. Differences from toDraftRow, all
// deliberate and all recorded in the row itself rather than left implied:
//
//   - `state` is supplied by the caller from the gazetteer match, and
//     state_source says 'derived' so a reviewer knows it was not on the page.
//   - registration_url is the event page URL. That page 403s us, so we
//     cannot and do not claim a live check: link_check_method is
//     'structural'. The console renders that differently on purpose.
//   - gi/nogi/kids stay 0 and the divisions are unknown; the matcher
//     downranks an unconfirmed division, as ruled.
//   - venue_name, address, organizer_name and registration_deadline are not
//     on the listing, so they are null rather than invented.
export function toListingDraftRow(candidate, { state }) {
  return {
    id: crypto.randomUUID(),
    event_type: 'tournament',
    name: candidate.name,
    organizer_name: null,
    start_date: candidate.startDate,
    end_date: candidate.endDate ?? null,
    venue_name: null,
    address: null,
    city: candidate.city,
    state,
    country: candidate.country,
    lat: candidate.lat,
    lon: candidate.lon,
    registration_url: candidate.sourceUrl,
    registration_deadline: null,
    gi: 0,
    nogi: 0,
    kids: 0,
    source_url: candidate.sourceUrl,
    source_host: hostOf(candidate.sourceUrl),
    source_event_ref: candidate.sourceEventRef ?? null,
    source_tier: 1,
    state_source: 'derived',
    link_check_method: 'structural',
    dedupe_key: dedupeKey({ name: candidate.name, start_date: candidate.startDate, country: candidate.country, state, city: candidate.city }),
  };
}

// ---- event detail pages ----

// Facts only, per ARCHITECTURE.md section 6 / the terms review: name,
// organizer, start/end date, venue name, address, city, state, country,
// registration URL (https only), registration deadline, gi/nogi/kids, and
// the host's own event id. Never a description, never prose, never a
// person's name.
export function parseEventPage(html, { url } = {}) {
  const safeHtml = typeof html === 'string' ? html : '';
  if (typeof url !== 'string' || url === '') {
    return { ok: false, reason: 'no source URL was supplied for this page' };
  }

  const ld = extractJsonLdEvent(safeHtml);
  const meta = extractEventMeta(safeHtml);

  const name = ld && typeof ld.name === 'string' ? ld.name.trim() : '';
  const organizer = ld && ld.organizer && typeof ld.organizer.name === 'string' ? ld.organizer.name.trim() : null;
  const location = ld && ld.location && typeof ld.location === 'object' ? ld.location : null;
  const venueName = location && typeof location.name === 'string' ? location.name.trim() : null;
  const addr = location && location.address && typeof location.address === 'object' ? location.address : null;
  const address = addr && typeof addr.streetAddress === 'string' ? addr.streetAddress.trim() : null;
  const city = addr && typeof addr.addressLocality === 'string' ? addr.addressLocality.trim() : '';
  const state = addr && typeof addr.addressRegion === 'string' ? addr.addressRegion.trim().toUpperCase() : '';
  const country = addr && typeof addr.addressCountry === 'string' ? addr.addressCountry.trim().toUpperCase() : '';

  const startDate = ld && typeof ld.startDate === 'string' ? ld.startDate.slice(0, 10) : '';
  const endDate = ld && typeof ld.endDate === 'string' ? ld.endDate.slice(0, 10) : null;

  // Impossible dates are rejected on their own, distinctly from a missing
  // field, so the reason names the actual defect.
  if (startDate && !isRealDate(startDate)) {
    return { ok: false, reason: `the start date "${startDate}" is not a real calendar date` };
  }
  if (endDate && !isRealDate(endDate)) {
    return { ok: false, reason: `the end date "${endDate}" is not a real calendar date` };
  }
  if (endDate && startDate && endDate < startDate) {
    return { ok: false, reason: `the end date "${endDate}" is before the start date "${startDate}"` };
  }

  const missing = [];
  if (!name) missing.push('name');
  if (!startDate) missing.push('start date');
  if (!city) missing.push('city');
  if (!(state.length >= 1 && state.length <= 3)) missing.push('state');
  if (country.length !== 2) missing.push('country');
  if (missing.length > 0) {
    return { ok: false, reason: `this page is missing required field(s): ${missing.join(', ')}` };
  }

  const warnings = [];

  const registrationUrlRaw = extractRegistrationUrl(safeHtml);
  let registrationUrl = null;
  if (!registrationUrlRaw) {
    warnings.push('no registration link was found on this page; this row cannot be approved without one');
  } else if (!isHttpUrl(registrationUrlRaw, { httpsOnly: true })) {
    warnings.push(`the registration link found ("${registrationUrlRaw}") is not an https URL and was dropped`);
  } else {
    registrationUrl = registrationUrlRaw;
  }

  let registrationDeadline = null;
  if (meta.registrationDeadline) {
    if (isRealDate(meta.registrationDeadline)) {
      registrationDeadline = meta.registrationDeadline;
    } else {
      warnings.push(`the registration deadline "${meta.registrationDeadline}" is not a real calendar date and was dropped`);
    }
  }

  const eventIdMatch = url.match(EVENT_ID_FROM_URL);

  const event = {
    name,
    organizer,
    startDate,
    endDate,
    venueName,
    address,
    city,
    state,
    country,
    registrationUrl,
    registrationDeadline,
    gi: Boolean(meta.gi),
    nogi: Boolean(meta.nogi),
    kids: Boolean(meta.kids),
    sourceUrl: url,
    sourceEventRef: eventIdMatch ? eventIdMatch[1] : null,
  };

  return { ok: true, event, warnings };
}

// Shapes a successful parseEventPage() candidate into a row ready for
// `INSERT INTO events`. `status` is left out entirely so the database's own
// default ('draft') and its insert-time triggers are what apply it; this
// function never sets `approved_by`, `approved_at` or `approval_rule`, and
// never could, since they are not in its output at all.
//
// source_host is derived from candidate.sourceUrl's REAL hostname, not the
// bare SOURCE_HOST constant -- one company can have many active alias
// hostnames (ARCHITECTURE.md section 9), and events.source_host records
// where a row was actually found, the same field the events_source_ref
// dedup index is keyed on. A row crawled from fujibjj.smoothcomp.com must
// say so, not claim to be from smoothcomp.com.
//
// event_type is not among the facts this parser extracts (the source pages
// carry no reliable signal for it), so every Smoothcomp row defaults to
// 'tournament', the platform's overwhelmingly common case. This is a named
// gap: see docs/VERIFICATION.md.
export function toDraftRow(candidate) {
  return {
    id: crypto.randomUUID(),
    event_type: 'tournament',
    name: candidate.name,
    organizer_name: candidate.organizer ?? null,
    start_date: candidate.startDate,
    end_date: candidate.endDate ?? null,
    venue_name: candidate.venueName ?? null,
    address: candidate.address ?? null,
    city: candidate.city,
    state: candidate.state,
    country: candidate.country,
    registration_url: candidate.registrationUrl ?? null,
    registration_deadline: candidate.registrationDeadline ?? null,
    gi: candidate.gi ? 1 : 0,
    nogi: candidate.nogi ? 1 : 0,
    kids: candidate.kids ? 1 : 0,
    source_url: candidate.sourceUrl,
    source_host: hostOf(candidate.sourceUrl),
    source_event_ref: candidate.sourceEventRef ?? null,
    source_tier: 1,
    dedupe_key: dedupeKey({
      name: candidate.name,
      start_date: candidate.startDate,
      country: candidate.country,
      state: candidate.state,
      city: candidate.city,
    }),
  };
}

export { SOURCE_HOST, EVENT_DETAIL_PATH, EXCLUDED_PATH_RULES };
