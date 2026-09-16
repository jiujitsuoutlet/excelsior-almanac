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

## What each battery covers, and what it does not

### `npm run test:unit` (102 tests: 18 console, 84 scout)

This command now runs both `console/test/` and `scout/test/`. The console
half covers: the approval gate, chips, blockers, the count headline,
duplicate resolution, input validation, Access token verification against a
real RSA key, the dev identity guard, and database-error wording. See the
scout section below for the other 84 (67 skeleton, 17 the smoothcomp.com
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

### Scout skeleton: `npm run test:unit` (67 of the 102 tests) and `bash scripts/verify-scout.sh` (12 checks)

The scout skeleton (`scout/`) has no Tier 1 parsers and no real fetch yet.
Only four things exist: a robots.txt parser and matcher (`robots.js`), a
per-host rate limiter (`limiter.js`), the terms-review gate (`gate.js`), a
plan builder (`queue.js`), and a runner (`run.js`) whose fetch function is
injected and, in this pull request, always throws. The batteries below are
scoped to exactly that: proving the gate refuses correctly and that nothing
in the skeleton can reach a real network fetch.

Covers, in `scout/test/` (67 tests, pure functions, no database and no
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

### Tier 1 parser: smoothcomp.com (`npm run test:unit`, 17 of the 102 tests) and `bash scripts/verify-parser.sh` (18 checks)

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
