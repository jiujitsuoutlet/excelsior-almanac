-- Extends the standing terms-review authorization to subdomains (founder
-- ruling, 2026-09-20): "fetch the subdomain's own terms page, and if it
-- 404s or is identical to the parent's, inherit the parent's verdict...
-- If a subdomain serves its own DIFFERENT terms, record not_allowed and
-- route that organizer to Tier 3. Record your reasoning in the row every
-- time." source_aliases had no field to record either the decision or the
-- reasoning -- additive.
--
-- Only 'inherited_parent' may ever be active = 1: a 'not_allowed' alias is
-- a terminal, recorded refusal, never a live crawl target (that organizer
-- is routed to Tier 3 -- a separate, human-entry source, not this alias).
-- Enforced by trigger, not a table CHECK: SQLite/D1 cannot ALTER a CHECK
-- constraint onto an existing table without recreating it, and this
-- codebase already enforces cross-column activation rules this way (see
-- core_schema.sql's own activation CHECKs, which this trigger mirrors for
-- the two columns a plain CHECK could not reach after the fact).
ALTER TABLE source_aliases ADD COLUMN terms_verdict TEXT CHECK (terms_verdict IS NULL OR terms_verdict IN ('inherited_parent', 'not_allowed'));
ALTER TABLE source_aliases ADD COLUMN terms_reasoning TEXT;

CREATE TRIGGER source_aliases_activation_requires_terms_verdict
BEFORE INSERT ON source_aliases
WHEN NEW.active = 1 AND (NEW.terms_verdict IS NOT 'inherited_parent' OR NEW.terms_reasoning IS NULL OR length(NEW.terms_reasoning) = 0)
BEGIN
  SELECT RAISE(ABORT, 'an alias may only be active with terms_verdict = inherited_parent and a recorded reasoning');
END;

CREATE TRIGGER source_aliases_activation_requires_terms_verdict_on_update
BEFORE UPDATE ON source_aliases
WHEN NEW.active = 1 AND (NEW.terms_verdict IS NOT 'inherited_parent' OR NEW.terms_reasoning IS NULL OR length(NEW.terms_reasoning) = 0)
BEGIN
  SELECT RAISE(ABORT, 'an alias may only be active with terms_verdict = inherited_parent and a recorded reasoning');
END;
