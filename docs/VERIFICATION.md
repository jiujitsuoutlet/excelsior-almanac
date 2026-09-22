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

Four times in this build a test was checking an assumption rather than the
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
4. `almanac-ingest` (`jiujitsuoutlet/excelsior-master`) validated and
   upserted a row by a field it called `row.id`. `payload.js`'s real wire
   format has no `id` field ... it sends `almanac_id`, matching the app's
   own column name. Every publish cycle for a full night was refused
   (`400 invalid_row: missing id`), never landing, never alerting anyone,
   because nothing had ever sent the app function `payload.js`'s ACTUAL
   output... every prior review and test checked a hand-written stand-in
   payload against the app function, or checked `payload.js` in isolation
   against fakes, never the two for real, against each other. Fixed by
   `row.id` → `row.almanac_id` at all five sites (`almanac-ingest/index.ts`
   lines 48, 50, 54, 57, 60, 140 ... line 140 mattered most: the upsert
   mapping itself, which would have written `almanac_id: undefined` into
   every accepted row even past validation, corrupting the exact conflict
   target the whole pipe upserts by).

The rule that follows: when two places describe one rule, one of them must
READ the other. Where that is impossible (the terms review records prose a
machine cannot turn into a URL), say so in the gap list and prove the
opposite guarantee instead ... a narrow allow-list refuses everything nobody
thought to name.

Instance 4 is a variant worth naming on its own: the two sides that had to
agree live in separate repositories that deliberately do not import each
other's code (ARCHITECTURE.md Section 11 ... "mirrored, not shared code").
"One must read the other" cannot mean a source import here. It means a test
that makes the real call: `publisher/test/app-contract.integration.mjs`
imports `payload.js`'s real `buildBatch`/`canonicalize`, signs the result
with the real shared secret, and POSTs it to the real deployed
`almanac-ingest` URL, asserting a 2xx. That live round trip is the only
thing that can "read" both sides of a contract that spans two repos on
purpose. Proven able to fail before it was trusted to pass, same standard
as every other break test here: run against the still-broken deployed
function first (`400`, exit 1), then again after the fix was deployed
(`200 {"applied":1}`, exit 0) ... both transcripts kept, 2026-09-17.

Live examples of the law in force: `scout/test/gate-drift.test.js` reads the
migration, `scout/test/terms-drift.test.js` reads the founder's own terms
review file, `scripts/verify-parser.sh` builds inserts from the parser's
returned keys, `smoothcomp.js` exports one `classifyUrl` that both the
listing parser and the fetcher call, so there is one exclusion list rather
than two, and `publisher/test/app-contract.integration.mjs` reads the real
app contract over the wire, the only channel two repos that share no code
actually agree through.

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

## The Phase 2 ground-truth count: a worked case for the approval queue (2026-09-16)

Building the organizer registry and the twelve-month event count surfaced four
real defect shapes, none of them from code, all of them from trusting a single
source. They are recorded here as the worked case for what the approval
console's own reviewer needs to be able to see, because the same shapes will
recur in every future crawl.

1. **A moved date, old listing never retracted.** Submission Challenge Branson
   moved from June 6 to August 29, 2026; a Facebook event ID and a
   bjjcompfinder slug still carry the June date. Submission Challenge
   Arkansas moved from July 11 to August 22, 2026, same pattern. Nothing
   marks the old page as wrong; it just sits there, indexed, alongside the
   right one. A crawl that trusts the first date it finds ships a wrong one.
2. **Three independent-source date conflicts, genuinely unresolved by
   reading further.** IBJJF Kansas City 2025 (Nov 9 vs. a since-pruned page),
   AGF's 2025 US Open Tulsa (Dec 13 vs. Dec 20), and AGF's 2026 Oklahoma City
   Open (Sept 12-13 vs. Sept 19-20, which decides whether the event falls
   inside or outside a stated twelve-month window). No amount of additional
   reading resolved these; two sources simply disagree. This is exactly what
   `date_conflicted` (ARCHITECTURE.md Section 6) exists to surface rather
   than paper over with a guess.
3. **A city label that is wrong by one governmental boundary.** A "Grappling
   Industries Kansas City" listing is, on its own venue address, in Olathe,
   Kansas... a real place, a real event, the wrong state for anyone
   filtering by Missouri. A city-name match is not a location; only a
   geocoded coordinate against the venue address catches this.
4. **An aggregator's own machine-readable field disagreeing with its own
   human-readable field, five separate times.** bjjcompfinder's URL slug
   (built from one date) and its displayed event date (a possibly later
   correction) disagreed on five different tournament pages during this
   count. A parser that trusts the slug and a parser that trusts the
   displayed text will produce two different databases from the same page.

**What this proves about the review queue, not just about these four
events:** a reviewer needs to see the conflicting values and their sources
side by side, never a single resolved-looking date with the disagreement
silently dropped by whichever field the parser happened to prefer. The same
law as the hand-copy law above, one level up: where two representations of
one fact exist, the system must show both, not silently pick one.

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

## The real crawl: discovery, ingest, link liveness, page grounding (founder ruling, 2026-09-19)

"Multi-step listing->detail fetching, rate limit enforced across parallel
runs, link liveness, page grounding. Build it, then the single Opus pass
reviews the whole crawl path as an outsider before the first scheduled run
touches anyone's server."

This section closes several items the list above named as unproven, and adds
the pieces the founder asked for by name. `npm test` (scout/test/) is now
158 tests (was 114 before this arc; `git log` for the exact prior split).

- **The crawl delay ACROSS runs, and concurrency** (both named above as
  unproven): `sources.last_claimed_at` (migration
  `20260919010000_crawl_rate_limit_and_discovery_queue.sql`) plus
  `limiter.js`'s new `claimRateLimitSlot(db, sourceId, now)` -- one atomic
  `UPDATE ... WHERE` D1 statement, no read-then-write window for a second,
  truly concurrent invocation to race into. Proven twice: a hand-written
  fake proving the boundary logic (`scout/test/limiter.claim.test.js`, 7
  tests, including a simulated-concurrent-callers case), and the real
  statement run against staging D1 directly -- claim succeeds, an
  immediate second claim for the same source fails (`changes: 0`), a claim
  after the real interval elapses succeeds again. The two-layer design:
  `queue.js`'s pure planner still informs a run's intended schedule from
  best-known state, and this atomic claim is the real, final gate
  immediately before every fetch, catching a second invocation that
  started after the first one's plan was already built.
- **Multi-step listing->detail fetching** (not previously attempted at
  all): `discover.js` (phase 1: fetch each active alias's own listing
  page, discover real event-detail links, enqueue them into the new
  `discovered_pages` table) and `ingest.js` (phase 2: work that queue down,
  oldest first, fetch/parse/write each detail page). Decoupled on purpose
  -- a listing page can name more pages than one Worker invocation's time
  and rate-limit budget can fetch, so discovery and ingest can span
  separate runs. 13 tests (`discover.test.js`, `ingest.plan.test.js`).
- **Page grounding** (not previously attempted): `grounding.js`'s
  `groundPage()` refuses a redirect, a 304, a non-2xx status, a
  suspiciously short body, a Cloudflare interstitial, or a CAPTCHA
  challenge -- all before a single byte of it ever reaches a parser. 10
  tests, including the explicit "a real page that merely mentions logging
  in to register still grounds" case, so a real login MENTION is never
  confused with a login WALL.
- **Link liveness** (ARCHITECTURE.md section 9's "a link re-check of
  published rows daily", not previously built): `linkcheck.js` re-fetches
  an already-approved row's own registration link. A real 2xx, grounded
  response confirms it live (`link_checked_at` refreshed, nothing else
  changes). Anything else -- a 404, a redirect (fetcher.js never follows
  one; per the brief, "an unrelated redirect is not proof of a working
  registration page"), a challenge, a network failure -- demotes the row
  to `needs_review` through the real `review_log` transition, never a raw
  status flip and never an automated rejection. 7 tests.
- **A real, trigger-respecting upsert** (found needed, not previously
  scoped): `ingest.js`'s `planEventUpsert()` decides, purely, exactly what
  should happen for a freshly-parsed event given what (if anything)
  already exists -- insert-and-transition-to-needs_review if new, a
  content update if something real changed, a demotion to `needs_review`
  FIRST if the existing row is `approved` (its content is locked by
  `events_approved_content_lock` until it isn't), or nothing at all beyond
  `last_seen_at` if nothing changed. 7 pure tests
  (`ingest.plan.test.js`), plus the full real sequence proven directly
  against staging D1: a fresh insert lands as `draft` regardless of what
  was inserted (the table's own trigger), the transition-to-needs_review
  really flips `status` (not asserted, queried), approving as a real
  reviewer really locks content (a direct UPDATE while approved is
  refused with the schema's own error), and the demote-then-update
  sequence really unlocks and applies the change in one batch.
- **"One company, many hostnames" reaches the parser, not just the
  database** (a real gap found while building this, not previously
  named): `source_aliases` (`excelsior-almanac#17`) added the schema, but
  `smoothcomp.js`'s `classifyUrl`/`pathAllowed` still hardcoded the bare
  `SOURCE_HOST` -- a link on `fujibjj.smoothcomp.com` would have been
  refused as "not on smoothcomp.com" by the very parser meant to read it.
  Fixed: both now take an `allowedHosts`/`host` parameter (defaulting to
  `SOURCE_HOST` alone, so every existing caller and fixture is unchanged),
  and `toDraftRow` now derives `source_host` from the real fetched URL
  instead of the bare constant. 7 new parser tests prove an alias host is
  accepted, a non-reviewed one still is not, and a row correctly records
  which real alias it came from.
- **`scripts/fetch-one.sh` end to end, and Cloudflare Workers itself**
  (both named above as unproven): still unproven. This crawl has real
  code now where `disabledFetch` used to be the third inert layer
  (`scout/src/index.js`), but `SCOUT_ENABLED` stays `false` and no Cron
  Trigger exists in either environment -- unchanged. The founder's own
  adversarial review of this whole path, as an outsider, is the one
  remaining gate before either is ever flipped; this section is written
  for that review to start from, not to assert the review already
  happened.

## The Opus adversarial review, and what it found (founder ruling, 2026-09-19)

The review above happened. Verdict: **not safe to enable, twelve blocking
issues**, several proven by actually executing this crawl's code against a
clean migrated schema rather than by reading it -- which is also how it
caught the one claim in the section above that was not true of the real
code: "the full real sequence proven directly against staging D1" was true
of `planEventUpsert`'s statements in isolation, but `runCrawlCycle` --
the actual Worker entry point -- had never once been run against the real
schema at all. Its first write used `component` values
(`'scout_discovery'`, `'scout_ingest'`, `'scout_linkcheck'`) the
`crawl_runs` table's own CHECK constraint does not permit, so the run
would have failed on line one, in production, on the first scheduled
tick. The full, unfiltered review is posted to EXC-144 (excelsior-master's
Linear tracker); it is not duplicated here.

All twelve are fixed:

- **crawl_runs component values** (B4): `runCrawlCycle` now uses only
  `'tier1_scout'` (region: `'robots_check'` / `'discovery'` / `'ingest'`)
  and `'link_checker'`, the six literals the schema actually permits.
  Proven against a REAL migrated D1 via a rewritten
  `scripts/verify-scout.sh` (see below) -- not a fake, the actual
  `scheduled()` handler, the actual schema.
- **Cross-phase and cross-alias rate-limit starvation** (B5/B6): the
  single shared per-company clock used to be claimed once per invocation
  and refuse everyone else for the rest of that run -- ingest and
  link-check always lost to discovery, and alias 2+ of one company never
  got fetched, every single night. `d1ClaimSlot` (`d1adapters.js`) now
  waits in real time (bounded, default 90s) for the slot to free, so a
  later claimer in the same invocation gets its turn instead of being
  refused permanently. The phase-level decision functions
  (`discover.js`/`ingest.js`/`linkcheck.js`) are unchanged in shape --
  they still just call `claimSlot(source)` once per item -- so their own
  unit tests (which inject a plain fake) are unaffected; the real waiting
  lives only in the real adapter, same split as every other D1 adapter in
  this file.
- **The link checker fetching an excluded /order/ path, and never
  checking the terms-review gate** (B1/B2): `linkcheck.js` no longer
  fetches `registration_url` at all. It re-fetches the event's own
  `source_url` (always an `EVENT_DETAIL_PATH` page, the one type this
  crawl is reviewed to touch) and re-parses it to confirm a registration
  link is still present -- the real liveness signal, without ever
  requesting the registration/checkout flow itself. It now also calls
  `checkSource()`, the same gate discovery and ingest already used, so
  deactivating a source stops the daily link re-check too. This also
  incidentally fixed the false-demotion half of B9: re-checking
  `source_url` is always same-host by construction, so an off-platform or
  bare-domain `registration_url` can no longer cause our OWN host
  allowlist refusal to be misread as "the link is dead."
- **robots.txt never re-read** (B3): `robotscheck.js` (new), wired as
  phase 0 of every crawl cycle, re-fetches each active alias's own
  robots.txt, hashes it, and compares against the hash recorded at
  activation. Unchanged: `robots_read_on` refreshes. Different, or the
  file disappeared entirely (404): the alias is paused (`active = 0`),
  the recorded hash is left untouched as the historical record of what
  was actually reviewed, and a human has to look again -- `checkSource`
  and the discovery gate already refuse an inactive row.
- **A plain http:// link aborting the whole discovery batch** (B7):
  `classifyUrl` now refuses anything but `https:` at the source, so an
  ordinary mixed-scheme anchor is simply dropped, never enqueued.
  `d1EnqueueDiscovered` also no longer runs its inserts as one atomic
  `db.batch()` -- each URL's own INSERT is awaited and caught
  individually, so one row's own rejection (belt AND suspenders) can
  never take its siblings down with it.
- **Percent-encoding walking past the one exclusion list** (B10):
  `classifyUrl` now decodes the pathname (bounded, repeated, fails closed
  on malformed encoding) before testing it against
  `EXCLUDED_PATH_RULES`/`EVENT_DETAIL_PATH`, so `%2e%2e%2f...order%2f...`
  is judged by what it actually resolves to.
- **A fetched page never revisited, so real changes are invisible
  forever** (B8): `d1RequeueStalePages` puts a `discovered_pages` row
  that has been `'fetched'` for more than three days back to `'pending'`
  (schema-legal: only `status`/`fetched_at` change, together, which is
  exactly what `discovered_pages_immutable_identity` and the table's own
  `CHECK` both allow). `runIngest` calls it before loading pending pages,
  so `planEventUpsert`'s demote-then-update machinery can actually fire
  on a page ingested once, long ago.
- **No backoff or stop on 403/429/503 anywhere** (B12): every phase now
  tracks a per-run, per-company backoff set. A 429 or 503 stops further
  fetches to that company for the rest of tonight's run (tried again
  tomorrow). A 403 does the same AND calls the new `d1DeactivateSource`
  (`sources.active = 0`) -- a 403 is an answer that stops that host, per
  the terms review, not a page to retry tomorrow; the source stays
  inactive until a human looks again.
- **The real Crawl-delay being ignored** (B11): `d1ClaimSlot` now uses
  `minIntervalSeconds(source.robots_crawl_delay_seconds)` --
  `limiter.js`'s own exported helper, previously unused by the real
  adapter -- instead of the bare 10-second floor.

**Proof, not just code**: `npm run test:unit` is now 236 tests (was 158 in
the section above), including a new `runIngest`-level suite
(`ingest.run.test.js`) that previously did not exist at all (only the pure
`planEventUpsert` decision was tested; the orchestration loop itself --
where B5/B8/B12 actually lived -- had zero coverage), a new
`robotscheck.test.js`, and new cases in `discover.test.js`/
`linkcheck.test.js`/`smoothcomp.test.js` for every one of the twelve
findings above. Separately, `scripts/verify-scout.sh` was rewritten for
the real multi-phase crawl and re-run against a fresh local D1 migration:
one full `scheduled()` cycle, against the real schema, with today's real
data shape (one fully-reviewed active source, zero active aliases --
checked directly against staging and production before writing this),
closes all four phases `succeeded` with schema-valid `component` values
and zero fetches. That is the direct, executed proof that B4 is closed
and that this is genuinely what the first real scheduled run looks like
today, not a synthetic best case.

**Still not proven, honestly**: a real network fetch against a real
Smoothcomp organizer subdomain, end to end. Today (2026-09-19), zero
`source_aliases` rows exist anywhere, in any environment -- ALMANAC has
never activated one. Activating an alias requires ARCHITECTURE.md section
9 rule 5's human check of that organizer subdomain's own terms page, a
legal-judgment step outside this program's standing authorization. Until
one is activated, "the first scheduled run" is, honestly, an empty one:
every phase executes for real, against the real schema, and finds nothing
to do. Also unchanged from the section above: production's `SCOUT_ENABLED`
stays `false` and carries no `[triggers]` section; if a nightly run is
authorized before then, it is staging's own config that moves, never
production's, per the standing "production stays untouched until the one
gate" rule.

## The first live staging crawl (founder ruling, 2026-09-20)

Deployed `almanac-scout-staging` (nightly cron `0 7 * * *`, `SCOUT_ENABLED=true`),
activated six Smoothcomp organizer aliases on the founder's subdomain-terms rule
(each: robots.txt byte-identical to the parent's, `/en/agreements` 404 on the
subdomain, verdict `inherited_parent`, reasoning recorded in the row;
`scripts/review-aliases.mjs`), and ran the real cycle against real staging D1 and
the real hosts via `wrangler dev --remote --test-scheduled`.

What the run proved live: robots re-check 6/6 unchanged; discovery fetched all six
listing pages 10 seconds apart (the B5/B6 fixes, on the real clock); 338 event URLs
enqueued; ingest fetched ONE event page, got HTTP 403 from Cloudflare's own egress,
marked it failed, paused the source (`sources.active = 0`) and stopped -- the B12
stop-on-403 law working as written. Zero Smoothcomp rows landed.

Three defects only a live run could find, all fixed: (1) `ctx.waitUntil` is
cancelled ~30s after the handler returns, killing a cycle that spends minutes
honoring the 10s clock -- the handler now awaits; (2) a cancelled cycle left its
`crawl_runs` row `running` forever -- a 20-minute sweep now closes it; (3) the
listing pages serve events as a JSON-LD `ItemList`, not `<a href>` anchors, so
discovery found nothing until `parseListingPage` read that.

Not covered: no Smoothcomp event detail page has ever been parsed from real HTML
(every fixture is synthetic; the real ones return 403 to plain HTTP, honest UA or
browser UA, from a home IP and from Cloudflare). Link-check and the requeue path have
never run against a real approved row. `state` is not in the listing data.

## Listing-sourced rows (founder ruling, 2026-09-20, route 1)

"Build drafts from listing data only. Never fetch the event page." Live on
staging: **269 rows landed across all six organizers** (grapplingindustries
117, fujibjj 61, newbreedbjj 28, naga 25, agf 20, submissionchallenge 18;
42 in the Missouri-plus-bordering-states footprint), every one
`needs_review`, none approved by anything.

**What is proven.** The full cycle ran twice against real staging D1 and the
real hosts. The second run wrote ZERO rows and marked all 269 unchanged --
real idempotency, not an assertion about it. `state` is derived from the
event's own coordinates against a `places` gazetteer built from the SAME
cities500 file and the same geoname_id keys as the app's own import (21,785
US places, both sides). Every row carries `state_source='derived'` and
`link_check_method='structural'`, and the console renders both with their own
chip words and a provenance banner, never as "found on page"; a structural
link keeps a row out of plain-A range, so it needs the deliberate Shift+A.

**What the run refused to do, which is the point.** Of 339 listing entries:
61 non-US, 9 unresolvable, 3 malformed -- none written. The unresolvable ones
are the guards working on real data: Quad Cities (Hampton IL 6.1 km vs
Bettendorf IA 8.7 km), St Joseph (MO 3.6 km vs Elwood KS 4.0 km), Fargo (ND
5.6 km vs Moorhead MN 5.8 km). A nearest-city match cannot honestly answer
those, so no row exists rather than a wrong one.

**Two real defects the live run found, both fixed:**
1. The leftover `discovered_pages` queue from the detail-fetching era made
   ingest fetch one event page anyway, take its 403 and pause the whole
   source -- undoing the listing run that had just succeeded. A
   `listing_only` source's queued pages are now drained as `excluded` and
   never fetched.
2. Three "Grappling Industries VANCOUVER" (BC, Canada) rows landed stamped
   `state='WA'`: the nearest US place to Vancouver is across the border, and
   "nearest wins" answered a question it had no business answering.
   `deriveState` is now country-aware and refuses any non-US event.

**Left for a human, deliberately.** Those three Canadian rows are still in the
staging review queue. The scout cannot retract them: `needs_review ->
rejected` is `system_allowed = 0`, and the database refused the attempt
verbatim -- "system actors cannot make this transition". A refusal is the
proof; only a reviewer rejects.

**Not covered.** No listing-sourced row has been approved or published, so the
publish pipe has still never carried one. Divisions are unknown on every row
(the matcher downranks, as ruled). The listing carries no venue, organizer or
registration deadline, so those are null rather than invented. Non-tournament
entries (one "SPECTATOR TICKETS" listing) are not distinguishable from
tournaments by any signal the listing gives; the reviewer is the filter. The
gazetteer is US-only by construction.

## The single fetch chokepoint (founder ruling, 2026-09-21)

"ONE function decides whether any code path may fetch a given URL, every
fetch in Scout goes through it, and a test proves there is no other fetch
path. If a fourth instance of this bug is possible after that, the
chokepoint is wrong."

**Why.** One rule was written in two places and missed in a third, three
times: link-check fetched an excluded `/order/` path while discovery and
ingest checked it (Opus B1); link-check never ran the terms gate while the
others did (B2); and after `listing_only` existed, ingest refused event
pages for it but link-check did not, so a legacy approved row with a NULL
method live-fetched a Smoothcomp event page in production and paused the
source.

**What.** `scout/src/fetchgate.js`: `decideFetch` is the only decision and
`gatedFetch` the only request. The rules live there once: https; the source
passes the terms gate (so stopping a source stops every fetch, robots
included); the host is one of that source's active aliases; the URL is one of
three reviewed shapes decided from the URL itself (robots.txt, the alias's
own listing path, or a parser-allowed event page, and never an event page
for a `listing_only` source); and the shared clock is claimed for every
request but robots. All four phases and the hand-run `fetch-one` tool call
it. Found on the way and removed: the superseded `runScoutRun`/`queue.js`
path (unwired, but still a live `fetchImpl()` call site), the now-unused
`fetchRobots` primitive, and three copies of the parser registry keyed by
source id (one real registry, keyed by `sources.parser`, remains).

**Proof, and proof the proof can fail.** `scout/test/no-other-fetch-path.test.js`:
statically, no file in `scout/src` except the gate may call or import the
raw fetch functions or call `fetch()`, and every script fetch site is either
gated or one of three named exemptions (asserted exact, so a stale exemption
also fails); behaviourally, all four real phases driven with a `listing_only`
source, a stale queued event page and a NULL-method approved row send not one
event page to the network. Four deliberate breaks, each red: a new module
calling `fetchOnce` directly; link-check calling the raw `fetchImpl` for NULL
rows (the production bug's own shape); the gate forgetting `listing_only`; a
new script fetching a crawl target raw. `scripts/verify-fetcher.sh` now proves
the 10-second law through the real path (gate plus the real `d1ClaimSlot`,
real HTTPS server): the server saw the two requests 10,013 ms apart.

**Not covered.** The three script exemptions are human-run and outside the
gate by construction (the fetcher's own localhost battery, the console
walkthrough, and pre-activation alias review, which cannot be gated on an
activation that has not happened yet). The static proof is a text scan: a
fetch reached through `eval`, a computed property name, or a
`globalThis['fe'+'tch']` would evade it. The behavioural proof covers that
class for the four phases, not for code that does not exist yet.

## A failed run records WHY (founder ruling, 2026-09-22)

"A cycle that fails should record WHY, not just that it failed. Unexplained
is not acceptable for something that runs unattended every night against
other people's servers."

**The incident.** A production discovery phase was recorded `failed,
errors 1`, and that was the entire record. The cause turned out to be an
interrupted deploy-and-run command, recoverable only from an operator's
local wrangler logs -- which are not part of the system and do not exist on
the machine the cron runs on. A nightly job that can fail without saying why
cannot be operated.

**The fix.** `crawl_runs.error_text` (migration `20260922010000`), written on
every close: the thrown error's kind and message on a failure, bounded to 500
characters and never a stack trace or a page body; the deduplicated skip
reasons on a SUCCEEDED phase, so a recurring count explains itself; and a
fixed sentence on the stale-run sweep, so a cycle killed mid-flight says so
instead of being closed as a bare failure by the next night's run.

**Proven** by `scout/test/crawl-run-records-why.test.js`, which drives the
REAL `runCrawlCycle` against a D1 shim and asserts the statement the Worker
actually issues, and live on staging: discovery's long-standing `errors: 3`
now reads `75 skipped: listing entry dropped: ... missing required field(s):
country | ambiguous near a state line: Hampton (IL, 6.1 km) and Bettendorf
(IA, 8.7 km) ...`.

**Not covered.** A failure in `openRun` itself, or a D1 outage, still cannot
record anything -- there is nowhere to write it. The Worker's console output
is not retained anywhere; only what reaches `crawl_runs` survives.
