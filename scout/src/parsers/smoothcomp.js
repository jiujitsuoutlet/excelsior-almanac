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

import { dedupeKey, isRealDate, isHttpUrl } from '../../../console/src/lib.js';

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

// ---- listing pages ----

// Returns { eventUrls, dropped }. `eventUrls` are absolute, deduplicated,
// smoothcomp.com event detail page links only. `dropped` reports every
// other link found, each with the reason it was not kept, so a listing page
// full of registration/bracket/athlete links proves what it excluded, not
// just what it kept.
export function parseListingPage(html, { url } = {}) {
  const safeHtml = typeof html === 'string' ? html : '';
  const seen = new Set();
  const eventUrls = [];
  const dropped = [];

  for (const raw of extractAllHrefs(safeHtml)) {
    let resolved;
    try {
      resolved = new URL(raw, url);
    } catch {
      dropped.push({ url: raw, reason: 'not a resolvable URL' });
      continue;
    }

    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      dropped.push({ url: raw, reason: `not an http(s) link (${resolved.protocol})` });
      continue;
    }
    if (resolved.hostname.toLowerCase() !== SOURCE_HOST) {
      dropped.push({ url: resolved.toString(), reason: `not on ${SOURCE_HOST}` });
      continue;
    }

    const path = resolved.pathname;
    const excluded = EXCLUDED_PATH_RULES.find((rule) => rule.test(path));
    if (excluded) {
      dropped.push({ url: resolved.toString(), reason: excluded.reason });
      continue;
    }
    if (!EVENT_DETAIL_PATH.test(path)) {
      dropped.push({ url: resolved.toString(), reason: 'not an event detail page path' });
      continue;
    }

    const href = resolved.toString();
    if (!seen.has(href)) {
      seen.add(href);
      eventUrls.push(href);
    }
  }

  return { eventUrls, dropped };
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
    source_host: SOURCE_HOST,
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
