# ALMANAC Architecture

## 1. Purpose and authority

ALMANAC is a separate Excelsior Industries data product... the martial arts events and academies database that feeds the Excelsior member app. It crawls public sources, uses models to extract facts into draft rows, and a human reviewer approves a row before it publishes. This repository holds ALMANAC's own code, schema, and infrastructure, apart from the member app and the member database.

The Excelsior MAD (`MAD.md` in `jiujitsuoutlet/excelsior-master`) is canonical. Where this document and the MAD disagree, the MAD wins, and this document is wrong until it is corrected to match. The paragraph below is quoted word for word from MAD Section 3, "ALMANAC: the events and academies data product":

> **ALMANAC (v2.54, platform amended v2.55).** ALMANAC is a separate Excelsior Industries data product: the martial arts events and academies database that feeds this app. It crawls public sources, uses models to extract facts into draft rows, and a human approves rows. Approved rows publish one way into this app's tables. ALMANAC runs on Cloudflare Workers and its own D1 database, from its own repository; no crawler, scheduled job or model key touches the member database. Members never see model prose. They see approved rows, rendered by authored templates. Automatic approval of model-extracted rows stays off until the founder reviews a measured precision number and rules on it in a dated amendment.

## 2. The four holds, as they apply here

**Hold 1, secrets.** Quoted word for word from MAD Section 10: "Credentials live only in gitignored .env files, Supabase Edge Function secrets, and Cloudflare Worker secrets. Never in a repository, never pasted into any chat. Every deploy is preceded by a secrets scan of the built bundle... only browser-safe publishable keys ship. Code writes .env, not Paul."

**Hold 2, points and member identity.** Nothing in ALMANAC grants points or writes the points ledger. ALMANAC holds no member identities. The only two pipes between ALMANAC and the app are the publish pipe (ALMANAC to app, approved rows only) and the coverage demand read (app to ALMANAC, aggregate counts per place per day, carrying no member identity).

**Hold 3, proof by rejection.** The console Worker must refuse an unauthenticated request and must refuse a signed-in user who is not on the reviewer list. The app's `almanac-ingest` function must refuse an unsigned call and must refuse a replayed call carrying an old timestamp. Each refusal is captured as evidence, never assumed.

**Hold 4, the model boundary.** Quoted word for word from the MAD's ALMANAC Governance paragraph: "members never see model prose, only approved rows cross the publish pipe, and the scout is never reachable by a member."

## 3. Pull-request law

The bootstrap commit (`.gitignore`, `README.md`) is the only commit ever made directly to `main`. Every change after it, this document included, rides a branch, a pull request, the founder's word, and a merge. There is no exception for documentation, build-log entries, or one-line fixes. Authored text in this repository uses ellipses for pacing, never em-dashes.

**A schema migration rides its own pull request** (founder ruling, 2026-09-16).
Never inside a feature build, however additive and however honest the reason.
A migration changes what the database will accept for everyone; it gets read
on its own, not as a file buried in a branch that does something else.

## 4. Platform

- **Account.** ALMANAC runs in Cloudflare account `bbe6d5f6cc43632eafdd5ef854f48a25`, the founder's own account. This is not the Yoga for BJJ funnel account, and the two are never to be confused.
- **Plan.** Workers Paid.
- **Workers.** Workers run the scouts (crawl and extract), the publisher (sends signed batches to the app), the demand reader (reads the app's coverage demand and queues regions for the scout), and the console (the approval UI and its API). How these jobs are split across Worker scripts is not yet decided; the schema and console pull requests decide it.
- **Storage.** A D1 production database, and a separate D1 staging database, at no extra cost on the Paid plan.
- **Scheduling.** Cron Triggers start the nightly and periodic jobs. Workflows carry the crawl queue, so the per-host wait (`step.sleep`) between two requests costs no CPU, and a failed step retries on its own.
- **Console access.** Cloudflare Access sits in front of the console. Reviewers sign in with GitHub, and every reviewer's GitHub account must have two-factor authentication turned on. The one-time email PIN login method stays off.
- **Authorization.** D1 has no row-level security and is never reachable from a browser. Every read and write passes through Worker code that checks the Access identity against the reviewer list.
- **Secrets.** Credentials live in Cloudflare Worker secrets and the gitignored `.env` in this repository. Nowhere else.
- **Agent credential.** The agent's Cloudflare credential is a custom API token named `almanac-agent`, not a `wrangler login` session. Its permissions: Workers Scripts Edit, D1 Edit, Account Settings Read, Workers Tail Read, User Details Read, Memberships Read. It is scoped to this account only, and it has no expiry (founder ruling 2026-09-14). This document records the permission names only. It never records a token value.

## 5. Components and data flow

- **Scout.** Tier 1 runs deterministic parsers, one per host, each with fixture tests. Tier 2 runs a model extraction into a strict JSON schema; anything that fails validation is discarded. Tier 3 accepts public submissions and console-entered rows from coaches. Tier 2 and Tier 3 rows always start at `needs_review`.
- **Approval console.** A Worker-served UI behind Cloudflare Access, where a reviewer reads the live source page beside the extracted fields and approves, rejects, edits, merges, or skips a row.
- **Publisher.** A scheduled Worker that sends signed batches of approved rows and status changes to the app.
- **Demand reader.** A Worker that reads aggregate coverage-request counts from the app and queues those regions for the next scout run.

```
sources (host pages)
   |
   v
scout (Tier 1 parsers / Tier 2 model extraction / Tier 3 submissions)
   |
   v
D1 drafts (needs_review)
   |
   v
console approval (human reviewer, behind Cloudflare Access)
   |
   v
publisher (signed batches)
   |
   v
app: almanac-ingest edge function (Supabase, service role only)
   |
   v
member reads an approved row

app: coverage_requests -> almanac-demand edge function -> ALMANAC demand reader
   (the only reverse flow, aggregate counts only, no member identity)
```

## 6. Data model summary

Core tables: `events` (plus small per-type extensions for seminars, superfights, camps and competitions), `venues`, and `venue_sessions` (day, start and end time, timezone, style, level, an open-mat flag, drop-in policy, and the drop-in fee when the source publishes one). Supporting tables: `row_signals` (append-only), `review_log` (append-only), `sources`, `approval_rules`, `coverage_requests`, and `crawl_runs`.

Six status values apply across `events`, `venues`, and `venue_sessions`: `draft`, `needs_review`, `approved`, `rejected`, `expired`, `stale`. Editing an approved row returns it to `needs_review`. A dead link or a vanished source makes a row `stale`. Venues never expire.

Dedupe keys. Events: the host's own event reference first, then normalized name, start date, country, state and city; a row within one day, within 50 km and with a similar name becomes a merge candidate for a human. Venues: website domain, or normalized name plus coordinates rounded to about 100 m. Sessions: venue, day, start time, and style.

ALMANAC stores facts and source URLs. It never stores page bodies, copied descriptions, or participant data of any kind, including registrant lists, brackets, results, or the name of any minor.

The `venue_sessions` drop-in fee is not a pricing exception. MAD Section 11 states, word for word: "JJO's own pricing never appears in the app, so leads book a No Sweat Intro. (v2.54: this rule scopes to JJO pricing only. A third-party academy's published drop-in fee is a logistics fact and may appear.)" A third-party academy's fee is a fact a traveling member needs, never JJO's own price.

## 7. Verification signals and automatic approval

Signals recorded per row: link liveness, date sanity, second-source corroboration, duplicate score, geocode confidence, and, for Tier 2 rows, a grounding check (the date, city, and link each appear verbatim on the fetched page) plus the agreement of two independent extraction passes.

Two automatic approval rules exist on paper: a deterministic Tier 1 rule and a proposed Tier 2 rule keyed to the signals above. Both stay off. Enabling either one requires a dated amendment and the founder's ruling on a measured precision number, never a code change alone.

## 8. What the scout will not do

Copied word for word from v2.54 decision 5:

- No Facebook or Instagram access in any form. Facebook has no events API, and scraping it is prohibited.
- No login-walled or terms-prohibited sources, no CAPTCHA solving, no bypassing logins.
- No Google Maps or Places content.
- No copied prose, no participant, bracket, or result data, and no personal data beyond public business contacts.
- The Facebook tail is covered by Tier 3 submissions and human scouts, permanently.

## 9. Crawl law and the terms review record

The scout respects `robots.txt`, re-read daily; a server error skips the host, a 404 means allowed. It sends one request per host per 10 seconds, or the host's own Crawl-delay when longer, using conditional requests, backing off on 429 and 503, and stopping entirely on 403. Its user agent identifies it honestly with a contact address. Schedule (America/Chicago): Tier 1 events nightly 02:00 to 05:00, a link re-check of published rows daily at 06:00, venue pages weekly, and the publisher every 10 minutes. It never bypasses a login, and it stores facts and source URLs only, never copied prose.

A host enters the crawl only after a human records all ten of these fields in the `sources` table:

1. Host, and the exact page types to fetch.
2. Terms URL, the terms' own last-updated date, and the date read.
3. Whether the terms prohibit automated access, scraping, crawling, bots, or data mining: the clause, or "none found".
4. Whether the terms restrict reuse of listing facts (names, dates, locations, links): the clause, or "none found".
5. Whether viewing those pages requires a login.
6. Whether the host offers an official API or data feed, with its link.
7. Paths to exclude, including every page that lists people (registrations, brackets, results, athlete profiles).
8. `robots.txt` read the same day: disallowed paths and Crawl-delay, with the file's hash recorded.
9. Verdict: allowed, allowed with conditions (listed), or not allowed. A host that is not allowed is served only by Tier 3 or direct outreach.
10. Reviewer name and date.

### Relationship with Smoothcomp (founder strategy, 2026-09-16)

No Smoothcomp partnership or direct sync is sought now. A read-only feed and an embedded registration flow are both Phase 2 asks. They are made only when ALMANAC holds coverage Smoothcomp does not have, and the partnership is obviously worth their time. Smoothcomp's SaaS Agreement prohibits routing registrations off-platform, and Smoothcomp monitors for it. An embed request now would put Clinton's organizer account at risk for nothing.

Until then, the Tournament Master links out to the real registration page. The member pays one extra tap.

The crawl is what builds the leverage for that eventual conversation, so it runs like a company that intends to partner someday: an honest user agent, a generous rate limit, no contact with athlete data, and a full stop the day Smoothcomp asks. If anyone at Smoothcomp ever looks the bot up in their logs, what they find should make that meeting easier, not harder.

## 10. Publish pipe contract

The publisher sends signed batches (an HMAC over the payload and a timestamp; old timestamps are refused) to the app's `almanac-ingest` edge function. That function re-validates every field (HTTPS links, ISO codes, dates, a source URL, a link check within 48 hours) and applies rows through a service-role-only database function, in one transaction, content then status, so `tournaments_demote_on_edit` is honored, never bypassed. Batches carry a row cap and a volume alert. Rotating one secret stops the pipe.

**Sync proven** means all seven of these hold, first on the app's staging project and then on the live project:

1. An approved ALMANAC row appears byte-identical in the app with its `almanac_id`.
2. A member session reads it in Fire.
3. Marking it stale in ALMANAC removes it from the member read within one publisher cycle.
4. A draft never crosses.
5. A member token's direct write is rejected server-side.
6. An unsigned or replayed ingest call is rejected.
7. A replayed batch creates no duplicates, and the nightly reconciliation shows matching counts and hashes on both sides.

## 11. Geocoding and places

The geocoder is OpenCage. Its results, including coordinates and a confidence score, may be stored permanently, unlike a Google result, whose terms allow caching for 30 days only. The place-name table is GeoNames cities500 (CC BY 4.0), with admin1 codes mapped to ISO 3166-2 subdivision parts before publishing; a place that cannot be mapped is not published. It is published into the app's `places` table.

Every surface, app or console, that shows ALMANAC place or location data carries this attribution line word for word: "Places: GeoNames (CC BY 4.0). Geocoding: © OpenStreetMap contributors.", linked to geonames.org and openstreetmap.org/copyright.

## 12. Build sequence and gates

**Step 1.** This document, then the D1 schema, then the console, with geocoding on save. The founder hand-enters ten real events. Gate: an evidence gallery of each row beside its source page, plus rejection proofs for an anonymous caller and for a signed-in non-reviewer.

**Step 2.** Scout v1: Tier 1 only, Missouri and its eight bordering states, nightly, each host entered only after a recorded terms review. Gate: a first-week precision report per host. Nothing approves automatically.

**Step 3.** The publish pipe and the app migration. Gate: sync proven, as defined in Section 10 above.

**Step 4.** Venues: academy existence from affiliation directories whose terms allow it, hand-entered schedules for Mountain Grove, Salem, and neighboring academies, and the plain Session Times list.

**Step 5.** A Tier 2 model test before the Tier 2 build: 100 labeled pages extracted by Claude Opus 5 and Claude Sonnet 5, under $10 in total, reported as per-field accuracy; the founder chooses the model. Then Tier 2 extraction (a model key in Worker secrets only, with a spend cap) and the Tier 3 public form (CAPTCHA, rate limit, email verification).

Not yet decided: the date the founder reviews the first automatic-approval precision report, and the final reviewer roster for the console.

## 13. Out of scope for this repository

The member app, the member database, and any member data are out of scope here. No model call reachable by a member is ever routed through, or added to, this repository. This repository governs only ALMANAC's own Cloudflare Workers, its D1 databases, and its console.
