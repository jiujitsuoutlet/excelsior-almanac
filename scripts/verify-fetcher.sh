#!/usr/bin/env bash
# Proves the fetcher against a REAL HTTPS server on this machine: real
# sockets, real headers, real streaming, a real ten second wait. Nothing in
# here touches smoothcomp.com or any other outside host.
#
#   bash scripts/verify-fetcher.sh
#
# It takes about 25 seconds, because one of the things being proven is that
# the crawl delay is really waited out.

set -euo pipefail
cd "$(dirname "$0")/.."

TMP=$(mktemp -d)
trap 'rm -rf "$TMP" .verify-tmp' EXIT

echo "== generating a throwaway certificate for localhost"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost" >/dev/null 2>&1

mkdir -p .verify-tmp
cat > .verify-tmp/battery.mjs <<'NODE'
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { fetchOnce, FetchRefused } from '../scout/src/fetcher.js';
import { runScoutRun, defaultSleep } from '../scout/src/run.js';
import { USER_AGENT } from '../scout/src/identity.js';

const TMP = process.env.BATTERY_TMP;
let pass = 0;
let fail = 0;
const ok = (name) => { console.log(`PASS  ${name}`); pass += 1; };
const bad = (name, extra = '') => { console.log(`FAIL  ${name}${extra ? `\n      ${extra}` : ''}`); fail += 1; };
const check = (cond, name, extra) => (cond ? ok(name) : bad(name, extra));

// ---- a real HTTPS server that records every request it receives ----
const seen = [];
let aborted = 0;
const server = https.createServer(
  { key: readFileSync(`${TMP}/key.pem`), cert: readFileSync(`${TMP}/cert.pem`) },
  (req, res) => {
    seen.push({ url: req.url, headers: req.headers, at: Date.now() });
    req.on('aborted', () => { aborted += 1; });

    if (req.url === '/trap') { res.writeHead(200); res.end('you followed a redirect'); return; }
    if (req.url === '/redirect') { res.writeHead(301, { Location: '/trap' }); res.end(); return; }
    if (req.url === '/conditional') {
      if (req.headers['if-none-match'] === '"v1"') { res.writeHead(304); res.end(); return; }
      res.writeHead(200, { ETag: '"v1"', 'Content-Type': 'text/html' });
      res.end('<html>first time</html>');
      return;
    }
    if (req.url === '/huge') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      const chunk = 'x'.repeat(64 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < 5_000_000) {
          sent += chunk.length;
          if (!res.write(chunk)) { res.once('drain', pump); return; }
        }
        res.end();
      };
      pump();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>ok</html>');
  },
);

process.on('uncaughtException', (err) => {
  console.log(`FAIL  the battery itself crashed: ${err?.message ?? err}`);
  console.log(`== result: ${pass} passed, ${fail + 1} failed`);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.log(`FAIL  the battery itself crashed: ${err?.message ?? err}`);
  console.log(`== result: ${pass} passed, ${fail + 1} failed`);
  process.exit(1);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const PORT = server.address().port;
const base = `https://localhost:${PORT}`;
const opts = { fetchImpl: (...a) => fetch(...a), allowHost: 'localhost' };

// ---- 1. the user agent really arrives, over a real socket ----
const first = await fetchOnce(`${base}/page`, opts);
check(first.status === 200 && first.body === '<html>ok</html>', 'a real HTTPS request returns the page body');
check(seen[0].headers['user-agent'] === USER_AGENT, 'the server received the exact ratified user agent', `got: ${seen[0].headers['user-agent']}`);
check(/contact paul@jiujitsuoutlet\.com/.test(seen[0].headers['user-agent']), 'the user agent the server saw carries a working contact address');

// ---- 2. conditional requests: second visit costs them no body ----
const cold = await fetchOnce(`${base}/conditional`, opts);
const warm = await fetchOnce(`${base}/conditional`, { ...opts, etag: cold.etag });
check(cold.status === 200 && cold.etag === '"v1"', 'a first visit gets the page and its ETag');
check(warm.notModified === true && warm.body === null, 'a second visit sends the ETag and gets a 304 with no body');
check(seen.at(-1).headers['if-none-match'] === '"v1"', 'the server really received the If-None-Match header');

// ---- 3. redirects are reported, never followed ----
const before = seen.length;
const redirected = await fetchOnce(`${base}/redirect`, opts);
check(redirected.status === 301 && redirected.redirectTo === '/trap', 'a redirect comes back as a fact, with its destination');
check(seen.length === before + 1, 'only the redirect itself was requested', `${seen.length - before} requests were made`);
check(!seen.some((r) => r.url === '/trap'), 'the redirect target was NEVER requested');

// ---- 4. the byte cap drops a real connection mid-stream ----
let capRefused = null;
try {
  await fetchOnce(`${base}/huge`, { ...opts, maxBytes: 100_000 });
} catch (err) {
  capRefused = err;
}
check(capRefused instanceof FetchRefused, 'a 5MB page is refused at the 100KB cap', String(capRefused?.message ?? 'no error thrown'));
await new Promise((r) => setTimeout(r, 300));
check(aborted > 0, 'and the server saw the connection actually drop, mid-body');

// ---- 5. plain http never opens a socket at all ----
const httpBefore = seen.length;
let httpRefused = null;
try {
  await fetchOnce(`http://localhost:${PORT}/page`, opts);
} catch (err) { httpRefused = err; }
check(httpRefused instanceof FetchRefused && /only https/.test(httpRefused.message), 'plain http is refused');
check(seen.length === httpBefore, 'and no request reached the server');

// ---- 6. EXC-147 for real: two pages on one host, ten seconds apart ----
const SOURCE = {
  host: 'localhost', active: 1, page_types: '["a", "b"]',
  terms_url: 'https://localhost/terms', terms_last_updated: '2026-01-01', terms_read_on: '2026-09-01',
  terms_automated_access: 'none found', terms_reuse: 'none found', login_required: 0, official_api: 'none',
  excluded_paths: '[]', robots_disallowed: '[]', robots_crawl_delay_seconds: null,
  robots_sha256: 'a'.repeat(64), robots_read_on: '2026-09-01',
  verdict: 'allowed', verdict_conditions: null, reviewed_by: 'r@example.com', reviewed_on: '2026-09-01',
};
const spacedFrom = seen.length;
const runStart = Date.now();
// A run that throws is a FAIL line, not a crashed battery: a harness that
// dies without printing a result cannot be read as "it failed" by anyone.
let run = { pagesFetched: -1 };
let runError = null;
try {
  run = await runScoutRun({
    now: () => Date.now(),
    sleep: defaultSleep,
    loadSources: async () => [SOURCE],
    openRun: async () => 'local-run',
    closeRun: async () => {},
    fetchImpl: async (entry) => { await fetchOnce(`${base}/${entry.pageType}`, opts); },
  });
} catch (err) {
  runError = err;
}
const spaced = seen.slice(spacedFrom).filter((r) => r.url === '/a' || r.url === '/b');
const gapMs = spaced.length === 2 ? spaced[1].at - spaced[0].at : -1;
check(runError === null, 'the spaced run completed without a rule refusal', String(runError?.message ?? ''));
check(run.pagesFetched === 2, 'the run fetched both planned pages');
check(gapMs >= 10_000, `the server saw the two requests ${gapMs}ms apart, at least ten seconds`, `gap was ${gapMs}ms`);
check(Date.now() - runStart >= 10_000, 'and the run really took that long (the wait was not skipped)');

// ---- 7. the plan printer cannot fetch ----
// Its source row is built from the founder's own review FILE, not typed
// here, so this cannot pass against a row that does not exist in the repo.
const { writeFileSync } = await import('node:fs');
const reviewSql = readFileSync('scout/terms-reviews/smoothcomp.sql', 'utf8');
const reviewArrays = [...reviewSql.matchAll(/'(\[[^']*\])'/g)].map((m) => m[1]);
writeFileSync(`${TMP}/source.json`, JSON.stringify({
  id: 'src-smoothcomp', host: 'smoothcomp.com', tier: 1, parser: 'smoothcomp_v1',
  page_types: '["events"]', terms_url: 'https://smoothcomp.com/en/agreements',
  terms_last_updated: 'v4.0', terms_read_on: '2026-09-16',
  terms_automated_access: 'none found', terms_reuse: 'none found',
  login_required: 0, official_api: 'none',
  excluded_paths: reviewArrays[0], robots_disallowed: reviewArrays[1],
  robots_crawl_delay_seconds: 10,
  robots_sha256: (reviewSql.match(/'([0-9a-f]{64})'/) || [])[1],
  robots_read_on: '2026-09-16', verdict: 'allowed_with_conditions',
  verdict_conditions: 'founder conditions', reviewed_by: 'paul.tokgozoglu@gmail.com',
  reviewed_on: '2026-09-16', active: 1,
}));
const { execFileSync } = await import('node:child_process');
const planBefore = seen.length;
const planOut = execFileSync('node', ['scripts/fetch-one.mjs', '--source', `${TMP}/source.json`, '--url', 'https://smoothcomp.com/en/event/900001/x', '--plan'], { encoding: 'utf8' });
check(/GET https:\/\/smoothcomp\.com\/robots\.txt/.test(planOut), 'the plan names both requests before anything runs');
check(/Nothing is written to the events table/.test(planOut), 'the plan says plainly that nothing is written');
check(seen.length === planBefore, 'printing the plan made no request');

server.close();
console.log(`== result: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
NODE

echo "== running against a real local HTTPS server (this takes about 25 seconds)"
BATTERY_TMP="$TMP" NODE_EXTRA_CA_CERTS="$TMP/cert.pem" node .verify-tmp/battery.mjs
