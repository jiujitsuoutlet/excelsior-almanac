-- Terms review record: smoothcomp.com
-- Reviewed and ruled by the founder on 2026-09-16, reading the pages himself.
-- This file is the audit trail; applying it writes the row that lets Scout
-- fetch this host, and only this host.
--
-- Apply (production):
--   npx wrangler d1 execute almanac --remote --config console/wrangler.toml --file scout/terms-reviews/smoothcomp.sql
-- Apply (staging):
--   npx wrangler d1 execute almanac-staging --remote --env staging --config console/wrangler.toml --file scout/terms-reviews/smoothcomp.sql

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
  'src-smoothcomp',
  'smoothcomp.com',
  1,
  'smoothcomp_v1',
  'Public event listing pages (/en/events) and public event detail pages only.',

  'https://smoothcomp.com/en/agreements',
  'Terms of Service v4.0, updated 2025-02-04. The same URL also holds a SaaS Agreement v3.0 (2023-05-22) and an SLA v1.0 (2018-05-25).',
  '2026-09-16',

  'None found. Neither the Terms of Service nor the Acceptable Use Policy prohibits automated access, crawling or scraping. The AUP prohibits hacking, malware, phishing, denial of service, illegal content, harassment, fraud, violent content, impersonation, spam, privacy violation, intellectual property infringement, and Abuse of Resources. BINDING CONDITION: the Abuse of Resources clause covers activities that excessively consume platform resources such as bandwidth, storage or processing power. The 10 second crawl delay and conditional requests are what keep this crawler clear of it. No one raises the rate without the founder''s word.',

  'None that apply to us. The restrictive intellectual property clauses (no copying, mirroring, republishing, downloading or distributing) sit in the SaaS Agreement, which is the contract between Smoothcomp and the ORGANIZERS who run events on the platform. ALMANAC is not a Client under that agreement; it reads public event pages as a member of the public. Founder''s reasoning, recorded 2026-09-16 so it is not relitigated later.',

  0,
  'None public. The organizer platform and the federation platform are for paying customers; nothing is offered to third parties.',

  '["/order/","/checkout","/scoreboard","registrations","brackets","results","athlete profiles","any page listing people"]',
  '["/order/","/checkout","/scoreboard"]',
  10,
  '312e3e13bb11b8d626a95305dce10dc6115d866d07215ad30ecd6c805e362701',
  '2026-09-16',

  'allowed_with_conditions',
  'Founder conditions, 2026-09-16. 1) Public event listing and event detail pages only. 2) Crawl delay of at least 10 seconds per robots.txt, with conditional requests; nobody raises the rate without the founder''s word (this is what keeps us clear of the AUP Abuse of Resources clause). 3) NEVER fetch registrations, brackets, results, athlete profiles, the scoreboard, /order/ or /checkout, or any page that lists people. 4) Facts and source URLs only: no stored page bodies, no copied prose. 5) Honest user agent carrying a contact address. 6) If Smoothcomp ever asks us to stop, we stop that day. 7) Scope note: the SaaS Agreement shows Smoothcomp is protective about data and monitors organizers who route registrations off-platform. ALMANAC sends traffic TO them. Anything that later resembles a competing registration flow is a NEW terms review and a new founder conversation, never an extension of this one.',
  'paul.tokgozoglu@gmail.com',
  '2026-09-16',
  1
);
