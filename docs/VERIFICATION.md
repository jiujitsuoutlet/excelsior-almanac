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

### `npm run test:unit` (80 tests: 18 console, 62 scout)

This command now runs both `console/test/` and `scout/test/`. The console
half covers: the approval gate, chips, blockers, the count headline,
duplicate resolution, input validation, Access token verification against a
real RSA key, the dev identity guard, and database-error wording. See the
scout section below for the other 62.

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

### Scout skeleton: `npm run test:unit` (62 of the 80 tests) and `bash scripts/verify-scout.sh` (12 checks)

The scout skeleton (`scout/`) has no Tier 1 parsers and no real fetch yet.
Only four things exist: a robots.txt parser and matcher (`robots.js`), a
per-host rate limiter (`limiter.js`), the terms-review gate (`gate.js`), a
plan builder (`queue.js`), and a runner (`run.js`) whose fetch function is
injected and, in this pull request, always throws. The batteries below are
scoped to exactly that: proving the gate refuses correctly and that nothing
in the skeleton can reach a real network fetch.

Covers, in `scout/test/` (62 tests, pure functions, no database and no
network):
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

## When a gap becomes a test

A gap moves onto this list once it is known. It becomes a test when the slice
that needs it arrives (for example, real chips arrive with the Tier 1 scout),
or immediately when a bug is found in it, with the founder's own failing case
as the first test.
