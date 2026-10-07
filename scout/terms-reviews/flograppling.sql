-- Terms review record: www.flograppling.com (FloSports, Inc... FloGrappling)
--
-- Ruled by the founder on 2026-09-26 (PR #33), on the evidence below, gathered
-- the same evening by the off-Smoothcomp research session (Claude Opus 5.5).
-- Verdict: not_allowed. The clause itself is still unverified: the terms text
-- could not be read by an honest plain request (see field 3). Applying this
-- file writes ONE row, inactive (active = 0), and the gate refuses it on the
-- verdict (field 9). Nothing in this file lets the scout fetch anything.
--
-- Date fields hold America/Chicago calendar dates; evidence times are UTC.
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
-- Apply (production, then staging):
--   npx wrangler d1 execute almanac --remote --config console/wrangler.toml --file scout/terms-reviews/flograppling.sql
--   npx wrangler d1 execute almanac-staging --remote --env staging --config console/wrangler.toml --file scout/terms-reviews/flograppling.sql

-- The reviewer must exist before a review can name them (foreign key).
INSERT OR IGNORE INTO reviewers (email, role) VALUES ('paul.tokgozoglu@gmail.com', 'admin');

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
  '2026-09-26',

  'not_allowed',
  'NOT ALLOWED until a person reads the clause, and probably not after: even if the clause were narrow, Flo covers only the championships it streams, and its IBJJF facts come from IBJJF. Ruled by the founder, 2026-09-26.',
  'paul.tokgozoglu@gmail.com',
  '2026-09-26',
  0
);
