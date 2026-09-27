-- Terms review record: www.jjworldleague.com (Jiu Jitsu World League, LLC... JJWL)
--
-- RESEARCH RECORD, NOT A FOUNDER RULING. Written by the 2026-09-26
-- off-Smoothcomp research session (Claude Opus 5.5) for the founder's review.
-- reviewed_by and reviewed_on stay NULL on purpose: field 10 names a human who
-- read the pages, and no human has yet. Applying this file writes ONE INACTIVE
-- row (active = 0). The gate refuses it twice over: no reviewer (field 10) and
-- the verdict (field 9). Nothing in this file lets the scout fetch anything.
--
-- Evidence. Every request this session sent to JJWL, with the pinned user
-- agent from scout/src/identity.js, each URL once, no redirect followed.
-- Times are UTC (the evening of 2026-09-26 in America/Chicago).
--   2026-09-27T02:27:37Z  200  https://www.jjworldleague.com/robots.txt  66 bytes
--       sha256 849d0ab8f52ea507fa9e59758efc18a8c92685875fe479eb36ace6ec4128679d
--   2026-09-27T02:29:30Z  200  https://www.jjworldleague.com/terms-of-service.php  20769 bytes
--       sha256 0f782a315410ad5841270defe94597e3ab9555f893b872b5805de82f7da9e74c
-- No event, registration, results or app page was requested.
--
-- Apply only after the founder has read the pages and filled reviewed_by and
-- reviewed_on (or changed the verdict):
--   npx wrangler d1 execute almanac --remote --config console/wrangler.toml --file scout/terms-reviews/jjwl.sql
--   npx wrangler d1 execute almanac-staging --remote --env staging --config console/wrangler.toml --file scout/terms-reviews/jjwl.sql

INSERT INTO sources (
  id, host, tier, parser, page_types,
  terms_url, terms_last_updated, terms_read_on,
  terms_automated_access, terms_reuse,
  login_required, official_api,
  excluded_paths, robots_disallowed, robots_crawl_delay_seconds, robots_sha256, robots_read_on,
  verdict, verdict_conditions, reviewed_by, reviewed_on, active
) VALUES (
  'src-jjwl',
  'www.jjworldleague.com',
  1,
  NULL,
  'None without JJWL''s written permission. Pages read for this review: /robots.txt and /terms-of-service.php. If JJWL grants permission, the permission letter defines the page types.',

  'https://www.jjworldleague.com/terms-of-service.php',
  'Not stated (no date is printed on the page).',
  '2026-09-27',

  'PROHIBITED. SECTION 12, Prohibited Uses: "In addition to other prohibitions as set forth in the Terms of Service, you are prohibited from using the site or its content: ... (i) to spam, phish, pharm, pretext, spider, crawl, or scrape; ...". Binding language, Overview: "These Terms of Service apply to all users of the site, including without limitation users who are browsers, vendors, customers, merchants, and/ or contributors of content." (whitespace normalized). WHAT THIS PROHIBITS: spidering, crawling and scraping the site, at any rate, whatever robots.txt says (robots.txt only closes /ajax/, /dynamic/ and /js/). WHAT IT DOES NOT SAY: nothing about compiling a database, nothing about linking, and no general ban on commercial use. These terms are narrower than IBJJF''s: they bar the machine, not the person.',

  'RESTRICTED. SECTION 2, General Conditions: "You agree not to reproduce, duplicate, copy, sell, resell or exploit any portion of the Service, use of the Service, or access to the Service or any contact on the website through which the service is provided, without express written permission by us." Lawyer question: whether a bare fact (an event''s name, date and city) is a "portion of the Service". Questions about the terms go to info@jjworldleague.com (SECTION 20).',

  0,
  'None found. No public API, feed or widget. JJWL publishes iOS and Android apps; their interfaces are private and out of bounds. Registration runs on JJWL''s own system: every competitor needs a JJWL account (search index of /jjwl/faq), and event pages live at /events/<slug> (search index, for example /events/worlds-2026-gi-adults). Platform: JJWL''s own, not Smoothcomp. Of the 1,687 events on smoothcomp.com''s public calendar read 2026-09-27, none is a JJWL event.',

  '["/ajax/","/dynamic/","/js/","/registration","registrations","brackets","results","athlete profiles","any page listing people","every page on this host until JJWL grants written permission"]',
  '["/ajax/","/dynamic/","/js/"]',
  NULL,
  '849d0ab8f52ea507fa9e59758efc18a8c92685875fe479eb36ace6ec4128679d',
  '2026-09-27',

  'not_allowed',
  'NEEDS WRITTEN PERMISSION (recorded as not_allowed, the schema''s word). Path: the founder''s permission request to info@jjworldleague.com. Until JJWL says yes: no spidering, crawling or scraping of any JJWL page or app, and no JJWL rows taken from third parties that republish JJWL''s calendar (BJJCompFinder, Jits.gg: see their records). A coach typing in one JJWL event the team is attending is not spidering, crawling or scraping; whether it is "copy ... any portion of the Service" is a lawyer question, low risk, and the founder''s call. Recommended by the 2026-09-26 research session; not yet ruled by the founder.',
  NULL,
  NULL,
  0
);
