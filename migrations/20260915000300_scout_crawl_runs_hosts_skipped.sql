-- Records, per crawl run, how many sources the terms-review gate refused
-- before any fetch was attempted (scout/src/gate.js and scout/src/queue.js).
-- A gate refusal is never a fetch and never an error; it gets its own count
-- so a run's numbers add up: pages_fetched + errors + hosts_skipped tells the
-- whole story of what the plan contained and what happened to it.

ALTER TABLE crawl_runs ADD COLUMN hosts_skipped INTEGER NOT NULL DEFAULT 0 CHECK (hosts_skipped >= 0);
