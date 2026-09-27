-- Terms review record: jits.gg (Jits.gg, youth BJJ rankings and results)
--
-- RESEARCH RECORD, NOT A FOUNDER RULING. Written by the 2026-09-26
-- off-Smoothcomp research session (Claude Opus 5.5) for the founder's review.
-- reviewed_by and reviewed_on stay NULL on purpose: field 10 names a human who
-- read the pages, and no human has yet. Applying this file writes ONE INACTIVE
-- row (active = 0). The gate refuses it twice over: no reviewer (field 10) and
-- the verdict (field 9). Nothing in this file lets the scout fetch anything.
--
-- Evidence. The only request this session sent to Jits.gg, with the pinned
-- user agent from scout/src/identity.js. Time is UTC (the evening of
-- 2026-09-26 in America/Chicago).
--   2026-09-27T02:33:32Z  200  https://jits.gg/robots.txt  1311 bytes
--       sha256 8de269914ea33499692fc112245a9fe4fa1493eaa21cd9b8ee8ccbcefe0b11ba
-- No other page was requested: the verdict below does not depend on one.
--
-- Apply only after the founder has read the pages and filled reviewed_by and
-- reviewed_on (or changed the verdict):
--   npx wrangler d1 execute almanac --remote --config console/wrangler.toml --file scout/terms-reviews/jitsgg.sql
--   npx wrangler d1 execute almanac-staging --remote --env staging --config console/wrangler.toml --file scout/terms-reviews/jitsgg.sql

INSERT INTO sources (
  id, host, tier, parser, page_types,
  terms_url, terms_last_updated, terms_read_on,
  terms_automated_access, terms_reuse,
  login_required, official_api,
  excluded_paths, robots_disallowed, robots_crawl_delay_seconds, robots_sha256, robots_read_on,
  verdict, verdict_conditions, reviewed_by, reviewed_on, active
) VALUES (
  'src-jitsgg',
  'jits.gg',
  1,
  NULL,
  'None.',

  NULL,
  'No terms page found in the search index. A privacy policy exists at https://jits.gg/privacy (not read).',
  NULL,

  'No terms found. robots.txt lets generic agents read most pages but closes /api/, /academies/, /fighters/, /rankings and the account pages, and blocks many crawlers by name (among them ClaudeBot, anthropic-ai, GPTBot and CCBot).',

  'None found.',

  NULL,
  'None. Provenance, per the search index of its privacy page (not read directly): it republishes fighter names, academies, match results, belt ranks, age divisions and weight classes taken from organizers'' brackets, results pages and registration lists, and it names JJWL and IBJJF among those organizers.',

  '["every page"]',
  '["/admin/","/api/","/login","/signup/","/profile/","/scanner/","/dashboard/","/alerts/","/dev/","/academy/claim/","/claim/","/academies/","/fighters/","/rankings"]',
  NULL,
  '8de269914ea33499692fc112245a9fe4fa1493eaa21cd9b8ee8ccbcefe0b11ba',
  '2026-09-27',

  'not_allowed',
  'NOT ALLOWED on ALMANAC''s own law (ARCHITECTURE section 6: never participant data of any kind, never the name of any minor). The site''s business is youth rankings built from organizers'' brackets and registration lists, and its JJWL and IBJJF data would route around both organizers'' terms. Recommended by the 2026-09-26 research session; not yet ruled by the founder.',
  NULL,
  NULL,
  0
);
