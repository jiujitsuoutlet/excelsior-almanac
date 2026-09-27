-- Terms review record: asjjf.org (Asian Sport Jiu Jitsu Federation... ASJJF)
--
-- Ruled by the founder on 2026-09-26 (PR #33), on the evidence below, gathered
-- the same evening by the off-Smoothcomp research session (Claude Opus 5.5).
-- Verdict: not_allowed. Applying this file writes ONE row, inactive
-- (active = 0), and the gate refuses it on the verdict (field 9). Nothing in
-- this file lets the scout fetch anything.
--
-- Date fields hold America/Chicago calendar dates; evidence times are UTC.
--
-- Evidence. The only request this session sent to ASJJF, with the pinned user
-- agent from scout/src/identity.js. Time is UTC (the evening of 2026-09-26 in
-- America/Chicago).
--   2026-09-27T02:27:38Z  200  https://asjjf.org/robots.txt  25 bytes
--       sha256 efdb5938a9736727f5cce2b60355588e4fa541d19d022d222d8a09b8efd5dcce
-- robots.txt disallows every path, so no terms page was requested: looking for
-- one would itself break the file.
--
-- Apply (production, then staging):
--   npx wrangler d1 execute almanac --remote --config console/wrangler.toml --file scout/terms-reviews/asjjf.sql
--   npx wrangler d1 execute almanac-staging --remote --env staging --config console/wrangler.toml --file scout/terms-reviews/asjjf.sql

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
  'src-asjjf',
  'asjjf.org',
  1,
  NULL,
  'None. robots.txt disallows every path to every agent, so nothing past /robots.txt was requested.',

  NULL,
  'No terms page found in the search index, and robots.txt forbids looking further.',
  NULL,

  'robots.txt, in full: "User-agent: *" then "Disallow: /". WHAT THIS PROHIBITS: any automated request for any page on the host. No terms page was read.',

  'Unknown: no terms page found.',

  NULL,
  'None found. Platform: the federation''s own, not Smoothcomp. The same platform serves SJJIF: the search index shows one event number on both hosts, asjjf.org/main/eventInfo/1843 and sjjif.com/public/eventInfo/1843, both titled "Sjjif World Jiu Jitsu Championship 2026". Its event URLs use /main/eventInfo/<id>, not Smoothcomp''s /en/event/<id>. Contact named in the search index: support@asjjf.org.',

  '["/"]',
  '["/"]',
  NULL,
  'efdb5938a9736727f5cce2b60355588e4fa541d19d022d222d8a09b8efd5dcce',
  '2026-09-26',

  'not_allowed',
  'NOT ALLOWED: robots.txt says no to every automated agent. US relevance is near zero (ASJJF runs Asian events; SJJIF''s own record, src-sjjif, covers its US events). The only path is written permission, and it is not worth asking. Ruled by the founder, 2026-09-26.',
  'paul.tokgozoglu@gmail.com',
  '2026-09-26',
  0
);
