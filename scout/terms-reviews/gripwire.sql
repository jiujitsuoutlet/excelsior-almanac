-- Terms review record: www.gripwirebjj.com (GripWire BJJ, a US events directory)
--
-- Ruled by the founder on 2026-09-26 (PR #33), on the evidence below, gathered
-- the same evening by the off-Smoothcomp research session (Claude Opus 5.5).
-- Verdict: allowed_with_conditions, for an export GripWire chooses to share,
-- never a crawl. Applying this file writes ONE row, inactive (active = 0). The
-- record is complete, so the gate's only refusal is the inactive flag; nothing
-- crawls it regardless (no alias, no parser), and activation is a separate
-- founder step. Nothing in this file lets the scout fetch anything.
--
-- Date fields hold America/Chicago calendar dates; evidence times are UTC.
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
-- Apply (production, then staging):
--   npx wrangler d1 execute almanac --remote --config console/wrangler.toml --file scout/terms-reviews/gripwire.sql
--   npx wrangler d1 execute almanac-staging --remote --env staging --config console/wrangler.toml --file scout/terms-reviews/gripwire.sql

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
  'src-gripwire',
  'www.gripwirebjj.com',
  1,
  NULL,
  'None by crawl. A plain request returns page shells only: the listings load in the browser from an Airtable base (appJREDRBe3wz9Kin, table Events) through the Softr app builder, so no plain-HTTP page carries event data. Calling those Softr or Airtable endpoints directly would be using a private interface, which the founder''s line forbids. The usable path is an export or shared view that GripWire chooses to give us.',

  'https://www.gripwirebjj.com/terms-and-conditions',
  'Last updated: 2025 (as printed; no day or month).',
  '2026-09-26',

  'None found. The terms (sections 1 to 10) cover listing accuracy, injury liability, photographer listings, user submissions, external links and intellectual property; none mentions automated access, crawling or scraping. robots.txt, in full: "User-agent: *" then "Allow: /".',

  'Content, not facts. Section 8: "All GripWire branding, logos, design elements, and written content are our property and may not be copied or reproduced without permission." Facts are none of those. Provenance, section 2: event details "are provided by promoters, gyms, organizations, or the general public".',

  0,
  'None public. GripWire publishes a dedicated IBJJF schedule page, /ibjjf, titled "IBJJF Tournaments & Brazilian Jiu-Jitsu Events | 2026 IBJJF Schedule (Updated Daily)", and event pages for off-Smoothcomp organizers (search index: for example Orbit Submission Series, which registers on TicketLeap). Contact: info@gripwirebjj.com.',

  '["every page until GripWire provides an export","any Softr or Airtable API endpoint","written content","branding","photographer listings"]',
  '[]',
  NULL,
  '44f3f8eafdf064cf69acb05f23ee4dfc9ab5b3d67d81c64246bc29f7e438789a',
  '2026-09-26',

  'allowed_with_conditions',
  'GripWire''s terms allow reading facts, but a plain request has nothing to read, so the only path is an export GripWire chooses to share (an Airtable shared view or CSV is the natural form). Conditions if that happens: 1) facts only (name, date, city, organizer, registration link), never GripWire''s written content or branding; 2) attribution to GripWire; 3) only organizers whose own terms allow their events to be collected, so GripWire must say where each listing comes from before any is used (the export request asking exactly that went to info@gripwirebjj.com on 2026-10-04, Gmail message 1a109f9cb5a2729d; answer pending); 4) NEVER IBJJF or JJWL rows from GripWire, whatever those organizers answer, because GripWire''s IBJJF facts come from IBJJF''s pages and would route around IBJJF''s own terms (IBJJF and JJWL rows come only from the organizers themselves). Best use: the off-Smoothcomp tail (organizers on TicketLeap, NitroTickets and the like, who submit their own events to GripWire). Ruled by the founder, 2026-09-26.',
  'paul.tokgozoglu@gmail.com',
  '2026-09-26',
  0
);
