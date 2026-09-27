-- Terms review record: www.flograppling.com (FloSports, Inc... FloGrappling)
--
-- RESEARCH RECORD, NOT A FOUNDER RULING, AND INCOMPLETE: the terms text could
-- not be read by an honest plain request (see field 3). Written by the
-- 2026-09-26 off-Smoothcomp research session (Claude Opus 5.5) for the
-- founder's review. reviewed_by and reviewed_on stay NULL on purpose.
-- Applying this file writes ONE INACTIVE row (active = 0). The gate refuses it
-- twice over: no reviewer (field 10) and the verdict (field 9). Nothing in
-- this file lets the scout fetch anything.
--
-- Evidence. Every request this session sent to FloSports hosts, with the
-- pinned user agent from scout/src/identity.js, each URL once, no redirect
-- followed. Times are UTC (the evening of 2026-09-26 in America/Chicago).
--   2026-09-27T02:27:42Z  200  https://www.flograppling.com/robots.txt  778 bytes
--       sha256 a3a0d73cce1cfc5fb16d884516750ceb36ccc8e4422edaf7a0c13e7bfd2f8a84
--   2026-09-27T02:29:32Z  200  https://www.flosports.tv/robots.txt  70 bytes ("Allow: /")
--   2026-09-27T02:32:11Z  200  https://www.flosports.tv/terms-of-service  14591 bytes
--       an Angular page shell; the terms text is loaded by JavaScript and is
--       not in the response
-- The terms were not rendered in a browser: that would mean running the page
-- as a browser, and this session sends only the honest bot identity.
--
-- Apply only after the founder has read the pages and filled reviewed_by and
-- reviewed_on (or changed the verdict):
--   npx wrangler d1 execute almanac --remote --config console/wrangler.toml --file scout/terms-reviews/flograppling.sql
--   npx wrangler d1 execute almanac-staging --remote --env staging --config console/wrangler.toml --file scout/terms-reviews/flograppling.sql

INSERT INTO sources (
  id, host, tier, parser, page_types,
  terms_url, terms_last_updated, terms_read_on,
  terms_automated_access, terms_reuse,
  login_required, official_api,
  excluded_paths, robots_disallowed, robots_crawl_delay_seconds, robots_sha256, robots_read_on,
  verdict, verdict_conditions, reviewed_by, reviewed_on, active
) VALUES (
  'src-flograppling',
  'www.flograppling.com',
  1,
  NULL,
  'None.',

  'https://www.flosports.tv/terms-of-service',
  'Unknown: the terms page renders only with JavaScript, and the honest plain request returned the page shell with no terms text.',
  NULL,

  'UNVERIFIED BY THIS REVIEW, PROBABLY PROHIBITED. The search index describes the FloSports Terms of Service as prohibiting the use of any robot, spider or other automatic means to access the services for any purpose, including scraping. That is a paraphrase from the index, not a verbatim quote. A person must read the clause in a browser before this field is final. robots.txt lets generic agents read event and article pages, and blocks several AI crawlers by name.',

  'Unverified (see field 3).',

  NULL,
  'None public for third parties. FloGrappling streams IBJJF championships and publishes event pages for the ones it streams (search index: for example the 2025 American National IBJJF Jiu-Jitsu Open Championship).',

  '["every page"]',
  '["/generic","/var","/person","/photoalbum","/pay","/thank-you","/plans","/create-account","/account/choose-favorites","/collections/tag/*","/nextgen/"]',
  NULL,
  'a3a0d73cce1cfc5fb16d884516750ceb36ccc8e4422edaf7a0c13e7bfd2f8a84',
  '2026-09-27',

  'not_allowed',
  'NOT ALLOWED until a person reads the clause, and probably not after: even if the clause were narrow, Flo covers only the championships it streams, and its IBJJF facts come from IBJJF. Recommended by the 2026-09-26 research session; not yet ruled by the founder.',
  NULL,
  NULL,
  0
);
