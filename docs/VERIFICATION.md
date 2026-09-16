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

### `npm run test:unit` (18 tests)

Covers: the approval gate, chips, blockers, the count headline, duplicate
resolution, input validation, Access token verification against a real RSA
key, the dev identity guard, and database-error wording.

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

## When a gap becomes a test

A gap moves onto this list once it is known. It becomes a test when the slice
that needs it arrives (for example, real chips arrive with the Tier 1 scout),
or immediately when a bug is found in it, with the founder's own failing case
as the first test.
