# ALMANAC build log, September 2026

One entry per working window. What shipped and was PROVEN, the decisions and
why, the bugs and what they taught, what is still open.

---

## 2026-09-13 to 2026-09-15: from a brief to a working approval console

Three MAD amendments, five pull requests in the app repository, four in this
one, and a database in production holding no rows yet on purpose.

### What shipped, and who proved it

| Shipped | Proven by |
|---|---|
| MAD v2.53: Tournament Master guardian, naming lock, numbering law | Founder review of the diff |
| MAD v2.54: ALMANAC ratified as a separate data product; the scraping prohibition removed; drop-in fees ruled a logistics fact | Founder review of the diff |
| MAD v2.55: ALMANAC on Cloudflare; hold 1 adds Worker secrets | Founder review of the diff |
| `ARCHITECTURE.md` in this repository | Founder review |
| D1 schema: 15 tables, the one status path, append-only logs | Batteries (54 local, 58 staging) **and the founder's own hands on production, runbook steps 1 to 6, run twice** |
| The environment marker | Founder ran the write, the read-back and the refused overwrite on production |
| The approval console (not deployed) | Batteries (18 unit, 46 API, 38 browser local, 29 staging) **and the founder's own review loop on staging, end to end** |
| Verification law: name what a battery does not cover | Written into `docs/VERIFICATION.md` and the vault skill `excelsior-verify` |

Cleanups: PR #8 (the abandoned Scout branch) closed with its record; two stray
Supabase projects deleted; four vault skills corrected; EXC-145 filed for the
rest of the vault; EXC-80 given the live-database grant sweep; EXC-92 closed
with proof.

### Decisions, and why

**ALMANAC left Supabase for Cloudflare before any schema existed.** The
deciding reason was the credential boundary: a Supabase deploy token reaches
every project in the organization, including the live member project, while a
Cloudflare token scoped to the founder's own account cannot reach the member
database at all. Cost was incidental ($5 a month against $10).

**One path for status.** A status changes only when a row is inserted into
`review_log` with `action = 'transition'`. Triggers apply it and refuse every
direct update, for every caller, the console and the founder included. D1 has
no stored procedures, so the triggers are the guarantee.

**Approval is a database rule, not a UI rule.** An approved event must carry a
registration link; automatic approval cannot run while every rule row is
disabled; a rule cannot be enabled without an amendment reference. The console
enforces the same things earlier, in words, so the reviewer is never surprised.

**The badge is read from the database.** Each database carries an immutable
`environment_marker` row. The console refuses every write when the marker is
missing or disagrees with its configuration, so production cannot be mistaken
for staging.

**The source window keeps its opener link.** Without it the browser refuses to
let the console move that window row to row. The cost is reverse tabnabbing,
answered by a guard that raises the browser's own leave-site dialog.

**Numbering law.** A version number is claimed when its pull request opens.
v2.9 is retired unused, after two months in which migrations cited an
amendment that did not exist.

### The two bugs the founder found by hand, and what they taught

**One: a row that could never be approved.** A hand entry with no registration
link was refused by the database, and the console showed the database's own
words ("The database refused a value"). The rule was right; the console let
the row be saved without warning and then failed to explain. Fixed: the row
states the rule and the two ways out before any key is pressed, and both A and
Shift+A refuse with the same sentence.

**Why the tests missed it:** every row the walkthrough entered had every field
filled. The tests were real; their inputs were all one shape.

**Two: an edit that never saved.** Pressing Enter appeared to do nothing, and
only Esc responded, discarding the work. It could not be reproduced: typing by
hand and pressing Enter saves in both Chromium and WebKit. The one mechanism
that matches every symptom is a request in flight with no timeout: while one
was pending, every key was ignored in silence. Fixed: a 15-second timeout that
says so, a Save button that shows "Saving...", a busy console that answers
instead of swallowing keys, a visible Save button that cannot fall below the
fold, and Esc asking before it discards.

**Why the tests missed it:** the walkthrough was keyboard-only against a fast
local server. It never clicked a button, never pressed Enter from a field it
had not filled, never tested Esc, and never met a slow request.

**The law that came out of it** (now in `excelsior-verify` and
`docs/VERIFICATION.md`): before reporting that a battery passed, state the
shapes it does not cover. Build the list by walking the axes the battery holds
constant, especially empty optional fields, mouse paths, other browsers, and
slow or failed requests.

Three faults in the test harness itself were fixed the same way: a fixed delay
that passed locally and failed against the slower remote database, a
twelve-row count that assumed an empty queue, and two assertions that could
not fail.

### Open loops, on the founder

1. The Smoothcomp terms review, the last thing blocking Scout.
2. The bot's contact mailbox for its user agent.
3. The free Supabase org, then the move and pause of `excelsior-production`,
   which returns the Supabase bill to $25 a month.
4. An OpenCage account, needed before geocoding.

### Deferred, with the reason

- **Tier 2 automatic approval:** off until a measured precision number and a
  dated amendment.
- **Deploying the console** behind Cloudflare Access: after the review loop is
  trusted on staging.
- **Venues, session times, the publish pipe and the guardian dialogue:** later
  steps in the ratified sequence.
- **ORACLE** folded into the guardian as the Origin node rather than a
  separate slice.
- **The app's staging Supabase project** stays until the founder moves it.

### Evidence index

- Schema battery: `scripts/verify-schema.sh` (local and staging, with a Time
  Travel restore).
- Console API battery: `scripts/verify-console.sh`.
- Browser walkthrough and screenshots: `scripts/console-walkthrough.mjs`,
  `evidence/console/`.
- Production runbook, run by the founder: `docs/D1-RUNBOOK.md`.
- What none of them cover: `docs/VERIFICATION.md`.
