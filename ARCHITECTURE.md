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

**Date conflicts are a permanent feature, not a bug to resolve away (founder ruling, 2026-09-16).** Independent sources will disagree about a date forever; the system's job is to surface the disagreement, never to guess which source is right. When two sources give different dates for what is otherwise the same event, the row carries both candidate dates and both source URLs, and a `date_conflicted` flag. A conflicted row is never auto-approved; it renders in the console as a conflict for a human to resolve by looking, exactly like any other row a human decides on. This field ships in the same schema change as the rest of Phase 2's additions.

**Division data can be unknown; the row is never dropped for it.** `divisions_unknown` is a legitimate, permanent state (see Section 10), not a placeholder for a later fix. It records which machine routes were tried.

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

**Challenges are never bypassed (permanent, founder ruling 2026-09-16).** A 403 or a bot challenge (Cloudflare's "Just a moment..." page and its kind) is a stop, not a puzzle. The scout never spoofs a browser, never solves or evades a challenge, never rotates its user agent to get past one. Not to test, not once, not on a five-minute basis, not permanently. One event page on an organizer subdomain returned exactly this challenge to the honest user agent on 2026-09-16; that result stands as the answer for those pages, and the crawler does not retry it differently.

### Search-based discovery (founder ruling, 2026-09-16)

A page a host refuses to serve the crawler may still be reachable through a search index, and that is a different act: reading what a search engine has already indexed is not a request to the host's own server, carries none of the load the crawl-delay law exists to bound, and is exactly what a person does by hand when they look a tournament up. This is not a workaround for the challenge above; it is a separate, permitted path with its own proof requirement, run once before it is trusted:

**The five-minute check, run 2026-09-16.** Searched several real, named Smoothcomp events by name plus city (Submission Challenge Branson MO, NEWBREED Springfield Fall Championship, Nebraska Jiu-Jitsu Championship Fall Open Lincoln, `site:fujibjj.smoothcomp.com` Missouri, `site:submissionchallenge.smoothcomp.com` 2025). **Result: the individual event pages themselves are indexed**, not only the organizer's listing page, and each returned a usable title/URL/date snippet. The check passed; search-based discovery works for these hosts as of this date.

**What it gives, and what it does not.** A search result gives the list: name, date, city, organizer, the URL, and often a one-line snippet. It does not give the division structure, entry requirements, or competitor counts that live in the page body behind the challenge. Discovery and division data are two different problems with two different answers: discovery runs on search, division structure runs on the organizer's own site (their rules page, FAQ, or rules PDF), never on the search snippet of a Smoothcomp page.

**The API.** Brave Search API, Search plan: $5 per 1,000 requests, 50 queries/second, no dedicated free tier as of 2026-02-12. At nine-state scale (roughly 35 tracked organizers, list-only queries a few times a week per organizer to catch new postings) monthly volume runs several hundred queries; at $5/1,000 that prices under $10/month even with generous headroom for date-conflict resolution and gap-filling. Brave's default terms prohibit storing, caching, or building a database from search results beyond transient use in serving the application; a separate "storage rights" plan exists for anyone who wants to retain raw results, with pricing not published. **ALMANAC does not need that plan.** The scout extracts facts (name, date, city, organizer, URL) from a result and discards the snippet immediately, the same discipline already locked in Section 8 for crawled pages: facts and source URLs only, never the page body, never copied prose. A discarded snippet used once to extract a fact is not "storing search results" under any of these terms.

## 10. Dormant/dropped organizers and the machine-only division law

**No human route, ever (founder ruling, 2026-09-16).** A division template is either read by machine from an organizer's own published page, PDF, or search-indexed snippet, or it is marked `divisions_unknown`. No future session may add "email the organizer," "ask a coach," or any other step that depends on a phone call, a human memory, or anyone's personal relationship. That includes the founder's own. The whole point of ALMANAC is that none of this depends on him being reachable.

Before an organizer's template is marked `divisions_unknown`, exhaust these routes, in this order, and record which ones were tried and failed:

1. The organizer's current rules/divisions page (rendered in a real browser, not a static fetch alone... a table that renders empty in JavaScript on a first pass is not proof it is empty; render it and wait before concluding).
2. The organizer's past-event pages and FAQ.
3. The organizer's own rules PDF, parsed with more than one tool if the first fails.
4. The search-index snippet for that organizer's rules page.

An organizer whose division data cannot be read by any of these is recorded with `divisions_unknown` and the routes that were tried. The matcher (proposed, not yet built) downranks such an event for a beginner rather than excluding it; a member is never told an event does not exist when it does, only that the fit is unconfirmed.

**Confirmed dropped, 2026-09-16 (do not re-add without a fresh check):**
- **Fight 2 Win (F2W).** Its current site is pro superfight cards by application only; no amateur tournament division structure exists on it. An old `/f2w-tournaments/` path 404s. Not an amateur-tournament organizer as of this date.
- **NUWAY Combat Expos / BJJ Fanatics Opens.** The organizer's own site now redirects to "Combat Life," whose content is youth wrestling only; no BJJ, NUWAY, or BJJ Fanatics reference remains anywhere on it. The BJJ Fanatics partnership that ran these events is not proven to still exist. Chewjitsu Open, which still runs on the `nuway.smoothcomp.com` federation, is unaffected by this and stays active.

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

## 11. Publish pipe contract

The publisher sends signed batches (an HMAC over the payload and a timestamp; old timestamps are refused) to the app's `almanac-ingest` edge function. That function re-validates every field (HTTPS links, ISO codes, dates, a source URL, a link check within 48 hours) and applies rows through a service-role-only database function, in one transaction, content then status, so `tournaments_demote_on_edit` is honored, never bypassed. Batches carry a row cap and a volume alert. Rotating one secret stops the pipe.

**Sync proven** means all seven of these hold, first on the app's staging project and then on the live project:

1. An approved ALMANAC row appears byte-identical in the app with its `almanac_id`.
2. A member session reads it in Fire.
3. Marking it stale in ALMANAC removes it from the member read within one publisher cycle.
4. A draft never crosses.
5. A member token's direct write is rejected server-side.
6. An unsigned or replayed ingest call is rejected.
7. A replayed batch creates no duplicates, and the nightly reconciliation shows matching counts and hashes on both sides.

## 12. Geocoding and places

The geocoder is OpenCage. Its results, including coordinates and a confidence score, may be stored permanently, unlike a Google result, whose terms allow caching for 30 days only. The place-name table is GeoNames cities500 (CC BY 4.0), with admin1 codes mapped to ISO 3166-2 subdivision parts before publishing; a place that cannot be mapped is not published. It is published into the app's `places` table.

Every surface, app or console, that shows ALMANAC place or location data carries this attribution line word for word: "Places: GeoNames (CC BY 4.0). Geocoding: © OpenStreetMap contributors.", linked to geonames.org and openstreetmap.org/copyright.

**Travel radius is the primary filter (founder ruling, 2026-09-16).** The ground-truth count for one twelve-month window read two different ways depending only on the radius drawn: southwest Missouri alone held 7 events; the whole state held 31. Neither number is wrong; they answer different questions, and the difference is entirely the radius, not the crawler's reach. A member's travel radius is therefore the first filter the matcher (proposed, not yet built) applies, before belt, before ruleset, before anything else... the crawler's actual value shows up once matching widens past a home region to nine-state and national scale, plus whatever the academies and open-mats layer adds. A radius too tight to test against is a radius too tight to trust; every distance claim here is proven against geocoded coordinates, never eyeballed from a state name.

## 13. Scout operating cost

**Deterministic (Tier 1) crawling costs zero model tokens.** Once a host's parser exists, the nightly run is plain code: fetch a page, run a parser, write facts. No model call happens anywhere in that path. The one-time cost was the research to build the organizer registry and the division templates (this document's Phase 2 work)... that expense does not recur.

**Search-based discovery costs real money, but a small, bounded amount.** See Section 9: Brave Search API at $5 per 1,000 requests, running under $10/month at nine-state scale even with generous headroom. This is the only per-query cost in the Tier 1 path.

**Tier 2 (model extraction) is the only place a per-event token cost exists**, and it stays off pending the measured precision report and the founder's dated ruling (Section 7). Its cost is not yet measured; the 100-labeled-page test (v2.55 decision) is what produces that number, separately.

## 14. Organizer registry additions (2026-09-16)

Six organizers confirmed real and operating in the nine-state footprint, found during the Phase 2 ground-truth count, not yet terms-reviewed or entered into the `sources` table:

- **United Grappling Championship**... regional circuit, Oklahoma City and other cities; Smoothcomp (`united.smoothcomp.com`).
- **Orbit Submission Series**... Cedar Rapids/Marion, IA superfight circuit. **First confirmed evidence of the off-platform tail**: registration runs on TicketLeap, not Smoothcomp, listed via GripWire. This is the shape Phase 1's discovery question was asking about; it is one data point, not yet a measured share.
- **Classic Combat**... Knoxville, TN; mixed kickboxing-and-grappling cards, Smoothcomp (`classiccombat.smoothcomp.com`).
- **Agoge Grappling Series**... Nashville/Murfreesboro/Lebanon, TN area.
- **Grappling Games' "GGC" series**... a pro/superfight subseries run by an organizer already terms-reviewed under its amateur Smoothcomp federation; the pro cards are a separate format, not yet reviewed.
- **Nebraska Jiu-Jitsu Championship's Elite Series**... ticketed superfight-style evening cards (NitroTickets), distinct from the organizer's main Smoothcomp tournament calendar.

None of these are active crawl targets. Each enters the crawl only after its own terms review, per Section 9's ten-field gate, same as every other host.

## 15. The twelve-month ground-truth count (2025-09-16 to 2026-09-16)

| State | Confirmed | Depth |
|---|---|---|
| Missouri | 31 | Full (organizer, division, entry type) |
| Illinois | 30 | List only |
| Tennessee | 32 | List only |
| Oklahoma | 14 | Full |
| Kentucky | 13 | List only |
| Iowa | 13 | List only |
| Arkansas | 6 (+2 cancelled) | Full |
| Nebraska | 9 | List only |
| Kansas | 3 | Full |
| **Total** | **151** | |

The prior estimate for this count was 180-220. **The shortfall is attributable only to the five list-only states** (Illinois, Iowa, Nebraska, Tennessee, Kentucky), where the per-agent search-API budget ran out partway through and the remainder of the research fell back to slower, narrower crawling of aggregator sites. **The four full-depth states (Missouri, Oklahoma, Arkansas, Kansas) are not budget-limited**... each ran its search budget to completion, cross-checked multiple independent sources, and caught real errors along the way (a mislabeled Missouri/Kansas boundary in both directions, two moved dates, three genuine cross-source date conflicts). Their numbers, Kansas's included, stand as a real count, not a partial one.

**Kansas is genuinely thin, not under-researched.** Every organizer already in the registry was checked to completion; the low count (3) reflects that most events branded "Kansas City" in this region are actually across the state line in Missouri (Hy-Vee Arena, KCI Expo Center, Apex Sports Hub)... confirmed this direction the same way the Missouri count caught a "Kansas City" listing that was really in Olathe, KS. The mislabeling runs both ways across that one metro boundary, and both directions are now checked.

**Two single-organizer gaps left open, not structural (founder ruling, 2026-09-16).** Community Clash (Kansas City, KS) has run at least three prior editions and a confirmed fourth in October 2026; the exact date of an in-window edition was not found by any machine route tried. Grappling Industries alternates its "Kansas City" event between Missouri and Kansas venues year to year; its confirmed 2026 Kansas edition (Olathe) falls just past this window, and whether an earlier in-window edition ran in Kansas or Missouri is unresolved. Both are recorded as known-thin and not pursued further; they are one organizer, one date each, not a method failure.

**The `divisions_unknown` standard applies permanently, not once.** The AGF gi-belt table and NAGA's 119-page rulebook were both wrongly headed for `divisions_unknown` after a first pass; a real browser render recovered AGF's table cleanly, and a different PDF parser recovered NAGA's rulebook in full. Neither gap was real... the first tool was the failure, not the organizer's page. Every future `divisions_unknown` determination exhausts a real-browser render and at least one alternate parser before it is recorded, every time, not only when this session happens to catch it.

## 16. Build sequence and gates

**Step 1.** This document, then the D1 schema, then the console, with geocoding on save. The founder hand-enters ten real events. Gate: an evidence gallery of each row beside its source page, plus rejection proofs for an anonymous caller and for a signed-in non-reviewer.

**Step 2.** Scout v1: Tier 1 only, Missouri and its eight bordering states, nightly, each host entered only after a recorded terms review. Gate: a first-week precision report per host. Nothing approves automatically.

**Step 3.** The publish pipe and the app migration. Gate: sync proven, as defined in Section 11 above.

**Step 4.** Venues: academy existence from affiliation directories whose terms allow it, hand-entered schedules for Mountain Grove, Salem, and neighboring academies, and the plain Session Times list.

**Step 5.** A Tier 2 model test before the Tier 2 build: 100 labeled pages extracted by Claude Opus 5 and Claude Sonnet 5, under $10 in total, reported as per-field accuracy; the founder chooses the model. Then Tier 2 extraction (a model key in Worker secrets only, with a spend cap) and the Tier 3 public form (CAPTCHA, rate limit, email verification).

Not yet decided: the date the founder reviews the first automatic-approval precision report, and the final reviewer roster for the console.

## 17. Out of scope for this repository

The member app, the member database, and any member data are out of scope here. No model call reachable by a member is ever routed through, or added to, this repository. This repository governs only ALMANAC's own Cloudflare Workers, its D1 databases, and its console.
