-- Terms review record: www.bjjcompfinder.com (BJJCompFinder, a worldwide
-- tournament aggregator)
--
-- Ruled by the founder on 2026-09-26 (PR #33), on the evidence below, gathered
-- the same evening by the off-Smoothcomp research session (Claude Opus 5.5).
-- Verdict: not_allowed. Applying this file writes ONE row, inactive
-- (active = 0), and the gate refuses it on the verdict (field 9). Nothing in
-- this file lets the scout fetch anything.
--
-- Date fields hold America/Chicago calendar dates; evidence times are UTC.
--
-- Evidence. Every request this session sent to BJJCompFinder, with the pinned
-- user agent from scout/src/identity.js, each URL once, no redirect followed,
-- at least 10 seconds apart. Times are UTC (the evening of 2026-09-26 in
-- America/Chicago).
--   2026-09-27T02:27:41Z  200  /robots.txt  24 bytes
--       sha256 e5c4b84484ee4216e9373be99380320c25dd94805f99f0a805846f087636553f
--   2026-09-27T02:29:33Z  200  /  (homepage, to look for a terms link: none)
--   2026-09-27T02:35:02Z  200  /tournaments/united-states
--   2026-09-27T02:36:48Z  200  /organizers
--   2026-09-27T02:37:24Z to 02:38:08Z  200  /organizer/ibjjf, pages 1 to 5
--   2026-09-27T02:38:46Z  200  /organizer/jjwl
--   2026-09-27T02:38:57Z and 02:39:26Z  200  /organizer/jjwl/past-tournaments, pages 1 and 2
--   2026-09-27T02:39:08Z to 02:39:48Z  200  /organizer/ajp, pages 1 to 3
-- These reads sized the market for the founder's report (how many US events
-- IBJJF, JJWL and AJP run against Smoothcomp). Nothing read was written to
-- ALMANAC. Full URLs and body hashes are in the session's fetch log.
--
-- Apply (production, then staging):
--   npx wrangler d1 execute almanac --remote --config console/wrangler.toml --file scout/terms-reviews/bjjcompfinder.sql
--   npx wrangler d1 execute almanac-staging --remote --env staging --config console/wrangler.toml --file scout/terms-reviews/bjjcompfinder.sql

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
  'src-bjjcompfinder',
  'www.bjjcompfinder.com',
  1,
  NULL,
  'None for ALMANAC rows. The pages listed in this file''s header were read once, on 2026-09-26, to size the market, and nothing from them was stored.',

  NULL,
  'No terms page found: neither the homepage nor the organizer pages link one, and the search index shows none.',
  '2026-09-26',

  'None found (no terms). robots.txt, in full: "User-agent: *" then "Disallow:" (an empty Disallow, which allows everything).',

  'None found (no terms).',

  0,
  'None. Provenance, in the site''s own words on its homepage: "updated daily from every major tournament website". Its IBJJF listings therefore come from ibjjf.com, whose terms forbid exactly that.',

  '["every page, for ALMANAC rows"]',
  '[]',
  NULL,
  'e5c4b84484ee4216e9373be99380320c25dd94805f99f0a805846f087636553f',
  '2026-09-26',

  'not_allowed',
  'NOT ALLOWED as an ALMANAC source, on provenance, not on its own terms (it has none). Reading its copy of IBJJF''s or JJWL''s calendar would be the prohibited act routed through a third party, which the founder''s line counts as circumvention. For Smoothcomp organizers it adds nothing ALMANAC cannot already read. Its one legitimate use was the market-size count recorded in the header, and it stays a measuring stick, never a data source. The reads recorded in the header are accepted this once, because they were disclosed; from now on research reads follow Scout''s crawl law, and a site''s terms are read before anything else on it. Ruled by the founder, 2026-09-26.',
  'paul.tokgozoglu@gmail.com',
  '2026-09-26',
  0
);
