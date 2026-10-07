-- MAD v2.60 (2026-10-07): ALMANAC's first automatic approval rule.
-- Founder ruling 2026-10-05 ("yes auto-approve future events following this
-- criteria"); full text in excelsior-master
-- amendments/2026-10-07-v2.60-almanac-auto-approval.md. The checks live in
-- scout/src/autoapprove.js; this row is what lets the review_log transition
-- trigger accept a system approval naming it (core_schema.sql: "automatic
-- approval is off" unless the named rule is enabled, and approval_rules
-- refuses enabled = 1 without an amendment reference).
--
-- Kill switch, no migration needed:
--   UPDATE approval_rules SET enabled = 0 WHERE id = 'tier1_listing_v1';
INSERT INTO approval_rules (id, tier, enabled, amendment_ref)
VALUES ('tier1_listing_v1', 1, 1, 'MAD v2.60');
