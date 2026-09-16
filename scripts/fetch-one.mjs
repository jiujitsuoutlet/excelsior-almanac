// One page, by hand, on the founder's word. Called by scripts/fetch-one.sh;
// not meant to be run directly.
//
// Two modes:
//   --plan  prints exactly what would be requested. Provably networkless:
//           the global fetch is replaced with a thrower before anything runs.
//   --go    actually makes the requests, in this order:
//             1. https://<host>/robots.txt
//             2. wait the crawl delay (at least ten seconds)
//             3. the one event page named on the command line
//
// It writes NOTHING to any events table. Its only output is on your screen.
// The crawl_runs audit row is written by the shell script around it.

import { readFileSync } from 'node:fs';
import { checkSource } from '../scout/src/gate.js';
import { classifyUrl, pathAllowed, parseEventPage, toDraftRow } from '../scout/src/parsers/smoothcomp.js';
import { fetchOnce, fetchRobots, sha256Hex } from '../scout/src/fetcher.js';
import { parseRobots, isAllowed, crawlDelayFor, classifyRobotsFetch } from '../scout/src/robots.js';
import { minIntervalSeconds } from '../scout/src/limiter.js';
import { USER_AGENT, ROBOTS_TOKEN } from '../scout/src/identity.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1];
};
const MODE = args.includes('--go') ? 'go' : 'plan';
const SOURCE_FILE = flag('--source');
const URL_ARG = flag('--url');

// In --plan mode nothing may touch the network, and that is enforced, not
// promised: the global fetch is replaced with something that throws.
if (MODE === 'plan') {
  globalThis.fetch = () => { throw new Error('--plan must never fetch'); };
}

const stop = (message, detail = '') => {
  console.log(`\nSTOP: ${message}`);
  if (detail) console.log(detail);
  process.exit(3);
};

if (!SOURCE_FILE || !URL_ARG) stop('called without a source row or a URL (use scripts/fetch-one.sh)');

const source = JSON.parse(readFileSync(SOURCE_FILE, 'utf8'));

// ---- gate: the same check the runner uses, no copy of it here ----
const gate = checkSource(source);
if (!gate.allowed) stop(`the terms review gate refuses ${source?.host ?? 'this source'}`, gate.reason);

// ---- the URL must be an event detail page on that host ----
const verdict = classifyUrl(URL_ARG);
if (!verdict.ok) stop(`that URL will not be fetched: ${verdict.reason}`, `  ${URL_ARG}`);
const target = verdict.url.toString();
const host = source.host;
const interval = minIntervalSeconds(source.robots_crawl_delay_seconds);

if (MODE === 'plan') {
  console.log(`Host:            ${host} (source row "${source.id}", reviewed ${source.reviewed_on} by ${source.reviewed_by})`);
  console.log(`Verdict:         ${source.verdict}`);
  console.log(`Crawl delay:     ${interval} seconds between the two requests below`);
  console.log(`User agent:      ${USER_AGENT}`);
  console.log('');
  console.log('Two requests will be made, in this order, and no others:');
  console.log(`  1. GET https://${host}/robots.txt`);
  console.log(`  2. GET ${target}`);
  console.log('');
  console.log(`In Smoothcomp's own access log, those two lines will look like this (their clock, their format):`);
  console.log(`  <our ip> - - [date] "GET /robots.txt HTTP/1.1" 200 <bytes> "-" "${USER_AGENT}"`);
  console.log(`  <our ip> - - [date+${interval}s] "GET ${verdict.url.pathname} HTTP/1.1" 200 <bytes> "-" "${USER_AGENT}"`);
  console.log('');
  console.log('Before the second request, robots.txt is checked two ways:');
  console.log(`  - its SHA-256 against the one recorded in the review (${String(source.robots_sha256).slice(0, 16)}...)`);
  console.log(`  - whether it still allows ${verdict.url.pathname} for ${ROBOTS_TOKEN}`);
  console.log('If either fails, the run stops and the page is never requested.');
  console.log('');
  console.log('Nothing is written to the events table. Nothing is stored from the page body.');
  process.exit(0);
}

// ---- go ----
const t0 = Date.now();
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

console.log(`[1/2] GET https://${host}/robots.txt`);
const robotsResponse = await fetchRobots(host, { fetchImpl: (...a) => fetch(...a), allowHost: host });
console.log(`      ${robotsResponse.status} ${robotsResponse.contentType ?? ''} ${robotsResponse.bytes} bytes in ${robotsResponse.elapsedMs}ms`);

const disposition = classifyRobotsFetch(robotsResponse.status);
if (disposition === 'skip_host') {
  stop(`robots.txt answered ${robotsResponse.status}; this host is skipped until it answers normally`);
}
if (disposition === 'allow_all') {
  stop('robots.txt is missing (404). The review recorded a hash for a file that existed; that is a change, so this stops for a human.');
}

const liveHash = await sha256Hex(robotsResponse.body);
const recordedHash = String(source.robots_sha256 ?? '');
console.log(`      sha256 ${liveHash}`);
if (liveHash !== recordedHash) {
  stop(
    'robots.txt has changed since the founder read it. The terms review describes a file that no longer exists, so it cannot authorise this fetch.',
    `      recorded: ${recordedHash}\n      live:     ${liveHash}\n      Re-read robots.txt, update the review, then try again.`,
  );
}
console.log('      unchanged since the review ... good');

const rules = parseRobots(robotsResponse.body);
if (!isAllowed(rules, verdict.url.pathname, ROBOTS_TOKEN)) {
  stop(`robots.txt disallows ${verdict.url.pathname} for ${ROBOTS_TOKEN}`);
}
const declaredDelay = crawlDelayFor(rules, ROBOTS_TOKEN);
const waitSeconds = minIntervalSeconds(declaredDelay ?? source.robots_crawl_delay_seconds);
console.log(`      allows ${verdict.url.pathname} ... good`);

console.log(`\n      waiting ${waitSeconds} seconds before the second request (the crawl delay)`);
const dueAt = Date.now() + waitSeconds * 1000;
await sleep(waitSeconds * 1000);
const early = dueAt - Date.now();
if (early > 0) stop(`refusing to fetch ${early}ms early; the crawl delay is the condition this source was reviewed under`);

console.log(`\n[2/2] GET ${target}`);
const page = await fetchOnce(target, { fetchImpl: (...a) => fetch(...a), allowHost: host, pathAllowed });
console.log(`      ${page.status} ${page.contentType ?? ''} ${page.bytes} bytes in ${page.elapsedMs}ms`);
if (page.redirectTo) {
  stop(`that URL redirects to ${page.redirectTo}, and redirects are never followed`, '      Open it in a browser, and pass the address it lands on.');
}
if (page.status !== 200) {
  stop(`the page answered ${page.status}, so there is nothing to read`);
}
if (page.etag) console.log(`      ETag: ${page.etag} (a repeat visit would send this and cost them a 304)`);

console.log(`\n---- what the parser made of it ----`);
const parsed = parseEventPage(page.body, { url: target });
if (!parsed.ok) {
  console.log(`REJECTED: ${parsed.reason}`);
  console.log('\nThat is a real answer, not a failure of the run: the parser refused to');
  console.log('half-build a row. The page structure does not match what it expects.');
} else {
  const row = toDraftRow(parsed.event);
  const show = (label, value) => console.log(`  ${label.padEnd(22)} ${value === null || value === undefined || value === '' ? '(empty)' : value}`);
  show('name', row.name);
  show('organizer', row.organizer_name);
  show('start date', row.start_date);
  show('end date', row.end_date);
  show('venue', row.venue_name);
  show('address', row.address);
  show('city', row.city);
  show('state', row.state);
  show('country', row.country);
  show('registration link', row.registration_url);
  show('registration closes', row.registration_deadline);
  show('gi / nogi / kids', `${row.gi} / ${row.nogi} / ${row.kids}`);
  show('their event id', row.source_event_ref);
  if (parsed.warnings?.length) {
    console.log('\n  warnings:');
    for (const w of parsed.warnings) console.log(`    - ${w}`);
  }
  console.log(`\n  status would be:      draft (nothing here approves anything)`);
}

console.log(`\n---- end. ${Math.round((Date.now() - t0) / 1000)}s, 2 requests, 0 rows written to events. ----`);
console.log(JSON.stringify({ pagesFetched: 2, parsed: parsed.ok }), '');
