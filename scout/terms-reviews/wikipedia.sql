-- Terms review record: en.wikipedia.org (Wikimedia Foundation)
--
-- RESEARCH RECORD, NOT A FOUNDER RULING. Written by the 2026-09-26
-- off-Smoothcomp research session (Claude Opus 5.5) for the founder's review.
-- reviewed_by and reviewed_on stay NULL on purpose: field 10 names a human who
-- read the pages, and no human has yet. Applying this file writes ONE INACTIVE
-- row (active = 0). The gate refuses it (no reviewer, field 10). Nothing in
-- this file lets the scout fetch anything.
--
-- Evidence. Every request this session sent to Wikimedia hosts, with the
-- pinned user agent from scout/src/identity.js, each URL once, no redirect
-- followed. Times are UTC (the evening of 2026-09-26 in America/Chicago).
--   2026-09-27T02:32:11Z  200  https://en.wikipedia.org/robots.txt  28275 bytes
--       sha256 48b98d80c8444d37cdf50cc9a4d2257b66039477e581066d2356062a4cbd678f
--   2026-09-27T02:32:12Z  200  https://foundation.wikimedia.org/robots.txt  15261 bytes
--   2026-09-27T02:33:00Z  200  https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use  152798 bytes
--       sha256 1b4432cb0ea4ee9ea56b19681f015574c5cd9fc12731ed676e3243dcfaf13938
-- Disclosed: the two robots.txt reads landed one second apart on two hosts of
-- the same company (the research wrapper spaced requests per hostname, not
-- per company). No article was requested.
--
-- Apply only after the founder has read the pages and filled reviewed_by and
-- reviewed_on (or changed the verdict):
--   npx wrangler d1 execute almanac --remote --config console/wrangler.toml --file scout/terms-reviews/wikipedia.sql
--   npx wrangler d1 execute almanac-staging --remote --env staging --config console/wrangler.toml --file scout/terms-reviews/wikipedia.sql

INSERT INTO sources (
  id, host, tier, parser, page_types,
  terms_url, terms_last_updated, terms_read_on,
  terms_automated_access, terms_reuse,
  login_required, official_api,
  excluded_paths, robots_disallowed, robots_crawl_delay_seconds, robots_sha256, robots_read_on,
  verdict, verdict_conditions, reviewed_by, reviewed_on, active
) VALUES (
  'src-wikipedia',
  'en.wikipedia.org',
  1,
  NULL,
  'If the founder activates it: individual article pages (/wiki/<title>) for championships that have one, facts only. No article was requested for this review.',

  'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use',
  'The current Terms of Use have been in force since 2023-06-07 (the page lists the previous version as effective "until June 7, 2023"); the page was last edited 21 February 2026.',
  '2026-09-27',

  'ALLOWED WITH LIMITS. The Terms of Use prohibit "Engaging in automated uses of the Project Websites that are abusive or disruptive of the services, violate acceptable usage policies where available, or have not been approved by the Wikimedia community;". API use: "By using our APIs, you agree to abide by all applicable policies governing the use of the APIs, which include but are not limited to the User-Agent Policy, the Robot Policy, and the API:Etiquette". The User-Agent Policy (not read this session) asks for an agent that names itself and gives contact details; the pinned agent does both. robots.txt opens /wiki/ articles to generic agents and closes /w/, /api/ and many maintenance paths to crawlers.',

  'ALLOWED. "Please note that these licenses do allow commercial uses of your contributions, as long as such uses are compliant with the terms of the respective licenses. Where you own Sui Generis Database Rights covered by CC BY-SA 4.0, you waive these rights. As an example, this means facts you contribute to the projects may be reused freely without attribution." Article text is CC BY-SA 4.0 (and GFDL); ALMANAC copies no text, only facts.',

  0,
  'Yes: the MediaWiki and REST APIs, bound by the User-Agent Policy, the Robot Policy and API:Etiquette, which the Terms of Use incorporate. Coverage, from the search index: articles exist for the Pan, Pan No-Gi, World, World No-Gi and World Master IBJJF championships, and none was seen for JJWL.',

  '["/w/","/api/","/wiki/Special:","user pages","talk pages","article text"]',
  '["/w/","/api/","/trap/","/wiki/Special:","and many project-maintenance paths; see the hashed file"]',
  NULL,
  '48b98d80c8444d37cdf50cc9a4d2257b66039477e581066d2356062a4cbd678f',
  '2026-09-27',

  'allowed_with_conditions',
  'RECOMMENDED, NOT RULED. Clean but thin: Wikipedia covers only a handful of flagship IBJJF championships, often without the next edition''s date until close to the event, and none of the regional Opens a traveling member actually enters. Conditions: 1) article pages only, 10 seconds or more between requests; 2) facts only, never article text; 3) a member-facing row still links to the organizer''s page, so an IBJJF row sourced here waits on IBJJF''s answer about linking (see src-ibjjf). Recommended by the 2026-09-26 research session; not yet ruled by the founder.',
  NULL,
  NULL,
  0
);
