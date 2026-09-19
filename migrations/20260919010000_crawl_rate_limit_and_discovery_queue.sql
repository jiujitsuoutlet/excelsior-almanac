-- Real crawl architecture (founder ruling, 2026-09-19): "multi-step
-- listing->detail fetching, rate limit enforced across parallel runs,
-- link liveness, page grounding." Additive.
--
-- last_claimed_at is the cross-run, cross-job rate-limit clock. The
-- existing limiter.js (nextAllowedAt/recordFetch) is pure, in-memory,
-- per-invocation state -- it cannot see what a DIFFERENT scheduled
-- invocation (the nightly Tier 1 run and the daily link-recheck run
-- both touch the same company's hosts) did a moment ago, because each
-- Worker invocation gets its own fresh memory. A real cross-run clock
-- has to live in the one place both invocations can both see: the
-- database. This column, claimed with a single atomic UPDATE ... WHERE
-- (limiter.js's claimRateLimitSlot), is that clock. One column per
-- company (sources), never per alias -- section 9 rule 3 again.
ALTER TABLE sources ADD COLUMN last_claimed_at TEXT;

-- The organizer subdomain's own listing/calendar page path, set by the
-- same human who activates the alias (section 9 rule 5 already requires
-- them to check that subdomain directly). Defaults to '/' rather than a
-- guessed path this migration has no way to verify against the real
-- site.
ALTER TABLE source_aliases ADD COLUMN listing_path TEXT NOT NULL DEFAULT '/';

-- A real crawl discovers more detail-page URLs from one listing page
-- than a single Worker invocation's time and rate-limit budget can
-- fetch in one pass (each detail fetch is its own rate-limited request,
-- section 9's 10-second-per-company clock). Discovery and detail-
-- fetching are therefore two separate steps, decoupled through this
-- table: one run's listing-page fetch enqueues URLs here, and later
-- runs (the same invocation if time allows, or a subsequent one) work
-- the queue down, oldest first.
CREATE TABLE discovered_pages (
  id             TEXT PRIMARY KEY,
  source_id      TEXT NOT NULL REFERENCES sources (id),
  host           TEXT NOT NULL CHECK (host = lower(host)),
  url            TEXT NOT NULL UNIQUE CHECK (url LIKE 'https://%'),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fetched', 'failed', 'excluded')),
  fail_reason    TEXT,
  discovered_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  fetched_at     TEXT,
  CHECK ((status = 'pending') = (fetched_at IS NULL))
);
CREATE INDEX discovered_pages_pending ON discovered_pages (discovered_at) WHERE status = 'pending';
CREATE INDEX discovered_pages_source_id ON discovered_pages (source_id);

-- Append-only in spirit (a real crawl record), same posture as
-- crawl_runs/review_log: a page's discovery is a fact, not something to
-- silently rewrite. Only status/fail_reason/fetched_at ever change after
-- insert, and only forward (pending -> fetched|failed|excluded).
CREATE TRIGGER discovered_pages_no_delete BEFORE DELETE ON discovered_pages
BEGIN SELECT RAISE(ABORT, 'discovered_pages is append-only; expire or fail rows, never delete them'); END;
CREATE TRIGGER discovered_pages_immutable_identity BEFORE UPDATE ON discovered_pages
WHEN NEW.id IS NOT OLD.id OR NEW.source_id IS NOT OLD.source_id OR NEW.host IS NOT OLD.host
  OR NEW.url IS NOT OLD.url OR NEW.discovered_at IS NOT OLD.discovered_at
BEGIN SELECT RAISE(ABORT, 'a discovered page''s identity and discovery record never change'); END;
