import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseEventPage, parseListingPage, toDraftRow, classifyUrl, pathAllowed, SOURCE_HOST } from '../../src/parsers/smoothcomp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'smoothcomp');

function fixture(name) {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

// Every fixture is hand-written synthetic HTML: invented event names, dates,
// venues and ids ("Fixture ...", "Testburg"). None of it is a real
// Smoothcomp page; it exists only to exercise the parser's structure walk
// (JSON-LD shape, the event-meta attributes, anchor tags).

// This module never fetches, and it must never be able to: patch the global
// fetch with a counter for the whole file and assert it is never touched by
// any parser call below, on any fixture, including the malformed ones.
let fetchCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  fetchCalls += 1;
  throw new Error(`smoothcomp parser must never call fetch; called with ${JSON.stringify(args)}`);
};
test.after(() => {
  globalThis.fetch = realFetch;
});

test('a complete event page parses every field', () => {
  const url = 'https://smoothcomp.com/en/event/900001/fixture-open-2027';
  const result = parseEventPage(fixture('complete-event.html'), { url });
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.event, {
    name: 'Fixture Open 2027',
    organizer: 'Fixture Grappling Series',
    startDate: '2027-03-06',
    endDate: null,
    venueName: 'Testburg Convention Center',
    address: '100 Fixture Way',
    city: 'Testburg',
    state: 'MO',
    country: 'US',
    registrationUrl: 'https://smoothcomp.com/en/event/900001/register',
    registrationDeadline: '2027-02-20',
    gi: true,
    nogi: true,
    kids: false,
    sourceUrl: url,
    sourceEventRef: '900001',
  });
});

test('toDraftRow shapes a candidate for insertion: draft-only, tier 1, this host, with the console dedupe key', () => {
  const url = 'https://smoothcomp.com/en/event/900001/fixture-open-2027';
  const { event } = parseEventPage(fixture('complete-event.html'), { url });
  const row = toDraftRow(event);

  assert.equal(row.source_tier, 1);
  assert.equal(row.source_host, 'smoothcomp.com');
  assert.equal(row.source_event_ref, '900001');
  assert.equal(row.name, 'Fixture Open 2027');
  assert.equal(row.start_date, '2027-03-06');
  assert.equal(row.registration_url, 'https://smoothcomp.com/en/event/900001/register');
  assert.equal(row.gi, 1);
  assert.equal(row.nogi, 1);
  assert.equal(row.kids, 0);
  assert.equal(typeof row.id, 'string');
  assert.ok(row.id.length > 0);
  assert.equal(typeof row.dedupe_key, 'string');
  // dedupeKey normalizes the name (console/src/lib.js strips bare years like
  // "2027" from the name before joining with the raw start_date), so the
  // key reads "fixture open|2027-03-06|...", not "fixture open 2027|...".
  assert.equal(row.dedupe_key, 'fixture open|2027-03-06|US|MO|testburg');
  // Never sets a status, or anything that could approve the row. The
  // database's own default ('draft') and its triggers are what apply
  // beyond this point; toDraftRow does not even have the vocabulary to
  // set an approval.
  assert.equal('status' in row, false);
  assert.equal('approved_by' in row, false);
  assert.equal('approved_at' in row, false);
  assert.equal('approval_rule' in row, false);
});

test('a page missing the registration link is still ok: true, with a warning', () => {
  const url = 'https://smoothcomp.com/en/event/900002/fixture-spring-open';
  const result = parseEventPage(fixture('missing-registration.html'), { url });
  assert.equal(result.ok, true);
  assert.equal(result.event.registrationUrl, null);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /no registration link/);
});

test('a page missing a required field is ok: false with a plain-English reason, never a half-built row', () => {
  const url = 'https://smoothcomp.com/en/event/900003/fixture-no-city-open';
  const result = parseEventPage(fixture('missing-required-field.html'), { url });
  assert.equal(result.ok, false);
  assert.equal('event' in result, false);
  assert.match(result.reason, /missing required field/);
  assert.match(result.reason, /city/);
});

test('a date range across two days fills both start and end', () => {
  const url = 'https://smoothcomp.com/en/event/900004/fixture-summer-camp-open';
  const result = parseEventPage(fixture('date-range.html'), { url });
  assert.equal(result.ok, true);
  assert.equal(result.event.startDate, '2027-06-10');
  assert.equal(result.event.endDate, '2027-06-12');
});

test('an impossible date (2027-02-30) is rejected, not silently accepted', () => {
  const url = 'https://smoothcomp.com/en/event/900005/fixture-impossible-date-open';
  const result = parseEventPage(fixture('impossible-date.html'), { url });
  assert.equal(result.ok, false);
  assert.equal('event' in result, false);
  assert.match(result.reason, /not a real calendar date/);
  assert.match(result.reason, /2027-02-30/);
});

test('a listing page keeps only allowed event detail links, and reports every drop with a reason', () => {
  const url = 'https://smoothcomp.com/en/events';
  const { eventUrls, dropped } = parseListingPage(fixture('listing-mixed.html'), { url });

  assert.deepEqual(eventUrls, [
    'https://smoothcomp.com/en/event/900001/fixture-open-2027',
    'https://smoothcomp.com/en/event/900002/fixture-spring-open',
    'https://smoothcomp.com/en/event/900006/fixture-fall-open',
  ]);

  const reasonFor = (url_) => dropped.find((d) => d.url === url_)?.reason;
  assert.match(reasonFor('https://smoothcomp.com/en/about'), /not an event detail page/);
  assert.match(reasonFor('https://example.com/other-site'), /not on smoothcomp\.com/);
  assert.match(reasonFor('https://smoothcomp.com/en/event/900001/order/confirm'), /order\/checkout/);
  assert.match(reasonFor('https://smoothcomp.com/en/event/900001/checkout'), /order\/checkout/);
  assert.match(reasonFor('https://smoothcomp.com/en/event/900001/scoreboard'), /scoreboard/);
  assert.match(reasonFor('https://smoothcomp.com/en/event/900001/brackets'), /brackets/);
  assert.match(reasonFor('https://smoothcomp.com/en/event/900001/results'), /results/);
  assert.match(reasonFor('https://smoothcomp.com/en/event/900001/registrations'), /registrant list/);
  assert.match(reasonFor('https://smoothcomp.com/en/athlete/55555'), /athlete profile/);

  // javascript: is neither http nor https, and is dropped, not followed.
  assert.ok(dropped.some((d) => d.url === 'javascript:void(0)' && /not an http\(s\) link/.test(d.reason)));

  // The repeated card for the same event contributes one URL, not two.
  assert.equal(eventUrls.filter((u) => u === 'https://smoothcomp.com/en/event/900001/fixture-open-2027').length, 1);
});

test('a malformed, truncated page never throws; it comes back ok: false', () => {
  const url = 'https://smoothcomp.com/en/event/900007/fixture-truncated-open';
  assert.doesNotThrow(() => {
    const result = parseEventPage(fixture('malformed-truncated.html'), { url });
    assert.equal(result.ok, false);
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason.length > 0);
  });
});

test('a page holding a <script> tag and quoted content is read as data only, never executed or trusted', () => {
  const url = 'https://smoothcomp.com/en/event/900008/fixture-grapplers-cup';
  const result = parseEventPage(fixture('script-and-quotes.html'), { url });
  assert.equal(result.ok, true);
  // The apostrophe and embedded quote came through JSON.parse intact...
  assert.equal(result.event.name, "Fixture Grappler's Cup");
  assert.equal(result.event.venueName, 'Testburg "Downtown" Center');
  // ...and nothing from the <script> tag or the comment leaked into any field.
  const flattened = JSON.stringify(result.event);
  assert.doesNotMatch(flattened, /<script/i);
  assert.doesNotMatch(flattened, /alert\(/);
  assert.doesNotMatch(flattened, /document\.write/);
});

test('parseEventPage refuses to guess without a source URL', () => {
  const result = parseEventPage(fixture('complete-event.html'), {});
  assert.equal(result.ok, false);
  assert.match(result.reason, /no source URL/);
});

test('parseEventPage and parseListingPage never throw on non-string or empty html', () => {
  assert.doesNotThrow(() => parseEventPage(null, { url: 'https://smoothcomp.com/en/event/1/x' }));
  assert.doesNotThrow(() => parseEventPage(undefined, { url: 'https://smoothcomp.com/en/event/1/x' }));
  assert.doesNotThrow(() => parseEventPage('', { url: 'https://smoothcomp.com/en/event/1/x' }));
  assert.doesNotThrow(() => parseListingPage(null, { url: 'https://smoothcomp.com/en/events' }));
  assert.deepEqual(parseListingPage('', { url: 'https://smoothcomp.com/en/events' }), { eventUrls: [], dropped: [] });
});

test('SOURCE_HOST is exactly smoothcomp.com, and only that host', () => {
  assert.equal(SOURCE_HOST, 'smoothcomp.com');
});

test('the fetch counter was never touched by any of the above (no network reachable from this module)', () => {
  assert.equal(fetchCalls, 0);
});

// A parser must never decide approval. If a future edit adds any of these
// keys, this fails here rather than being silently dropped by an insert.
test('toDraftRow never carries status or approval fields', () => {
  const url = 'https://smoothcomp.com/en/event/900001/fixture-open-2027';
  const parsed = parseEventPage(fixture('complete-event.html'), { url });
  assert.equal(parsed.ok, true);
  const row = toDraftRow(parsed.event);
  for (const forbidden of ['status', 'approved_by', 'approved_at', 'approval_rule', 'published_at']) {
    assert.ok(!(forbidden in row), `toDraftRow must not set ${forbidden}; the database owns it`);
  }
  assert.equal(row.source_tier, 1);
  assert.equal(row.source_host, 'smoothcomp.com');
});

// ---- ARCHITECTURE.md section 9: "one company, many hostnames" ----
// The terms review is a ruling about Smoothcomp the company, not the
// literal string "smoothcomp.com". An organizer's own reviewed
// subdomain (fujibjj.smoothcomp.com) must be readable by this parser, or
// the alias infrastructure (excelsior-almanac#17) has nothing real to
// point at.

test('classifyUrl defaults to SOURCE_HOST alone -- every existing caller keeps working unchanged', () => {
  const onBareDomain = classifyUrl('https://smoothcomp.com/en/event/900001');
  assert.equal(onBareDomain.ok, true);
  const onAlias = classifyUrl('https://fujibjj.smoothcomp.com/en/event/900001');
  assert.equal(onAlias.ok, false, 'without an explicit allowedHosts list, only the bare SOURCE_HOST is accepted');
  assert.match(onAlias.reason, /not on smoothcomp\.com/);
});

test('classifyUrl accepts a real organizer alias when it is passed as an allowed host', () => {
  const result = classifyUrl('https://fujibjj.smoothcomp.com/en/event/900001', { allowedHosts: ['fujibjj.smoothcomp.com'] });
  assert.equal(result.ok, true);
});

test('classifyUrl still refuses an alias NOT in the allowed list -- a human approves each hostname, never a pattern', () => {
  const result = classifyUrl('https://not-a-reviewed-alias.smoothcomp.com/en/event/900001', { allowedHosts: ['fujibjj.smoothcomp.com'] });
  assert.equal(result.ok, false);
});

test('classifyUrl still applies the excluded-path and event-detail-shape rules on an alias host, exactly as on the bare domain', () => {
  const scoreboard = classifyUrl('https://fujibjj.smoothcomp.com/en/event/900001/scoreboard', { allowedHosts: ['fujibjj.smoothcomp.com'] });
  assert.equal(scoreboard.ok, false);
  assert.match(scoreboard.reason, /scoreboard/);
});

test('pathAllowed judges a path against the specific alias host it will really be fetched from', () => {
  const onAlias = pathAllowed('/en/event/900001', { host: 'fujibjj.smoothcomp.com' });
  assert.equal(onAlias.ok, true);
  assert.equal(onAlias.url.hostname, 'fujibjj.smoothcomp.com');
  // No host argument still defaults to SOURCE_HOST, unchanged.
  const onBareDomain = pathAllowed('/en/event/900001');
  assert.equal(onBareDomain.url.hostname, SOURCE_HOST);
});

test('parseListingPage keeps links across every active alias when the full list is passed', () => {
  const html = `
    <a href="https://fujibjj.smoothcomp.com/en/event/900001/fixture-a">A</a>
    <a href="https://classiccombat.smoothcomp.com/en/event/900002/fixture-b">B</a>
    <a href="https://not-yet-reviewed.smoothcomp.com/en/event/900003/fixture-c">C (not an active alias)</a>
  `;
  const { eventUrls, dropped } = parseListingPage(html, {
    url: 'https://fujibjj.smoothcomp.com/en/events',
    allowedHosts: ['fujibjj.smoothcomp.com', 'classiccombat.smoothcomp.com'],
  });
  assert.deepEqual(eventUrls, [
    'https://fujibjj.smoothcomp.com/en/event/900001/fixture-a',
    'https://classiccombat.smoothcomp.com/en/event/900002/fixture-b',
  ]);
  assert.equal(dropped.length, 1);
  assert.match(dropped[0].reason, /not on/);
});

test('toDraftRow records the REAL alias hostname the page was fetched from, not the bare SOURCE_HOST', () => {
  const url = 'https://fujibjj.smoothcomp.com/en/event/900001/fixture-open-2027';
  const parsed = parseEventPage(fixture('complete-event.html'), { url });
  assert.equal(parsed.ok, true);
  const row = toDraftRow(parsed.event);
  assert.equal(row.source_host, 'fujibjj.smoothcomp.com', 'a row crawled from an alias must say so, not claim to be from smoothcomp.com');
});
