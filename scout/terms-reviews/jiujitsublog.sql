-- Terms review record: jiujitsublog.com (JiuJitsuBlog.com, a tournament and
-- academy directory)
--
-- Ruled by the founder on 2026-09-26 (PR #33), on the evidence below, gathered
-- the same evening by the off-Smoothcomp research session (Claude Opus 5.5).
-- Verdict: not_allowed. Applying this file writes ONE row, inactive
-- (active = 0), and the gate refuses it on the verdict (field 9). Nothing in
-- this file lets the scout fetch anything.
--
-- Date fields hold America/Chicago calendar dates; evidence times are UTC.
--
-- Evidence. Every request this session sent to JiuJitsuBlog, with the pinned
-- user agent from scout/src/identity.js, each URL once, no redirect followed.
-- Times are UTC (the evening of 2026-09-26 in America/Chicago).
--   2026-09-27T02:27:41Z  200  https://jiujitsublog.com/robots.txt  798 bytes
--       sha256 2419d445474c0aa1f819a8dcc1dcf7ad3e3544401028492e5dba97f75146639e
--   2026-09-27T02:29:32Z  200  https://jiujitsublog.com/  55300 bytes
--       (the homepage, read once to find the terms link, before the terms were known)
--   2026-09-27T02:32:10Z  200  https://jiujitsublog.com/terms  27985 bytes
--       sha256 4474c332837bbc68d60255bff15422438ca45c1b348ff4ae03c6e2c4f9ae0a8e
-- Nothing was requested after the terms were read.
--
-- Apply (production, then staging):
--   npx wrangler d1 execute almanac --remote --config console/wrangler.toml --file scout/terms-reviews/jiujitsublog.sql
--   npx wrangler d1 execute almanac-staging --remote --env staging --config console/wrangler.toml --file scout/terms-reviews/jiujitsublog.sql

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
  'src-jiujitsublog',
  'jiujitsublog.com',
  1,
  NULL,
  'None without written permission.',

  'https://jiujitsublog.com/terms',
  'Last updated: July 2026 (as printed).',
  '2026-09-26',

  'PROHIBITED. User Conduct: "When using our Site, you agree not to:" ... "Scrape or collect data from the Site without permission". robots.txt says "Allow: /" to every agent, but the terms control: robots.txt is a crawler courtesy, the terms are the contract.',

  'RESTRICTED. Use of Content: "You may not reproduce, distribute, or republish any content without our prior written consent." Provenance, Disclaimer: "Tournament information: Event details (dates, fees, locations) are sourced from third-party providers".',

  0,
  'None found. Tournament sitemaps are published for search engines (sitemap-tournaments.xml and sitemap-tournament-details.xml, listed in robots.txt); they were not read. Contact: info@jiujitsublog.com.',

  '["every page without written permission"]',
  '[]',
  NULL,
  '2419d445474c0aa1f819a8dcc1dcf7ad3e3544401028492e5dba97f75146639e',
  '2026-09-26',

  'not_allowed',
  'NOT ALLOWED without written permission, and not worth asking: its tournament data is itself "sourced from third-party providers", so for IBJJF and JJWL it carries the same provenance problem as BJJCompFinder. The homepage read made before the terms (see the header) is accepted this once, because it was disclosed; from now on research reads follow Scout''s crawl law, and a site''s terms are read before anything else on it. Ruled by the founder, 2026-09-26.',
  'paul.tokgozoglu@gmail.com',
  '2026-09-26',
  0
);
