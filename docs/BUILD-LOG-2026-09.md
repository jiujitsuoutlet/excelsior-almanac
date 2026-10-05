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
- **The app's Supabase project layout** stays until the founder moves it: `pvqdyqquugxkypvrbwhs` holds every real member row and serves the live app despite its dashboard label "excelsior-staging"; `ecronfxsaoilagcwvfyw`, dashboard-labeled "excelsior-production," is the one that's actually empty and safe to rehearse against (confirmed by row count 2026-09-16; see `docs/ENVIRONMENTS.md` in `excelsior-master`, MAD v2.26). Dashboard names are not authoritative anywhere in this build.

### Evidence index

- Schema battery: `scripts/verify-schema.sh` (local and staging, with a Time
  Travel restore).
- Console API battery: `scripts/verify-console.sh`.
- Browser walkthrough and screenshots: `scripts/console-walkthrough.mjs`,
  `evidence/console/`.
- Production runbook, run by the founder: `docs/D1-RUNBOOK.md`.
- What none of them cover: `docs/VERIFICATION.md`.

## 2026-09-16 ... the fetcher, and the crawl delay it is bound by

The first code in this lane that can reach another company's server.

`scout/src/fetcher.js` holds the rules the terms review was granted under,
and enforces them before a request leaves: https only, one named host, the
parser's own excluded-path list, redirects reported but never followed, a
two megabyte body cap that drops the connection mid-stream, a timeout, the
pinned user agent, and conditional requests so a repeat visit costs the host
a 304 instead of a page.

EXC-147 is closed in the same pull request, because it had to be: the plan
has always worked out when each page may be fetched, and until now nothing
waited for it. `run.js` now waits, and then CHECKS the wait ... a sleep that
comes back early is refused, loudly, and the whole run stops.

`scripts/fetch-one.sh` is the founder's hand-run command: one page, on his
word, printing exactly what it will request and what Smoothcomp's access log
will show, then asking him to type yes. It writes nothing to the events
table. There is no schedule anywhere in the repository.

New law recorded in docs/VERIFICATION.md: **wherever a hand-written list
mirrors what the system actually does, that is where the next false pass
hides.** Three false passes in this build had that exact shape. The fetcher
answers to it: there is now one `classifyUrl` shared by the listing parser
and the fetcher, and `terms-drift.test.js` reads the founder's own review
file and makes the code answer to it.

One real hole was found by a test while writing this: `fetchRobots` took its
allowed host from its own argument, so the check that keeps us on one host
was being satisfied by the very value it was meant to check.

## 2026-09-26 ... off-Smoothcomp terms reviews: IBJJF and JJWL are permission-only

One research session, pull request #33, eleven terms reviews, and the
founder's rulings the same night. No code, no crawl, nothing applied to
either database.

### What shipped, and who proved it

| Shipped | Proven by |
|---|---|
| Eleven terms-review records in `scout/terms-reviews/`: IBJJF, JJWL, SJJIF, ASJJF, AJP, GripWire, BJJCompFinder, JiuJitsuBlog, FloGrappling, Wikipedia, Jits.gg | Every record loads on top of all eight migrations in a throwaway database; every quoted clause machine-matched against the page text actually fetched (39 fragments, 0 misses); `scout/src/gate.js` refuses all eleven as stored; unit suite 264/264. **The founder's ruling on every verdict, 2026-09-26** |
| Permission requests to IBJJF and JJWL | Drafted in the session and approved by the founder as written, 2026-09-26; sent 2026-10-04 from paul.tokgozoglu@gmail.com (an earlier version of this entry said 2026-09-26: the founder had said he was sending them, and none had gone out); recorded as pending in both records, with the exact scope the ask promised |

### What the research found

- **IBJJF** (terms last updated 2025-10-06) forbids bots, forbids compiling
  its calendar into a database "directly or indirectly" (a person copying it
  counts), and forbids "unauthorized framing of or linking to the Services".
  **JJWL** forbids spidering, crawling and scraping, and says nothing about
  compiling or linking. Neither publishes a feed, API or widget. Every third
  party carrying their calendars either bans scraping, got its data by
  scraping, or covers only flagship events. Written permission is the only
  clean path.
- **AJP** and UAEJJF's events site are white-labeled Smoothcomp (robots.txt
  byte-identical to Smoothcomp's), and AJP's events never appear on
  smoothcomp.com's own calendar. **ASJJF**'s robots.txt disallows
  everything; **SJJIF**'s redirects to a login page.
- **Stakes**, 2026-09-26 to 2026-12-06 (the window where every calendar is
  close to complete): Smoothcomp 342 US grappling listings, IBJJF 31 (13
  city-weekends), JJWL about 9, AJP 1, SJJIF 1. By listing: 89% / 8% / 2% /
  under 1%. Inside the Missouri footprint: about 41 Smoothcomp, 5 IBJJF
  (Kansas City, Nashville), 0 JJWL.
- **The larger gap is inside Smoothcomp.** The six active aliases hold 126
  of those 342. Smoothcomp's own public calendar page returned all 1,687
  upcoming events to one honest request, a page the existing review already
  covers.
- **A schema defect, found while verifying:** the `sources` activation CHECK
  accepts `active = 1` when `verdict` or `login_required` is NULL (SQL treats
  `NULL = 0` as unknown, and a CHECK rejects only false). The gate still
  refuses both, so nothing can crawl such a row; the database layer is weaker
  than documented. The fix is a migration and rides its own pull request, not
  this one.

### Decisions, and why (founder rulings, 2026-09-26)

1. **IBJJF and JJWL: not_allowed until they say yes.** Both asks are recorded
   as pending with the promised scope, so a yes is read as covering exactly
   that and nothing wider.
2. **AJP: allowed with conditions, as its own source under Smoothcomp's
   rules.** Not a Smoothcomp alias, because it serves AJP's own terms.
   Activation waits: its listing page has not been read, so field 5 is empty.
3. **GripWire: allowed with conditions, for an export only.** ALMANAC takes
   only organizers whose own terms allow it, and never IBJJF or JJWL rows;
   the export request asks GripWire where each listing comes from.
4. **The other verdicts stand as recommended**, with the founder as reviewer
   on all eleven records.
5. **New law for research sessions: research reads follow the same crawl law
   as Scout, and a site's terms are read before anything else on it.** This
   session read BJJCompFinder pages and JiuJitsuBlog's homepage before (or
   without) terms; those reads were accepted this once, because they were
   disclosed.

### What the session got wrong, and what it taught

- The research fetch wrapper spaced requests ten seconds apart per hostname,
  not per company. Three pairs of reads landed 0 to 1 seconds apart on sister
  hosts of one company (IBJJF, Wikimedia, Smoothcomp's platform). Section 9's
  one clock per company applies to research reads too.
- The first version of the records stamped read dates in UTC while the
  founder rules in Central time, which put his ruling a day before the
  reading. Date fields in terms records now hold America/Chicago calendar
  dates; evidence timestamps stay UTC, marked with a Z.
- The first verification pass was right for the wrong reason: the database
  refused every row only because no reviewer was named. Once the reviewer was
  filled in, the NULL defect above showed itself. A refusal proves a rule only
  when it is refused for the reason under test.

### Open loops, on the founder

1. Replies from IBJJF and JJWL.
2. A reply from GripWire to the export request (sent 2026-10-04).
3. Applying the eleven records to production and staging (commands in each
   file's header), after the merge.
4. AJP activation: reading its listing page to record field 5, and whether a
   parser is worth about two US events a year.
5. FloSports' terms clause: a person must read it in a browser.
6. Whether ALMANAC should read Smoothcomp's global calendar page, which the
   existing review already covers.
7. The migration that closes the NULL holes, in its own pull request.

### Evidence index

- The records: each file's header lists every request the session sent to
  that company (UTC time, status, sha256).
- Pull request #33: the stakes method, and the full disclosure of reads beyond
  terms and robots.txt.
