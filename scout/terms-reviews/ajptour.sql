-- Terms review record: ajptour.com (Abu Dhabi Jiu Jitsu Pro... AJP, the UAE
-- Jiu-Jitsu Federation's tour), a white-labeled Smoothcomp host
--
-- RESEARCH RECORD, NOT A FOUNDER RULING. Written by the 2026-09-26
-- off-Smoothcomp research session (Claude Opus 5.5) for the founder's review.
-- reviewed_by and reviewed_on stay NULL on purpose: field 10 names a human who
-- read the pages, and no human has yet. Applying this file writes ONE INACTIVE
-- row (active = 0). The gate refuses it (no reviewer, field 10). Nothing in
-- this file lets the scout fetch anything.
--
-- Evidence. Every request this session sent to Smoothcomp-platform hosts, with
-- the pinned user agent from scout/src/identity.js, each URL once, no redirect
-- followed. Times are UTC (the evening of 2026-09-26 in America/Chicago).
--   2026-09-27T02:27:39Z  200  https://ajptour.com/robots.txt  126 bytes
--       sha256 312e3e13bb11b8d626a95305dce10dc6115d866d07215ad30ecd6c805e362701
--   2026-09-27T02:27:39Z  200  https://events.uaejjf.org/robots.txt  126 bytes
--       sha256 312e3e13bb11b8d626a95305dce10dc6115d866d07215ad30ecd6c805e362701
--   2026-09-27T02:29:30Z  404  https://ajptour.com/en/agreements  3368 bytes
--   2026-09-27T02:33:31Z  200  https://ajptour.com/en/about-us/terms-of-service  41960 bytes
--       sha256 9ad1576833947198b1d5abd04cf3b857dd94b3331023cd50c85030e162cf1bf9
--   2026-09-27T02:35:03Z  200  https://smoothcomp.com/en/events/upcoming  1246990 bytes
--       (read under src-smoothcomp's recorded review, to count events; see below)
--   2026-09-27T02:44:52Z  200  https://ajptour.com/en/ajp-terms-and-conditions  37550 bytes
--       sha256 ff43a921336546ec3f2897ead4006ac11b030b7f32d739e28f16a40c5d16f15e
-- Disclosed: the first two requests landed in the same second on two hosts
-- that turned out to be the same company's platform. The research wrapper
-- spaced requests per hostname, not per company, so section 9 rule 3 (one
-- clock per company) was not honored for that one pair of robots.txt reads.
-- No event, listing, registration or results page on ajptour.com or
-- events.uaejjf.org was requested.
--
-- Apply only after the founder has read the pages and filled reviewed_by and
-- reviewed_on (or changed the verdict):
--   npx wrangler d1 execute almanac --remote --config console/wrangler.toml --file scout/terms-reviews/ajptour.sql
--   npx wrangler d1 execute almanac-staging --remote --env staging --config console/wrangler.toml --file scout/terms-reviews/ajptour.sql

INSERT INTO sources (
  id, host, tier, parser, page_types,
  terms_url, terms_last_updated, terms_read_on,
  terms_automated_access, terms_reuse,
  login_required, official_api,
  excluded_paths, robots_disallowed, robots_crawl_delay_seconds, robots_sha256, robots_read_on,
  verdict, verdict_conditions, reviewed_by, reviewed_on, active, crawl_mode
) VALUES (
  'src-ajptour',
  'ajptour.com',
  1,
  NULL,
  'If the founder activates it: the public upcoming-events listing only, never an event page (Smoothcomp event pages refuse plain clients; founder ruling 2026-09-20). Pages read for this review: /robots.txt, /en/agreements (404), /en/about-us/terms-of-service and /en/ajp-terms-and-conditions. No listing or event page was requested, so login_required stays unrecorded until one is.',

  'https://ajptour.com/en/about-us/terms-of-service',
  'Updated on: 2021-11-03, Version: 1.0 (as printed). Also read: https://ajptour.com/en/ajp-terms-and-conditions, the athlete membership agreement (no date printed). Smoothcomp''s agreements path, /en/agreements, returns 404 here, as it does on Smoothcomp organizer subdomains.',
  '2026-09-27',

  'None found. The Terms of Service cover user accounts, sharing athlete data with event organizers, and GDPR; they say nothing about automated access, crawling or scraping. The membership agreement''s prohibitions bind members only: "It is prohibited to the member to: Violate the agreements stated in this page. Be a part of activities and actions which will be damaging to the AJP administration." The servers are Smoothcomp''s, so Smoothcomp''s Acceptable Use Policy, Abuse of Resources clause (recorded in src-smoothcomp), governs load.',

  'Content only, not facts. Membership agreement, section 5, Copyrights: "It is not permitted to use images, texts, sounds, and designs from AJP without authorization." An event''s name, date, city and link are none of those, and ALMANAC copies no text, image or design.',

  NULL,
  'None public. Platform: Smoothcomp, white-labeled. Evidence, measured 2026-09-27: ajptour.com/robots.txt is byte-identical to Smoothcomp''s (sha256 312e3e13..., the hash the scout confirmed on all six active Smoothcomp aliases at its 2026-09-26 07:00 UTC tick); event URLs use Smoothcomp''s /en/event/<id> shape (search index, for example ajptour.com/en/event/1362); /en/agreements 404s exactly as on Smoothcomp subdomains. events.uaejjf.org serves the same robots.txt (same hash), which confirms the earlier claim that UAEJJF is white-labeled Smoothcomp. AJP events do NOT appear on smoothcomp.com''s own public calendar (none of the 1,687 events read 2026-09-27), so the existing Smoothcomp crawl never sees them.',

  '["/order/","/checkout","/scoreboard","/en/event/","registrations","brackets","results","athlete profiles","any page listing people"]',
  '["/order/","/checkout","/scoreboard"]',
  10,
  '312e3e13bb11b8d626a95305dce10dc6115d866d07215ad30ecd6c805e362701',
  '2026-09-27',

  'allowed_with_conditions',
  'RECOMMENDED, NOT RULED. Allowed with conditions as its own source, not as a Smoothcomp alias: the 2026-09-20 alias rule makes a host that serves its own different terms not_allowed as an alias, and ajptour.com serves AJP''s own terms. Conditions: 1) the public listing page only, never an event page (listing_only, same as Smoothcomp); 2) at least 10 seconds between requests, on a clock SHARED with src-smoothcomp, because the servers are Smoothcomp''s; 3) facts only, never AJP text, images or designs; 4) honest user agent; stop on a 403 or on any request from AJP or Smoothcomp. Founder questions: does the alias rule extend to white-label domains (if yes, this becomes not_allowed), and is a parser worth it for about two US events a year (one upcoming: AJP Tour USA National, Dallas, 2026-10-31)? Recommended by the 2026-09-26 research session; not yet ruled by the founder.',
  NULL,
  NULL,
  0,
  'listing_only'
);
