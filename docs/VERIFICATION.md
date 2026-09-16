# Verification law for this lane

## The standing rule (founder, 2026-09-15)

**Before reporting that a battery passed, state what shapes it does NOT cover.**

A passing count means nothing on its own. It says "the cases I thought of
behaved as I expected", not "this works". The founder's single hand-entered
row found a bug that a 15-test walkthrough missed, because every row those
tests entered had the same shape: a complete one.

So every report of a battery carries two parts:

1. The count, and what each part proves.
2. The shapes the battery never exercised, listed plainly.

A gap list is not an apology. It is the map of where the next bug lives, and
it is what tells the founder whether a pass is worth trusting yet.

Related laws already in force here: a refusal is the proof (a rule is proven
by watching it refuse, not by an admin succeeding), and a metric that cannot
fail gets rewritten, not reported.

## The hand-copy law (founder, 2026-09-16)

**Wherever a hand-written list mirrors what the system actually does, that is
where the next false pass hides.**

Three times in this build a test was checking an assumption rather than the
code, and every one had the same shape ... something typed by hand standing
in for something the system does:

1. The scout gate's ten-field list was a hand copy of the database's own
   CHECK constraint. Fixed by reading the constraint out of the migration
   (`scout/test/gate-drift.test.js`).
2. That drift test's own identifier pattern was hand-written as `[a-z_]+`,
   which could not see `robots_sha256`, so it reported a disagreement that
   did not exist.
3. The parser battery built its database inserts from a hand-typed column
   list, so a parser that approved its own rows still scored 18 of 18.

The rule that follows: when two places describe one rule, one of them must
READ the other. Where that is impossible (the terms review records prose a
machine cannot turn into a URL), say so in the gap list and prove the
opposite guarantee instead ... a narrow allow-list refuses everything nobody
thought to name.

Live examples of the law in force: `scout/test/gate-drift.test.js` reads the
migration, `scout/test/terms-drift.test.js` reads the founder's own terms
review file, `scripts/verify-parser.sh` builds inserts from the parser's
returned keys, and `smoothcomp.js` exports one `classifyUrl` that both the
listing parser and the fetcher call, so there is one exclusion list rather
than two.

## What each battery covers, and what it does not

### `npm run test:unit` (127 tests: 18 console, 109 scout)

This command now runs both `console/test/` and `scout/test/`. The console
half covers: the approval gate, chips, blockers, the count headline,
duplicate resolution, input validation, Access token verification against a
real RSA key, the dev identity guard, and database-error wording. See the
scout section below for the other 109 (71 skeleton, 17 the smoothcomp.com
Tier 1 parser).

Does not cover:
- Any real database. These are pure functions.
- The real Cloudflare Access service, its key rotation or its cookies.
- Anything about venues, venue sessions or scout-created rows.

### `npm run verify:schema:local` / `:staging` (54 local, 58 staging)

Covers, for events: the one status path, append-only logs, draft-only inserts,
the approved-content lock, automatic approval staying off, terms review before
a source is crawlable, no hard deletes, and the SQLite REPLACE paths.

Does not cover:
- **Venues and venue sessions end to end.** They get the transition rules and
  foreign keys, not a full lifecycle or content lock.
- **Per-type extension tables** beyond one wrong-type refusal.
- **`coverage_requests` and `crawl_runs`:** created, never exercised.
- **A complete `sources` row:** only the refusal to activate without a review.
- **Two writers at once.** No concurrency or race testing anywhere yet.
- **Scale.** Every test runs on a handful of rows.

### `npm run verify:console` (46 tests)

Covers: the queue and its headline, hand entry and its validation, the
Shift+A gate both ways, the registration-link blocker, reject reasons, undo
across the last five, duplicates (distinct and merge), edit, cross-site
refusals, non-reviewers, production refusing the local dev identity and a
forged token, and a database with no marker refusing writes.

Does not cover:
- **Scout-created rows (Tier 1 and Tier 2).** Every row is a Tier 3 hand entry.
  Green chips are simulated by inserting signals with SQL; no link checker or
  grounding check exists yet to produce real ones.
- **Venues, venue sessions and Session Times.** The console handles events only.
- **A real Cloudflare Access sign-in.** Only a forged token is tested.
- **Two reviewers at once**, including undo after someone else acted on a row.
- **Geocoding.** No OpenCage key is configured, so every row saves ungeocoded.
- **The multi-candidate merge picker.** Merge is tested with one candidate.
- **Every editable field.** Edit is tested on name, date, registration link,
  city and organizer.
- **Abuse and rate limits.** No fault injection beyond a stalled save.
- **Large queues.** Twelve rows is the largest tested.

### `node scripts/console-walkthrough.mjs local|staging` (38 local, 29 staging)

Covers, by real keyboard in Chromium at 720 px: the badge from the database
marker, the count headline, hand entry, the blocker, plain A refused, Caps
Lock not approving, Shift+A, undo, reject, the source window opening and
following J, a hostile source page failing to move the console, and the edit
paths: Enter from a field the test did not fill, the Save button by mouse, Esc
warning before discarding, keeping the typing when the warning is dismissed,
and a save whose answer never arrives reporting itself within 15 seconds.

Does not cover:
- **Any browser but Chromium**, any width but 720 px, and no phone or tablet.
- **Real third-party source pages.** Every source is a stub; no framing
  refusal, no slow page, no redirect chain.
- **Pop-ups being blocked.** The test browser allows them.
- **The clipboard key (F)**, the help overlay, skip, previous (K), and the
  multi-candidate merge picker.
- **Mouse-only use.** Only the Save and Cancel buttons are clicked; every other
  action is keyboard. Someone who never learns the keys is still untested.
- **Accessibility**: no screen reader, keyboard-trap or contrast testing.
- **Rendering a large queue.**

### Scout skeleton: `npm run test:unit` (71 of the 127 tests) and `bash scripts/verify-scout.sh` (12 checks)

The skeleton is the machinery around a fetch, not the fetch itself: a
robots.txt parser and matcher (`robots.js`), a per-host rate limiter
(`limiter.js`), the terms-review gate (`gate.js`), a plan builder
(`queue.js`), and a runner (`run.js`). The runner's fetch function is always
injected and never defaults; the Worker in `index.js` still wires up
`disabledFetch`, which throws, and no Cron Trigger calls it. The real
fetcher lives in `fetcher.js` and has its own section below.

Covers, in `scout/test/` (71 tests, pure functions, no database and no
network):
- **identity.js:** the exact ratified user agent string, and that the
  robots-matching token is a case-insensitive prefix of it.
- **gate-drift:** `gate-drift.test.js` reads the ten-field CHECK constraint
  out of `migrations/20260915000100_core_schema.sql` and fails when it and
  `gate.js`'s own field list disagree in either direction (see "Does not
  cover" below: this gap is closed).
- **robots.js:** user-agent groups (including a repeated group for the same
  agent, which merges rather than shadows), longest-match Allow/Disallow with
  the Allow tie-break, Crawl-delay per group (longest wins on disagreement),
  Sitemap lines anywhere in the file, a Disallow that names a different agent
  not applying to ours, and malformed or empty input degrading to "no rules"
  instead of throwing.
- **limiter.js:** the 10-second floor with no declared Crawl-delay, a
  Crawl-delay longer than 10 seconds winning, spacing across repeated calls,
  independence between hosts, and that `recordFetch` never mutates its input.
- **gate.js:** every one of the ten terms-review fields refused on its own
  with its own distinguishable reason, a disallowing verdict, a login
  requirement, `allowed_with_conditions` with and without its conditions
  text, an unrecognized verdict string, and a fully complete review that is
  simply not marked active yet.
- **queue.js:** a refused host never appearing in the plan, per-host page
  spacing (including a longer Crawl-delay), the per-host page cap, two hosts
  scheduled independently, unreadable `page_types` producing no pages without
  being treated as a gate refusal, and limiter state carried in from a prior
  run.
- **run.js:** `runScoutRun` refuses to start without an injected `fetchImpl`
  (there is no default, and the default is never the real `fetch`); the
  fetcher is never called when every host is gated; an allowed host reaches
  the fetcher, which throws, failing the run loudly with the error counted;
  the run opens before reading sources and closes exactly once with final
  counts; and a run with no sources at all still opens and closes cleanly.

Covers, in `bash scripts/verify-scout.sh` (12 checks, against a throwaway
local D1 with real `sources` rows, plus one real Worker run through
`scout/src/index.js` via `wrangler dev --test-scheduled`): the same four gate
refusal/admission scenarios read back from real database rows instead of
hand-built objects, an explicit proof that the injected fetcher's call count
stayed 0 while the gate and the plan were built, and a real `crawl_runs` row
showing the run failed, with the three skipped hosts counted, zero pages
actually fetched, and the one attempted fetch counted as an error.

Does not cover:
- **A real fetch, of anything, ever.** That is deliberate: this skeleton's
  fetcher always throws. Nothing here proves what a successful fetch, a
  Tier 1 parse, or a draft row being created would look like, because none
  of that exists yet.
- **robots.txt wildcards.** `*` and `$` in an Allow or Disallow path are not
  interpreted; matching is literal-prefix only. A real site's robots.txt
  that relies on wildcards will not be matched correctly yet.
- **The runner honoring `scheduledAt`.** `queue.js` computes a spaced
  schedule for each planned page, but `run.js` does not wait for it; it
  walks the plan immediately. This does not matter while the fetcher always
  throws. **FOUNDER FLAG: the day a real fetcher is wired in, this stops
  being harmless and must be fixed in that same pull request, before it
  runs.** Tracked as EXC-147.
- **Limiter state across runs.** Nothing persists `limiterState` between one
  scheduled run and the next, so the "one request per host per 10 seconds"
  guarantee is enforced only within a single run, not across the boundary
  between two runs.
- **`classifyRobotsFetch` wired into anything.** It is unit-tested on its
  own, but nothing in `gate.js`, `queue.js` or `run.js` calls it yet, because
  nothing fetches a real robots.txt yet.
- **Multiple simultaneous defects on one source.** `checkSource` returns the
  first reason it finds, in a fixed order; a row missing three fields and
  requiring a login is only ever reported for the first thing wrong with it,
  never the full list.
- ~~Drift between `gate.js` and the database's CHECK constraint~~ **CLOSED
  2026-09-16** (founder ruling: this gap is the exact shape of both bugs he
  found by hand, two rules that must agree with nothing checking).
  `scout/test/gate-drift.test.js` reads the constraint out of the migration
  and fails when the two lists diverge in either direction. It carries its
  own proof that it can fail, and was run with a field removed from the gate
  to watch it fail for real.
- **Real-world robots.txt files.** Every fixture in `robots.test.js` is
  hand-written and small; nothing here has been run against an actual
  site's robots.txt.
- **Scale.** The largest plan built anywhere in these batteries has one page
  on one host. A `sources` table with hundreds of rows, or a host with
  hundreds of page types, is untested.
- **Two runs, or two Workers, at once.** No concurrency test exists for the
  runner or for `crawl_runs`.
- **The Cron Trigger itself.** `scheduled()` is only ever invoked locally,
  through `wrangler dev --test-scheduled`. Real Cron Trigger behavior
  (retry-on-failure, CPU limits, overlap with a still-running previous
  invocation) is untested because nothing is deployed and no trigger is
  configured.
- **`env.SCOUT_ENABLED` in a real environment.** The battery sets it to
  `"true"` on the command line to exercise the runner; no checked-in
  configuration sets it anywhere, and turning it on for real is the
  founder-gated step this skeleton explicitly does not take.

### Tier 1 parser: smoothcomp.com (`npm run test:unit`, 17 of the 127 tests) and `bash scripts/verify-parser.sh` (18 checks)

This is the first Tier 1 parser (ARCHITECTURE.md section 5): a pure,
deterministic parser for smoothcomp.com only (`scout/src/parsers/
smoothcomp.js`), registered under the name `smoothcomp_v1` in
`scout/src/parsers/index.js`. It still fetches nothing. Every fixture it
runs against is hand-written synthetic HTML with invented names, dates,
venues and ids ("Fixture Open", "Testburg"). None of it is a saved real
Smoothcomp page, and **nothing here proves the parser works against the
live site. That is the founder's one hand-run, later.**

Covers, in `scout/test/parsers/` (17 tests, pure functions, no database and
no network):
- A complete event page: every field extracted correctly from a JSON-LD
  block plus the event-meta attributes, including gi/nogi/kids flags, the
  registration link, the deadline, and the host's own event id read from
  the URL.
- `toDraftRow`: the shaped row carries `source_tier: 1`,
  `source_host: 'smoothcomp.com'`, and a `dedupe_key` built by the
  console's own `dedupeKey` (imported, not reimplemented); it never has the
  vocabulary to set `status`, `approved_by`, `approved_at` or
  `approval_rule`.
- A page missing the registration link: still `ok: true`, with a warning,
  since the console blocks approval on a missing link later, not the parser.
- A page missing a required field (city): `ok: false` with a plain-English
  reason naming the field, never a half-built row.
- A date range across two days: both start and end fill correctly.
- An impossible date (2027-02-30): rejected with a reason naming the date,
  not silently accepted.
- A listing page with a mix of allowed and excluded links: only the allowed
  event-detail pages survive; every excluded link (order, checkout,
  scoreboard, brackets, results, the registrant-list page, an athlete
  profile, an external host, a `javascript:` link, an unrelated nav link)
  is reported with its own reason; a repeated card for the same event
  contributes one URL, not two.
- A malformed, truncated page: never throws; comes back `ok: false` with a
  reason.
- A page carrying a `<script>` tag and quoted content: the name and venue
  (one holding a literal apostrophe, the other an escaped quote) come
  through JSON.parse intact, and nothing from the script tag or an HTML
  comment leaks into any output field.
- `parseEventPage` refuses to guess without a source URL; neither function
  throws on `null`, `undefined` or empty HTML.
- The parser never touches `fetch`: a patched, counting global stays at
  zero across every fixture above, including the malformed one.
- `toDraftRow` carries no `status`, `approved_by`, `approved_at`,
  `approval_rule` or `published_at` key at all. A parser must never decide
  approval; the database owns that column.

Covers, in `bash scripts/verify-parser.sh` (18 checks, against a throwaway
local D1 with the real `events` schema from `migrations/`):
- The same fixture-to-`ok`/`reject` classification, read back through the
  same parser in a separate process, with its own zeroed fetch counter.
- Every row the parser calls valid is accepted by the database, with no
  CHECK or trigger refusal.
- Every accepted row lands as `status = 'draft'`, `source_tier = 1`,
  `source_host = 'smoothcomp.com'`; nothing in this battery is ever
  approved, or in any status but draft. The insert is built from the keys
  the parser ACTUALLY returns, never from a hardcoded column list, so a
  parser that tried to set its own status is sent to the database as
  written and refused there, loudly. (GAP CLOSED, 2026-09-16: the first
  version of this battery built its inserts from a fixed `COLS` constant,
  which silently dropped any extra key. A parser hardcoded to
  `status: 'approved'` still scored 18 of 18. Proven by breaking it: with
  the same injection the battery now reports 13 passed, 5 failed, and the
  database's own words are "new rows start as draft with no approval:
  SQLITE_CONSTRAINT_TRIGGER".)
- The row count in `events` after insertion is exactly the parser's
  accepted count; the rejected fixtures were never sent to the database at
  all, let alone refused by it.
- Inserting the same accepted candidate a second time (a fresh id, the
  identical `dedupe_key`) is refused by the database's own unique
  constraint ("event already exists; update it instead"), and leaves no
  trace: the row count is unchanged.

Does not cover:
- **The live site.** Every fixture is invented HTML built to match the
  STRUCTURE this parser walks (a JSON-LD `SportsEvent` block plus a small
  set of custom data attributes and an anchor class). Real smoothcomp.com
  markup may not match that structure at all: a different JSON-LD shape,
  no JSON-LD, different class names, or facts laid out in prose instead of
  attributes would all make this parser under-extract or reject pages it
  should accept. Nothing here has been run against a real page, and
  nothing here can stand in for that.
- **`event_type`.** Not among the facts this parser extracts (the source
  pages carry no reliable structured signal for it in the shape assumed
  here); every accepted row is hardcoded to `'tournament'`. A real
  Smoothcomp seminar, camp or superfight page would be misclassified.
- **ISO code correctness.** `state` and `country` are format-validated only
  (length and case), not checked against a real ISO 3166 list. A source
  publishing a garbled but length-matching code would pass.
- **Timezone.** Never extracted; every row inserts with `timezone` left
  NULL.
- **Geocoding.** `lat`, `lon` and `geocode_confidence` are never set here;
  ARCHITECTURE.md assigns that to "geocode on save" in the console.
- **Prose-only facts.** A registration deadline stated only in a sentence,
  never in the `data-registration-deadline` attribute this parser reads,
  comes back as `null`, because this parser never reads prose, by design.
- **Multiple JSON-LD event blocks on one page**, or an array-shaped JSON-LD
  document. The code loops over every block and would take the first
  event-typed one, but no fixture actually exercises more than a single
  object.
- **Unusual malformed shapes.** Only one truncation point is fixtured (mid
  JSON-LD string, before any closing tag). An unterminated `<script>` tag
  around otherwise-valid JSON, a truncation mid multi-byte UTF-8
  character, or a page truncated after the JSON-LD block but before the
  registration anchor are all untested.
- **Link liveness, corroboration, or any `row_signals`.** This PR fetches
  nothing, so whether a `registration_url` this parser extracts actually
  resolves is entirely unverified.
- **`source_event_ref` collisions.** `scripts/verify-parser.sh` proves the
  `dedupe_key` unique constraint; it does not exercise the separate
  `events_source_ref` unique index (two rows naming the same
  `source_host` and `source_event_ref` with different dedupe keys).
- **Venues, venue sessions, `row_signals` and `review_log`.** This parser
  only ever produces `events` rows; nothing here touches the other tables
  `verify-parser.sh` could reach.
- **Wiring into the runner.** `scout/src/parsers/index.js` registers
  `smoothcomp_v1`, but nothing in `queue.js` or `run.js` looks it up yet.
  This PR proves the parser exists and is correct on its fixtures, not
  that it is reachable from an actual (still-disabled) scout run.
- **Scale.** Eight fixtures, one page each. A real nightly run could parse
  hundreds of Smoothcomp pages; nothing here measures throughput, memory,
  or regex behavior on a much larger real page.
- **Anything about the listing page's own URL.** `parseListingPage`
  filters the links it finds; it does not check that the page it was given
  is itself `/en/events`, and it has no concept of pagination (a "next
  page" link is simply dropped as "not an event detail page path",
  correctly but without being surfaced as a page still to crawl).

## When a gap becomes a test

A gap moves onto this list once it is known. It becomes a test when the slice
that needs it arrives (for example, real chips arrive with the Tier 1 scout),
or immediately when a bug is found in it, with the founder's own failing case
as the first test.

### The fetcher and the crawl delay: `npm run test:unit` (32 of the 127 tests) and `bash scripts/verify-fetcher.sh` (20 checks)

This is the first code in the lane that can open a socket to somebody else's
server. `scout/src/fetcher.js` holds every rule the founder's terms review
was granted under, enforced before the request leaves; `scout/src/run.js`
now waits out the crawl delay the plan worked out (EXC-147) and refuses to
fetch early if that wait comes back short.

Covers, in `scout/test/fetcher.test.js` (17 tests, injected fetch, no socket):
- The pinned user agent is sent, the method is GET, and redirects are
  requested in `manual` mode so they are never followed.
- Conditional requests: an ETag or Last-Modified we already hold is sent, a
  304 comes back with no body, and a first visit sends neither header.
- Eight refusals that all happen BEFORE the request leaves, proven by a
  fetcher that throws if it is ever called: plain http, a different host,
  brackets, registrations, athlete profiles, the order flow, a listing page,
  and a string that is not a URL.
- No allowed host means nothing is fetchable; `fetchOnce` refuses to default
  to the global fetch at all.
- A redirect comes back as a fact with its destination, unfollowed.
- A body past the cap throws and cancels the stream; a body under it comes
  back whole with its byte count.
- Non-2xx answers (403, 404, 429, 500, 503) are returned as facts with no
  body, not thrown; a network failure names the URL and is distinguishable
  from one of our own refusals; a hung server is aborted on the timeout.
- robots.txt is fetched at its own path with the same user agent, and is
  still refused on a host the caller did not allow (a real hole found by
  this test: the function used to take its allowed host from its own
  argument, so the one check that mattered was satisfied by the value it was
  meant to check).
- `sha256Hex` against the known SHA-256 of "abc".

Covers, in `scout/test/run.test.js` (4 of its 11 tests, EXC-147):
- Two pages on one host really are spaced ten seconds, measured on a clock
  that only moves when the run sleeps.
- A longer Crawl-delay is waited out in full, not shortened.
- A sleep that returns early is REFUSED: the run aborts, the second page is
  never requested, and the `crawl_runs` row is still closed as failed.
- `defaultSleep` actually sleeps, so the production path is not a no-op.

Covers, in `scout/test/terms-drift.test.js` (4 tests, the hand-copy law):
- The founder's terms review FILE is read, and every path-shaped entry in
  its `excluded_paths` and `robots_disallowed` lists is proven to be refused
  by the code. If someone adds a path to the review and not to the code,
  this fails.
- The allow-list is narrow: fifteen shapes that are not event detail pages
  are each refused, and the two that are allowed pass, so the test can fail
  in both directions.

Covers, in `bash scripts/verify-fetcher.sh` (20 checks, against a REAL local
HTTPS server with a throwaway certificate):
- The exact user agent arrives at a real server, over a real socket.
- A real 304 round trip, with the server confirming it received the
  If-None-Match header.
- A real redirect is not followed: the server never sees the trap URL.
- A 5MB body against a 100KB cap: the refusal fires AND the server observes
  the connection actually drop mid-body.
- Plain http is refused with no request reaching the server.
- The ten-second spacing measured at the SERVER, not by the client: two
  requests, 10,005ms apart, in a run that really took that long.
- The plan printer makes no request at all.

Proven able to fail, by breaking the code on purpose (2026-09-16):
- Wait removed from the runner: 16 passed, 4 failed, with the run refusing
  in its own words ("refusing to fetch localhost 9997ms before its scheduled
  time").
- Redirects followed: 17 passed, 3 failed, including "the redirect target
  was NEVER requested".
- The byte cap no longer dropping the connection: 19 passed, 1 failed, on
  the server-side observation, which is the only check that could catch it.
- The user agent's contact address changed: 19 passed, 1 failed.

Does not cover:
- **smoothcomp.com.** Nothing in this pull request has contacted them. Every
  check above runs against a local server that answers however the test told
  it to. Whether Smoothcomp returns 200 to this user agent, whether their
  robots.txt still hashes to what the review recorded, whether Cloudflare or
  a bot filter sits in front of it, and whether the page carries the JSON-LD
  the parser walks are all unknown until `scripts/fetch-one.sh` is run by
  hand.
- **The battery's user agent equality check is self-referential.** It
  compares what the server received to the same constant the fetcher sent,
  so it proves the header survives the plumbing, not that the string is
  right. The string itself is pinned as a literal in
  `scout/test/identity.test.js`; that is the check that would catch a
  changed user agent.
- **Retries, backoff and 429 handling.** A 429 is returned as a fact and
  nothing acts on it. There is no retry anywhere, which is safe but means a
  transient failure simply loses that page.
- **`Retry-After`.** Never read.
- **Conditional-request storage.** The fetcher sends an ETag when the caller
  hands it one, but nothing persists ETags between runs yet, so in practice
  every visit is currently a cold one.
- **The crawl delay ACROSS runs.** `queue.js` accepts carried-forward
  limiter state, but nothing stores it, so two runs started a second apart
  would each think the host is untouched.
- **Redirect handling beyond refusing to follow.** A moved page is simply
  lost; no one is told.
- **Compression, character sets and non-UTF-8 pages.** The body is decoded
  as UTF-8 unconditionally.
- **IPv6, proxies, TLS failures against a real certificate authority, and
  DNS failure modes.** The local server uses a certificate generated for the
  test.
- **Cloudflare Workers.** Every one of these runs under Node on a Mac. The
  scout Worker is still wired to `disabledFetch`, and nothing has run this
  code in the Workers runtime.
- **Concurrency.** One request at a time, one host, one process. Two runs at
  once would not see each other's spacing.
- **`scripts/fetch-one.sh` end to end.** Its plan mode is exercised by the
  battery; the `--go` path has never been run, because running it is a
  founder decision and it touches a real outside host.
