-- Terms review record: sjjif.com (Sport Jiu-Jitsu International Federation... SJJIF)
--
-- Ruled by the founder on 2026-09-26 (PR #33), on the evidence below, gathered
-- the same evening by the off-Smoothcomp research session (Claude Opus 5.5).
-- Verdict: not_allowed. Applying this file writes ONE row, inactive
-- (active = 0), and the gate refuses it on the verdict (field 9). Nothing in
-- this file lets the scout fetch anything.
--
-- Date fields hold America/Chicago calendar dates; evidence times are UTC.
--
-- Evidence. The only request this session sent to SJJIF, with the pinned user
-- agent from scout/src/identity.js. Time is UTC (the evening of 2026-09-26 in
-- America/Chicago).
--   2026-09-27T02:27:38Z  302  https://sjjif.com/robots.txt  0 bytes
--       Location: http://sjjif.com/login/auth  (recorded, not followed)
-- There is no robots file to hash: the host answers robots.txt with a
-- redirect to its login page. Nothing else was requested.
--
-- Apply (production, then staging):
--   npx wrangler d1 execute almanac --remote --config console/wrangler.toml --file scout/terms-reviews/sjjif.sql
--   npx wrangler d1 execute almanac-staging --remote --env staging --config console/wrangler.toml --file scout/terms-reviews/sjjif.sql

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
  'src-sjjif',
  'sjjif.com',
  1,
  NULL,
  'None. /robots.txt answered HTTP 302 to http://sjjif.com/login/auth (a login page); the redirect was recorded and not followed, and nothing else was requested.',

  NULL,
  'No terms page found in the search index.',
  NULL,

  'No robots.txt is served: /robots.txt redirects to the login page (HTTP 302, Location: http://sjjif.com/login/auth). No terms page was found. The sister host on the same platform, asjjf.org, disallows every path to every agent (see src-asjjf). Read together: the platform operator does not want automated visitors.',

  'Unknown: no terms page found.',

  NULL,
  'None found. Platform: SJJIF''s own, shared with ASJJF (one event number on both hosts in the search index). Public pages sit under /public/ (for example /public/eventInfo/1843); other paths redirect to a login. SJJIF''s national affiliates in Israel and Bulgaria run events on Smoothcomp (sjjif.smoothcomp.com, five upcoming events on smoothcomp.com''s public calendar read 2026-09-27, none in the US); the federation''s own and US events do not.',

  '["/login/","every page on this host until SJJIF grants written permission"]',
  NULL,
  NULL,
  NULL,
  '2026-09-26',

  'not_allowed',
  'NEEDS WRITTEN PERMISSION (recorded as not_allowed, the schema''s word). No robots file to honor, and a platform operator that says Disallow: / on its sister host: read that as no. US footprint is small: the search index of sjjif.com/championship shows one upcoming US event (Lake Elsinore, California, 2026-10-11). Not worth a request now; revisit only if members ask for SJJIF events. Ruled by the founder, 2026-09-26.',
  'paul.tokgozoglu@gmail.com',
  '2026-09-26',
  0
);
