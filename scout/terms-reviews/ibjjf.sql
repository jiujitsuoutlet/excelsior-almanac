-- Terms review record: ibjjf.com (International BJJ, Inc... the IBJJF)
--
-- RESEARCH RECORD, NOT A FOUNDER RULING. Written by the 2026-09-26
-- off-Smoothcomp research session (Claude Opus 5.5) for the founder's review.
-- reviewed_by and reviewed_on stay NULL on purpose: field 10 names a human who
-- read the pages, and no human has yet. Applying this file writes ONE INACTIVE
-- row (active = 0). The gate refuses it twice over: no reviewer (field 10) and
-- the verdict (field 9). Nothing in this file lets the scout fetch anything.
--
-- Evidence. Every request this session sent to IBJJF hosts, with the pinned
-- user agent from scout/src/identity.js, each URL once, no redirect followed.
-- Times are UTC (the evening of 2026-09-26 in America/Chicago).
--   2026-09-27T02:27:36Z  200  https://ibjjf.com/robots.txt  104 bytes
--       sha256 f1298157184ebf7245591840bf9c7811f11115e3b95d85d94e3dc7ba9df55ab4
--   2026-09-27T02:27:36Z  200  https://learning.ibjjf.com/robots.txt  211 bytes
--       sha256 92995ca8cf185983d9aefd365020d1ec1493544d3d4850b74759c1e7cb38ff6d
--   2026-09-27T02:29:28Z  200  https://ibjjf.com/app-privacy-policy  49865 bytes
--       read only to find the site footer, which links "Terms of Use" to /terms-of-use
--   2026-09-27T02:29:29Z  200  https://learning.ibjjf.com/terms  431026 bytes
--       sha256 87a47c09c3ff8dee582e919ff989336af971867db25979e5f6eb54d368c8855e
--   2026-09-27T02:29:54Z  200  https://ibjjf.com/terms-of-use  72913 bytes
--       sha256 49fcc21655ea2c9ffbfed6e35ad633d13421e76c8a2c5317f385c0b79623d8c0
-- No calendar, event, results, ranking, academy or registration page was
-- requested, and nothing was requested from ibjjfdb.com or the IBJJF app.
--
-- Apply only after the founder has read the pages and filled reviewed_by and
-- reviewed_on (or changed the verdict):
--   npx wrangler d1 execute almanac --remote --config console/wrangler.toml --file scout/terms-reviews/ibjjf.sql
--   npx wrangler d1 execute almanac-staging --remote --env staging --config console/wrangler.toml --file scout/terms-reviews/ibjjf.sql

INSERT INTO sources (
  id, host, tier, parser, page_types,
  terms_url, terms_last_updated, terms_read_on,
  terms_automated_access, terms_reuse,
  login_required, official_api,
  excluded_paths, robots_disallowed, robots_crawl_delay_seconds, robots_sha256, robots_read_on,
  verdict, verdict_conditions, reviewed_by, reviewed_on, active
) VALUES (
  'src-ibjjf',
  'ibjjf.com',
  1,
  NULL,
  'None. Nothing on ibjjf.com may be fetched without IBJJF''s written permission. Pages read for this review: /robots.txt, /app-privacy-policy (only to find the footer link to the terms) and /terms-of-use, plus learning.ibjjf.com/robots.txt and learning.ibjjf.com/terms. If IBJJF grants permission, the permission letter defines the page types.',

  'https://ibjjf.com/terms-of-use',
  'Last updated October 6th 2025 (as printed on the page). Also read: https://learning.ibjjf.com/terms, the Rules Course site''s own Terms and Conditions (no date printed).',
  '2026-09-27',

  'PROHIBITED, in four places. Section 3, User Representations: "(3) you will not access the Services through automated or non-human means, whether through a bot, script or otherwise". Section 4, Prohibited Activities: "Systematically retrieve data or other content from the Services to create or compile, directly or indirectly, a collection, compilation, database, or directory without written permission from us." ... "Engage in any automated use of the system, such as using scripts to send comments or messages, or using any data mining, robots, or similar data gathering and extraction tools." ... "Except as may be the result of standard search engine or Internet browser usage, use, launch, develop, or distribute any automated system, including without limitation, any spider, robot, cheat utility, scraper, or offline reader that accesses the Services, or use or launch any unauthorized script or other software." Section 4 also: "Engage in unauthorized framing of or linking to the Services." Binding language, preamble: "You agree that by accessing the Services, you have read, understood, and agreed to be bound by all of these Legal Terms." WHAT THIS PROHIBITS: any bot or script on any IBJJF page at any rate, and (because the compile clause is not limited to bots) a person systematically copying IBJJF''s calendar into a database. The only carve-out is standard search engine or browser usage, which describes search engines and people browsing, not a data product. WHAT IT DOES NOT CLEARLY REACH (lawyer questions): (a) whether a plain link from a member app to a public championship page is "unauthorized ... linking"; (b) whether a coach entering one event the team is attending is "systematic" retrieval. A drafting gap does not help us: the Services definition reads "We operate , as well as any other related products and services that refer or link to these legal terms", but every ibjjf.com page links these terms in its footer. robots.txt allows everything except /admin and /wp-content/*, so robots is not the barrier; the terms are.',

  'RESTRICTED. Section 2: "The Content and Marks are provided in or through the Services "AS IS" for your personal, non-commercial use or internal business purpose only." ... "Except as set out in this section or elsewhere in our Legal Terms, no part of the Services and no Content or Marks may be copied, reproduced, aggregated, republished, uploaded, posted, publicly displayed, encoded, translated, transmitted, distributed, sold, licensed, or otherwise exploited for any commercial purpose whatsoever, without our express prior written permission." Section 4: "The Services may not be used in connection with any commercial endeavors except those that are specifically endorsed or approved by us." and "Use the Services as part of any effort to compete with us or otherwise use the Services and/or the Content for any revenue-generating endeavor or commercial enterprise." The permission channel is named in Section 2: "please address your request to: ibjjf@ibjjf.com", and a grant carries one condition: "you must identify us as the owners or licensors of the Services, Content, or Marks". Bare facts (name, date, city) are not copyrightable in the US, but these clauses bind by contract, and after this review we have actual notice of them. The Rules Course terms add, clause 4.2: "you may not reproduce, copy, distribute, store or in any other fashion re-use material from the Website unless otherwise indicated on the Website or unless given Our express written permission to do so", define "Website" to include "any sub or main-domains of this site (www.ibjjf.com) unless expressly excluded by their own terms and conditions", and state: "Deep linking (i.e. links to specific pages within the site) requires Our express written permission."',

  0,
  'None found. No public API, calendar feed (iCal or RSS), embeddable widget or data-partner program appears on the pages read or in the search index. IBJJF publishes a mobile app; its interfaces are private and out of bounds (the terms prohibit reverse engineering, and so does the founder''s line). Registration runs on IBJJF''s own system, www.ibjjfdb.com and app.ibjjfdb.com, behind a login that requires IBJJF membership (the site footer''s Login link points to app.ibjjfdb.com/auth/login). Platform: IBJJF''s own, not Smoothcomp. Of the 1,687 events on smoothcomp.com''s public calendar read 2026-09-27, none is organized by IBJJF (four titles mention IBJJF only as a ruleset, all outside the US), and ibjjff.smoothcomp.com is a different organizer (Brave Kids).',

  '["/admin","/wp-content/","/events/results","/2026-athletes-ranking","/2026-academies-ranking","/certified-black-belts","/registered-academies","/hall-of-fame","registrations","brackets","results","athlete profiles","any page listing people","every page on this host until IBJJF grants written permission"]',
  '["/admin","/wp-content/*"]',
  NULL,
  'f1298157184ebf7245591840bf9c7811f11115e3b95d85d94e3dc7ba9df55ab4',
  '2026-09-27',

  'not_allowed',
  'NEEDS WRITTEN PERMISSION (the schema has no such verdict word, so it is recorded as not_allowed). Path: the founder''s permission request to ibjjf@ibjjf.com, the address the terms themselves name. Until IBJJF says yes in writing: 1) no automated request of any kind to ibjjf.com, learning.ibjjf.com, ibjjfdb.com or the IBJJF app; 2) no human transcription of IBJJF''s calendar into ALMANAC, because the compile clause is not limited to bots; 3) no IBJJF rows taken from third parties that republish IBJJF''s calendar (BJJCompFinder, JiuJitsuBlog, Jits.gg, GripWire: see their records), because that is the same prohibited act routed through someone else; 4) hold IBJJF rows entirely, including Wikipedia-sourced ones (src-wikipedia), because every member-facing row links to ibjjf.com and the linking clause is unresolved. If IBJJF does not answer, ask a lawyer about the linking clause before any IBJJF row reaches a member. Recommended by the 2026-09-26 research session; not yet ruled by the founder.',
  NULL,
  NULL,
  0
);
