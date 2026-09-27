-- Terms review record: www.gripwirebjj.com (GripWire BJJ, a US events directory)
--
-- RESEARCH RECORD, NOT A FOUNDER RULING. Written by the 2026-09-26
-- off-Smoothcomp research session (Claude Opus 5.5) for the founder's review.
-- reviewed_by and reviewed_on stay NULL on purpose: field 10 names a human who
-- read the pages, and no human has yet. Applying this file writes ONE INACTIVE
-- row (active = 0). The gate refuses it (no reviewer, field 10). Nothing in
-- this file lets the scout fetch anything.
--
-- Evidence. Every request this session sent to GripWire, with the pinned user
-- agent from scout/src/identity.js, each URL once, no redirect followed.
-- Times are UTC (the evening of 2026-09-26 in America/Chicago).
--   2026-09-27T02:27:40Z  200  https://www.gripwirebjj.com/robots.txt  22 bytes
--       sha256 44f3f8eafdf064cf69acb05f23ee4dfc9ab5b3d67d81c64246bc29f7e438789a
--   2026-09-27T02:29:31Z  200  https://www.gripwirebjj.com/terms-and-conditions  73058 bytes
--       sha256 6509ed11a85408cac38f709b6e089b3909ebfa5dafb94fc1a1f5a9b646972b94
--   2026-09-27T02:41:22Z  200  https://www.gripwirebjj.com/ibjjf  332827 bytes
--       sha256 e01f94113a77343f0920c97d65ee0ab8892b5d2f645ff2b0f8afc56c1af3aada
--       (a plain request returns the page title and an empty shell; see page_types)
-- The terms text sits inside the page's embedded Softr block data, not in its
-- visible HTML; it was read from there.
--
-- Apply only after the founder has read the pages and filled reviewed_by and
-- reviewed_on (or changed the verdict):
--   npx wrangler d1 execute almanac --remote --config console/wrangler.toml --file scout/terms-reviews/gripwire.sql
--   npx wrangler d1 execute almanac-staging --remote --env staging --config console/wrangler.toml --file scout/terms-reviews/gripwire.sql

INSERT INTO sources (
  id, host, tier, parser, page_types,
  terms_url, terms_last_updated, terms_read_on,
  terms_automated_access, terms_reuse,
  login_required, official_api,
  excluded_paths, robots_disallowed, robots_crawl_delay_seconds, robots_sha256, robots_read_on,
  verdict, verdict_conditions, reviewed_by, reviewed_on, active
) VALUES (
  'src-gripwire',
  'www.gripwirebjj.com',
  1,
  NULL,
  'None by crawl. A plain request returns page shells only: the listings load in the browser from an Airtable base (appJREDRBe3wz9Kin, table Events) through the Softr app builder, so no plain-HTTP page carries event data. Calling those Softr or Airtable endpoints directly would be using a private interface, which the founder''s line forbids. The usable path is an export or shared view that GripWire chooses to give us.',

  'https://www.gripwirebjj.com/terms-and-conditions',
  'Last updated: 2025 (as printed; no day or month).',
  '2026-09-27',

  'None found. The terms (sections 1 to 10) cover listing accuracy, injury liability, photographer listings, user submissions, external links and intellectual property; none mentions automated access, crawling or scraping. robots.txt, in full: "User-agent: *" then "Allow: /".',

  'Content, not facts. Section 8: "All GripWire branding, logos, design elements, and written content are our property and may not be copied or reproduced without permission." Facts are none of those. Provenance, section 2: event details "are provided by promoters, gyms, organizations, or the general public".',

  0,
  'None public. GripWire publishes a dedicated IBJJF schedule page, /ibjjf, titled "IBJJF Tournaments & Brazilian Jiu-Jitsu Events | 2026 IBJJF Schedule (Updated Daily)", and event pages for off-Smoothcomp organizers (search index: for example Orbit Submission Series, which registers on TicketLeap). Contact: info@gripwirebjj.com.',

  '["every page until GripWire provides an export","any Softr or Airtable API endpoint","written content","branding","photographer listings"]',
  '[]',
  NULL,
  '44f3f8eafdf064cf69acb05f23ee4dfc9ab5b3d67d81c64246bc29f7e438789a',
  '2026-09-27',

  'allowed_with_conditions',
  'RECOMMENDED, NOT RULED. GripWire''s terms allow reading facts, but a plain request has nothing to read, so the only path is an export GripWire chooses to share (an Airtable shared view or CSV is the natural form). Conditions if that happens: 1) facts only (name, date, city, organizer, registration link), never GripWire''s written content or branding; 2) attribution to GripWire; 3) NEVER a source of IBJJF or JJWL rows until those organizers answer, because GripWire''s IBJJF facts come from IBJJF''s pages and would route around IBJJF''s own terms. Best use: the off-Smoothcomp tail (organizers on TicketLeap, NitroTickets and the like, who submit their own events to GripWire). Recommended by the 2026-09-26 research session; not yet ruled by the founder.',
  NULL,
  NULL,
  0
);
