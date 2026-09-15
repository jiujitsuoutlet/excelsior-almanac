-- ALMANAC core schema (Cloudflare D1, SQLite).
-- Authority: Excelsior MAD v2.54 (data model) and v2.55 (D1 platform), and
-- this repository's ARCHITECTURE.md.
--
-- Rules the DATABASE enforces for every caller, the console included:
--   1. One path for status. A status changes only when a row is inserted into
--      review_log with action = 'transition'. A trigger checks the transition
--      and applies it. A direct UPDATE of status, approved_by, approved_at or
--      approval_rule is refused.
--   2. row_signals and review_log are append-only: UPDATE and DELETE are refused.
--   3. New events, venues and venue sessions start as 'draft', with no approval.
--   4. An approved row's content is locked. Transition it to needs_review first.
--   5. Automatic approval is off. A system actor cannot approve unless its
--      approval rule is enabled, and a rule cannot be enabled without an
--      amendment reference.
--   6. A source cannot be activated for crawling without a complete terms review.
--   7. Events, venues and venue sessions are never hard-deleted.
--
-- There are no description, prose, participant, bracket, result or minor
-- columns anywhere. ALMANAC stores facts and source URLs only.
-- Timestamps are ISO 8601 UTC text. Dates are YYYY-MM-DD text.

-- ============================================================
-- Reviewers: the console allowlist. A human actor in review_log must be an
-- active reviewer. app_profile_id is the reviewer's profile id in the
-- Excelsior app, used as approved_by when a row is published.
-- ============================================================
CREATE TABLE reviewers (
  email          TEXT PRIMARY KEY CHECK (email = lower(email) AND email LIKE '%_@_%.%'),
  github_login   TEXT,
  role           TEXT NOT NULL CHECK (role IN ('admin', 'reviewer')),
  app_profile_id TEXT,
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ============================================================
-- Sources: one row per host, with the ten-field terms review record
-- (v2.54 decision 6). active = 1 is refused until the review is complete
-- and the verdict allows crawling.
-- ============================================================
CREATE TABLE sources (
  id                         TEXT PRIMARY KEY,
  host                       TEXT NOT NULL UNIQUE CHECK (host = lower(host)),
  tier                       INTEGER NOT NULL CHECK (tier IN (1, 2, 3)),
  parser                     TEXT,
  page_types                 TEXT,                                          -- field 1
  terms_url                  TEXT CHECK (terms_url IS NULL OR terms_url LIKE 'https://%' OR terms_url LIKE 'http://%'), -- field 2
  terms_last_updated         TEXT,                                          -- field 2 (the terms' own date, or 'not stated')
  terms_read_on              TEXT CHECK (terms_read_on IS NULL OR date(terms_read_on) IS terms_read_on), -- field 2
  terms_automated_access     TEXT,                                          -- field 3 (clause, or 'none found')
  terms_reuse                TEXT,                                          -- field 4 (clause, or 'none found')
  login_required             INTEGER CHECK (login_required IS NULL OR login_required IN (0, 1)), -- field 5
  official_api               TEXT,                                          -- field 6 (link, or 'none')
  excluded_paths             TEXT CHECK (excluded_paths IS NULL OR (json_valid(excluded_paths) AND json_type(excluded_paths) = 'array')), -- field 7
  robots_disallowed          TEXT CHECK (robots_disallowed IS NULL OR (json_valid(robots_disallowed) AND json_type(robots_disallowed) = 'array')), -- field 8
  robots_crawl_delay_seconds INTEGER CHECK (robots_crawl_delay_seconds IS NULL OR robots_crawl_delay_seconds >= 0), -- field 8
  robots_sha256              TEXT CHECK (robots_sha256 IS NULL OR length(robots_sha256) = 64), -- field 8
  robots_read_on             TEXT CHECK (robots_read_on IS NULL OR date(robots_read_on) IS robots_read_on), -- field 8
  verdict                    TEXT CHECK (verdict IS NULL OR verdict IN ('allowed', 'allowed_with_conditions', 'not_allowed')), -- field 9
  verdict_conditions         TEXT,                                          -- field 9
  reviewed_by                TEXT REFERENCES reviewers (email),             -- field 10
  reviewed_on                TEXT CHECK (reviewed_on IS NULL OR date(reviewed_on) IS reviewed_on), -- field 10
  active                     INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    active = 0 OR (
      page_types IS NOT NULL AND terms_url IS NOT NULL AND terms_last_updated IS NOT NULL
      AND terms_read_on IS NOT NULL AND terms_automated_access IS NOT NULL
      AND terms_reuse IS NOT NULL AND login_required = 0 AND official_api IS NOT NULL
      AND excluded_paths IS NOT NULL AND robots_disallowed IS NOT NULL
      AND robots_sha256 IS NOT NULL AND robots_read_on IS NOT NULL
      AND verdict IN ('allowed', 'allowed_with_conditions')
      AND (verdict = 'allowed' OR verdict_conditions IS NOT NULL)
      AND reviewed_by IS NOT NULL AND reviewed_on IS NOT NULL
    )
  )
);

-- ============================================================
-- Approval rules: automatic approval rules. All start disabled. Enabling one
-- requires the dated MAD amendment that ratified it. Tier 3 never approves
-- automatically.
-- ============================================================
CREATE TABLE approval_rules (
  id            TEXT PRIMARY KEY,                    -- name plus version, e.g. 'tier1_structured_v1'
  tier          INTEGER NOT NULL CHECK (tier IN (1, 2)),
  enabled       INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  amendment_ref TEXT,                                -- e.g. 'MAD v2.60'
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (enabled = 0 OR amendment_ref IS NOT NULL)
);

-- ============================================================
-- Events: tournaments, superfights, seminars, camps, open competitions.
-- ============================================================
CREATE TABLE events (
  id                    TEXT PRIMARY KEY,
  event_type            TEXT NOT NULL CHECK (event_type IN ('tournament', 'superfight', 'seminar', 'camp', 'open_competition')),
  name                  TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  organizer_name        TEXT CHECK (organizer_name IS NULL OR length(organizer_name) <= 200),
  start_date            TEXT NOT NULL CHECK (date(start_date) IS start_date),
  end_date              TEXT CHECK (end_date IS NULL OR (date(end_date) IS end_date AND end_date >= start_date)),
  timezone              TEXT,                        -- IANA name, e.g. 'America/Chicago'
  venue_name            TEXT CHECK (venue_name IS NULL OR length(venue_name) <= 200),
  address               TEXT CHECK (address IS NULL OR length(address) <= 300),
  city                  TEXT NOT NULL CHECK (length(city) BETWEEN 1 AND 120),
  state                 TEXT NOT NULL CHECK (length(state) BETWEEN 1 AND 3 AND state = upper(state)), -- ISO 3166-2 subdivision part, e.g. 'MO'
  country               TEXT NOT NULL CHECK (length(country) = 2 AND country = upper(country)),      -- ISO 3166-1 alpha-2, e.g. 'US'
  lat                   REAL CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lon                   REAL CHECK (lon IS NULL OR lon BETWEEN -180 AND 180),
  geocode_confidence    INTEGER CHECK (geocode_confidence IS NULL OR geocode_confidence BETWEEN 0 AND 10),
  registration_url      TEXT CHECK (registration_url IS NULL OR registration_url LIKE 'https://%'),
  registration_deadline TEXT CHECK (registration_deadline IS NULL OR date(registration_deadline) IS registration_deadline),
  gi                    INTEGER NOT NULL DEFAULT 0 CHECK (gi IN (0, 1)),
  nogi                  INTEGER NOT NULL DEFAULT 0 CHECK (nogi IN (0, 1)),
  kids                  INTEGER NOT NULL DEFAULT 0 CHECK (kids IN (0, 1)),
  source_url            TEXT NOT NULL CHECK (source_url LIKE 'https://%' OR source_url LIKE 'http://%'),
  source_host           TEXT NOT NULL CHECK (source_host = lower(source_host)),
  source_event_ref      TEXT,                        -- the host's own event reference, when it has one
  source_tier           INTEGER NOT NULL CHECK (source_tier IN (1, 2, 3)),
  confidence            INTEGER CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  scoring_version       TEXT,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'needs_review', 'approved', 'rejected', 'expired', 'stale')),
  approved_by           TEXT REFERENCES reviewers (email),
  approved_at           TEXT,
  approval_rule         TEXT REFERENCES approval_rules (id),
  dedupe_key            TEXT NOT NULL UNIQUE,
  first_seen_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  link_checked_at       TEXT,
  published_at          TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((status = 'approved') = (approved_at IS NOT NULL)),
  CHECK (status <> 'approved' OR ((approved_by IS NULL) <> (approval_rule IS NULL))),
  CHECK (status <> 'approved' OR registration_url IS NOT NULL)
);
CREATE UNIQUE INDEX events_source_ref ON events (source_host, source_event_ref) WHERE source_event_ref IS NOT NULL;
CREATE INDEX events_status_start ON events (status, start_date);
CREATE INDEX events_lat_lon ON events (lat, lon);

-- Per-type extensions. Each row must belong to an event of a matching type.
CREATE TABLE seminar_details (
  event_id    TEXT PRIMARY KEY REFERENCES events (id),
  instructors TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(instructors) AND json_type(instructors) = 'array')
);
CREATE TABLE superfight_details (
  event_id  TEXT PRIMARY KEY REFERENCES events (id),
  athletes  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(athletes) AND json_type(athletes) = 'array'),
  promotion TEXT CHECK (promotion IS NULL OR length(promotion) <= 200)
);
CREATE TABLE camp_details (
  event_id         TEXT PRIMARY KEY REFERENCES events (id),
  lodging_included INTEGER CHECK (lodging_included IS NULL OR lodging_included IN (0, 1))
);
CREATE TABLE competition_details (
  event_id   TEXT PRIMARY KEY REFERENCES events (id),
  federation TEXT CHECK (federation IS NULL OR length(federation) <= 120),
  ruleset    TEXT CHECK (ruleset IS NULL OR length(ruleset) <= 120)
);

-- ============================================================
-- Venues: academies and gyms.
-- ============================================================
CREATE TABLE venues (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  address            TEXT CHECK (address IS NULL OR length(address) <= 300),
  city               TEXT NOT NULL CHECK (length(city) BETWEEN 1 AND 120),
  state              TEXT NOT NULL CHECK (length(state) BETWEEN 1 AND 3 AND state = upper(state)),
  country            TEXT NOT NULL CHECK (length(country) = 2 AND country = upper(country)),
  lat                REAL CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lon                REAL CHECK (lon IS NULL OR lon BETWEEN -180 AND 180),
  geocode_confidence INTEGER CHECK (geocode_confidence IS NULL OR geocode_confidence BETWEEN 0 AND 10),
  affiliation        TEXT CHECK (affiliation IS NULL OR length(affiliation) <= 120),
  phone              TEXT CHECK (phone IS NULL OR length(phone) <= 40),      -- business contact only
  email              TEXT CHECK (email IS NULL OR email LIKE '%_@_%.%'),     -- business contact only
  website            TEXT CHECK (website IS NULL OR website LIKE 'https://%' OR website LIKE 'http://%'),
  website_domain     TEXT CHECK (website_domain IS NULL OR website_domain = lower(website_domain)),
  source_url         TEXT NOT NULL CHECK (source_url LIKE 'https://%' OR source_url LIKE 'http://%'),
  source_host        TEXT NOT NULL CHECK (source_host = lower(source_host)),
  source_tier        INTEGER NOT NULL CHECK (source_tier IN (1, 2, 3)),
  confidence         INTEGER CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  scoring_version    TEXT,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'needs_review', 'approved', 'rejected', 'expired', 'stale')),
  approved_by        TEXT REFERENCES reviewers (email),
  approved_at        TEXT,
  approval_rule      TEXT REFERENCES approval_rules (id),
  dedupe_key         TEXT NOT NULL UNIQUE,
  first_seen_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  link_checked_at    TEXT,
  published_at       TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((status = 'approved') = (approved_at IS NOT NULL)),
  CHECK (status <> 'approved' OR ((approved_by IS NULL) <> (approval_rule IS NULL)))
);
CREATE UNIQUE INDEX venues_website_domain ON venues (website_domain) WHERE website_domain IS NOT NULL;
CREATE INDEX venues_status ON venues (status);
CREATE INDEX venues_lat_lon ON venues (lat, lon);

-- ============================================================
-- Venue sessions: the training schedule. The drop-in fee is a third-party
-- academy's published fee, a logistics fact (MAD Section 11, v2.54).
-- ============================================================
CREATE TABLE venue_sessions (
  id                TEXT PRIMARY KEY,
  venue_id          TEXT NOT NULL REFERENCES venues (id),
  day_of_week       INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),   -- 0 = Sunday
  start_time        TEXT NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND start_time <= '23:59'),
  end_time          TEXT CHECK (end_time IS NULL OR (end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND end_time <= '23:59')),
  timezone          TEXT NOT NULL,
  style             TEXT NOT NULL CHECK (style IN ('gi', 'nogi', 'kids', 'wrestling', 'judo', 'mma', 'other')),
  level             TEXT NOT NULL DEFAULT 'all_levels' CHECK (level IN ('all_levels', 'beginner', 'intermediate', 'advanced', 'competition')),
  is_open_mat       INTEGER NOT NULL DEFAULT 0 CHECK (is_open_mat IN (0, 1)),
  drop_in_policy    TEXT NOT NULL DEFAULT 'unknown' CHECK (drop_in_policy IN ('welcome', 'call_ahead', 'members_only', 'unknown')),
  drop_in_fee_cents INTEGER CHECK (drop_in_fee_cents IS NULL OR drop_in_fee_cents >= 0),
  drop_in_currency  TEXT CHECK (drop_in_currency IS NULL OR (length(drop_in_currency) = 3 AND drop_in_currency = upper(drop_in_currency))),
  source_url        TEXT NOT NULL CHECK (source_url LIKE 'https://%' OR source_url LIKE 'http://%'),
  source_tier       INTEGER NOT NULL CHECK (source_tier IN (1, 2, 3)),
  confidence        INTEGER CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'needs_review', 'approved', 'rejected', 'expired', 'stale')),
  approved_by       TEXT REFERENCES reviewers (email),
  approved_at       TEXT,
  approval_rule     TEXT REFERENCES approval_rules (id),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (venue_id, day_of_week, start_time, style),
  CHECK ((drop_in_fee_cents IS NULL) = (drop_in_currency IS NULL)),
  CHECK ((status = 'approved') = (approved_at IS NOT NULL)),
  CHECK (status <> 'approved' OR ((approved_by IS NULL) <> (approval_rule IS NULL)))
);
CREATE INDEX venue_sessions_venue ON venue_sessions (venue_id, status);

-- ============================================================
-- Verification signals, per row. Append-only from day one.
-- ============================================================
CREATE TABLE row_signals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('event', 'venue', 'venue_session')),
  entity_id   TEXT NOT NULL,
  signal      TEXT NOT NULL CHECK (signal IN ('link_live', 'date_sane', 'corroboration', 'duplicate_score', 'geocode_confidence', 'grounding', 'extraction_agreement', 'robots_allowed')),
  value_num   REAL,
  passed      INTEGER CHECK (passed IS NULL OR passed IN (0, 1)),
  evidence    TEXT CHECK (evidence IS NULL OR json_valid(evidence)),   -- status code, final URL, corroborating URL; never page text
  checked_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (value_num IS NOT NULL OR passed IS NOT NULL)
);
CREATE INDEX row_signals_entity ON row_signals (entity_type, entity_id, signal, checked_at);

-- ============================================================
-- Review log: every create, edit, merge and status transition. Append-only
-- from day one. An action = 'transition' row is the ONLY way a status changes.
-- ============================================================
CREATE TABLE review_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type    TEXT NOT NULL CHECK (entity_type IN ('event', 'venue', 'venue_session')),
  entity_id      TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('create', 'edit', 'transition', 'merge')),
  from_status    TEXT CHECK (from_status IS NULL OR from_status IN ('draft', 'needs_review', 'approved', 'rejected', 'expired', 'stale')),
  to_status      TEXT CHECK (to_status IS NULL OR to_status IN ('draft', 'needs_review', 'approved', 'rejected', 'expired', 'stale')),
  actor          TEXT NOT NULL CHECK (length(actor) > 0),       -- a reviewer email, or 'system:<component>'
  approval_rule  TEXT REFERENCES approval_rules (id),
  reason_code    TEXT,
  before_json    TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json     TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  merged_into_id TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((action = 'transition') = (from_status IS NOT NULL AND to_status IS NOT NULL)),
  CHECK (action <> 'transition' OR to_status <> 'rejected' OR reason_code IS NOT NULL),
  CHECK (action <> 'merge' OR merged_into_id IS NOT NULL)
);
CREATE INDEX review_log_entity ON review_log (entity_type, entity_id, id);

-- The allowed transitions. system_allowed = 1 means a 'system:' actor may
-- make it. No row lets a system actor approve; automatic approval goes only
-- through an enabled approval rule (checked in the transition trigger).
CREATE TABLE status_transition_rules (
  entity_type    TEXT NOT NULL CHECK (entity_type IN ('event', 'venue', 'venue_session')),
  from_status    TEXT NOT NULL,
  to_status      TEXT NOT NULL,
  system_allowed INTEGER NOT NULL CHECK (system_allowed IN (0, 1)),
  PRIMARY KEY (entity_type, from_status, to_status)
);
-- Allowed for every entity type. One statement per row (D1 limits compound SELECTs).
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('event', 'draft', 'needs_review', 1);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('event', 'draft', 'rejected', 0);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('event', 'needs_review', 'approved', 0);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('event', 'needs_review', 'rejected', 0);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('event', 'approved', 'needs_review', 1);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('event', 'approved', 'stale', 1);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('event', 'approved', 'rejected', 0);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('event', 'stale', 'needs_review', 1);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('event', 'stale', 'rejected', 0);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('event', 'rejected', 'needs_review', 0);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue', 'draft', 'needs_review', 1);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue', 'draft', 'rejected', 0);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue', 'needs_review', 'approved', 0);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue', 'needs_review', 'rejected', 0);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue', 'approved', 'needs_review', 1);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue', 'approved', 'stale', 1);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue', 'approved', 'rejected', 0);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue', 'stale', 'needs_review', 1);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue', 'stale', 'rejected', 0);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue', 'rejected', 'needs_review', 0);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue_session', 'draft', 'needs_review', 1);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue_session', 'draft', 'rejected', 0);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue_session', 'needs_review', 'approved', 0);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue_session', 'needs_review', 'rejected', 0);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue_session', 'approved', 'needs_review', 1);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue_session', 'approved', 'stale', 1);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue_session', 'approved', 'rejected', 0);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue_session', 'stale', 'needs_review', 1);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue_session', 'stale', 'rejected', 0);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('venue_session', 'rejected', 'needs_review', 0);
-- Only events expire. Venues and sessions never do.
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('event', 'draft', 'expired', 1);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('event', 'needs_review', 'expired', 1);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('event', 'approved', 'expired', 1);
INSERT INTO status_transition_rules (entity_type, from_status, to_status, system_allowed) VALUES ('event', 'stale', 'expired', 1);

-- ============================================================
-- Coverage requests: aggregate demand read from the app (the only reverse
-- flow). Counts per place per day. No member identity.
-- ============================================================
CREATE TABLE coverage_requests (
  place_id      INTEGER NOT NULL,          -- GeoNames geonameid, as published to the app's places table
  day           TEXT NOT NULL CHECK (date(day) IS day),
  state         TEXT NOT NULL CHECK (length(state) BETWEEN 1 AND 3 AND state = upper(state)),
  country       TEXT NOT NULL CHECK (length(country) = 2 AND country = upper(country)),
  request_count INTEGER NOT NULL CHECK (request_count >= 1),
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'scouted', 'covered', 'no_sources')),
  received_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (place_id, day)
);

-- ============================================================
-- Crawl runs: one row per scheduled run, for cost and error reporting.
-- ============================================================
CREATE TABLE crawl_runs (
  id                  TEXT PRIMARY KEY,
  component           TEXT NOT NULL CHECK (component IN ('tier1_scout', 'tier2_scout', 'link_checker', 'expiry', 'publisher', 'demand_reader')),
  region              TEXT,
  status              TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at         TEXT,
  pages_fetched       INTEGER NOT NULL DEFAULT 0 CHECK (pages_fetched >= 0),
  drafts_created      INTEGER NOT NULL DEFAULT 0 CHECK (drafts_created >= 0),
  errors              INTEGER NOT NULL DEFAULT 0 CHECK (errors >= 0),
  model_input_tokens  INTEGER NOT NULL DEFAULT 0 CHECK (model_input_tokens >= 0),
  model_output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (model_output_tokens >= 0),
  cost_microusd       INTEGER NOT NULL DEFAULT 0 CHECK (cost_microusd >= 0)
);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Rule 2: append-only tables.
CREATE TRIGGER review_log_no_update BEFORE UPDATE ON review_log
BEGIN SELECT RAISE(ABORT, 'review_log is append-only'); END;
CREATE TRIGGER review_log_no_delete BEFORE DELETE ON review_log
BEGIN SELECT RAISE(ABORT, 'review_log is append-only'); END;
CREATE TRIGGER row_signals_no_update BEFORE UPDATE ON row_signals
BEGIN SELECT RAISE(ABORT, 'row_signals is append-only'); END;
CREATE TRIGGER row_signals_no_delete BEFORE DELETE ON row_signals
BEGIN SELECT RAISE(ABORT, 'row_signals is append-only'); END;
CREATE TRIGGER status_transition_rules_no_update BEFORE UPDATE ON status_transition_rules
BEGIN SELECT RAISE(ABORT, 'status_transition_rules change only by migration'); END;
CREATE TRIGGER status_transition_rules_no_delete BEFORE DELETE ON status_transition_rules
BEGIN SELECT RAISE(ABORT, 'status_transition_rules change only by migration'); END;
-- Also refuse inserts (INSERT OR REPLACE would otherwise overwrite a rule).
-- A future migration that adds a rule drops and recreates this trigger.
CREATE TRIGGER status_transition_rules_no_insert BEFORE INSERT ON status_transition_rules
BEGIN SELECT RAISE(ABORT, 'status_transition_rules change only by migration'); END;

-- review_log and row_signals must point at a real row; a human actor must be
-- an active reviewer.
CREATE TRIGGER review_log_checks BEFORE INSERT ON review_log
BEGIN
  SELECT RAISE(ABORT, 'review_log is append-only')
  WHERE EXISTS (SELECT 1 FROM review_log WHERE id = NEW.id);
  SELECT RAISE(ABORT, 'review_log entity does not exist')
  WHERE NOT EXISTS (
    SELECT 1 FROM events WHERE NEW.entity_type = 'event' AND id = NEW.entity_id
    UNION ALL SELECT 1 FROM venues WHERE NEW.entity_type = 'venue' AND id = NEW.entity_id
    UNION ALL SELECT 1 FROM venue_sessions WHERE NEW.entity_type = 'venue_session' AND id = NEW.entity_id
  );
  SELECT RAISE(ABORT, 'actor is not an active reviewer')
  WHERE NEW.actor NOT LIKE 'system:%'
    AND NOT EXISTS (SELECT 1 FROM reviewers WHERE email = NEW.actor AND active = 1);
END;
CREATE TRIGGER row_signals_entity_exists BEFORE INSERT ON row_signals
BEGIN
  SELECT RAISE(ABORT, 'row_signals is append-only')
  WHERE EXISTS (SELECT 1 FROM row_signals WHERE id = NEW.id);
  SELECT RAISE(ABORT, 'row_signals entity does not exist')
  WHERE NOT EXISTS (
    SELECT 1 FROM events WHERE NEW.entity_type = 'event' AND id = NEW.entity_id
    UNION ALL SELECT 1 FROM venues WHERE NEW.entity_type = 'venue' AND id = NEW.entity_id
    UNION ALL SELECT 1 FROM venue_sessions WHERE NEW.entity_type = 'venue_session' AND id = NEW.entity_id
  );
END;

-- Rule 1: THE status path. Validate the transition, then apply it.
CREATE TRIGGER review_log_apply_transition AFTER INSERT ON review_log
WHEN NEW.action = 'transition'
BEGIN
  SELECT RAISE(ABORT, 'transition is not allowed')
  WHERE NOT EXISTS (
    SELECT 1 FROM status_transition_rules r
    WHERE r.entity_type = NEW.entity_type AND r.from_status = NEW.from_status AND r.to_status = NEW.to_status
  );
  SELECT RAISE(ABORT, 'from_status does not match the current status')
  WHERE (CASE NEW.entity_type
           WHEN 'event' THEN (SELECT status FROM events WHERE id = NEW.entity_id)
           WHEN 'venue' THEN (SELECT status FROM venues WHERE id = NEW.entity_id)
           ELSE (SELECT status FROM venue_sessions WHERE id = NEW.entity_id)
         END) IS NOT NEW.from_status;
  SELECT RAISE(ABORT, 'approval_rule applies only to automatic approvals')
  WHERE NEW.approval_rule IS NOT NULL AND (NEW.to_status <> 'approved' OR NEW.actor NOT LIKE 'system:%');
  SELECT RAISE(ABORT, 'automatic approval is off')
  WHERE NEW.actor LIKE 'system:%' AND NEW.to_status = 'approved'
    AND NOT EXISTS (SELECT 1 FROM approval_rules a WHERE a.id = NEW.approval_rule AND a.enabled = 1);
  SELECT RAISE(ABORT, 'system actors cannot make this transition')
  WHERE NEW.actor LIKE 'system:%' AND NEW.to_status <> 'approved'
    AND NOT EXISTS (
      SELECT 1 FROM status_transition_rules r
      WHERE r.entity_type = NEW.entity_type AND r.from_status = NEW.from_status
        AND r.to_status = NEW.to_status AND r.system_allowed = 1
    );

  UPDATE events SET
    status        = NEW.to_status,
    approved_by   = CASE WHEN NEW.to_status = 'approved' AND NEW.actor NOT LIKE 'system:%' THEN NEW.actor END,
    approved_at   = CASE WHEN NEW.to_status = 'approved' THEN NEW.created_at END,
    approval_rule = CASE WHEN NEW.to_status = 'approved' THEN NEW.approval_rule END,
    updated_at    = NEW.created_at
  WHERE NEW.entity_type = 'event' AND id = NEW.entity_id;
  UPDATE venues SET
    status        = NEW.to_status,
    approved_by   = CASE WHEN NEW.to_status = 'approved' AND NEW.actor NOT LIKE 'system:%' THEN NEW.actor END,
    approved_at   = CASE WHEN NEW.to_status = 'approved' THEN NEW.created_at END,
    approval_rule = CASE WHEN NEW.to_status = 'approved' THEN NEW.approval_rule END,
    updated_at    = NEW.created_at
  WHERE NEW.entity_type = 'venue' AND id = NEW.entity_id;
  UPDATE venue_sessions SET
    status        = NEW.to_status,
    approved_by   = CASE WHEN NEW.to_status = 'approved' AND NEW.actor NOT LIKE 'system:%' THEN NEW.actor END,
    approved_at   = CASE WHEN NEW.to_status = 'approved' THEN NEW.created_at END,
    approval_rule = CASE WHEN NEW.to_status = 'approved' THEN NEW.approval_rule END,
    updated_at    = NEW.created_at
  WHERE NEW.entity_type = 'venue_session' AND id = NEW.entity_id;
END;

-- Rule 1, the guard: refuse any status or approval change that is not the
-- application of the newest review_log transition for that row.
CREATE TRIGGER events_status_guard BEFORE UPDATE OF status, approved_by, approved_at, approval_rule ON events
WHEN (NEW.status IS NOT OLD.status OR NEW.approved_by IS NOT OLD.approved_by
      OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approval_rule IS NOT OLD.approval_rule)
  AND NOT EXISTS (
    SELECT 1 FROM review_log l
    WHERE l.id = (SELECT max(id) FROM review_log WHERE entity_type = 'event' AND entity_id = OLD.id)
      AND l.action = 'transition' AND l.from_status = OLD.status AND l.to_status = NEW.status
  )
BEGIN SELECT RAISE(ABORT, 'status changes only through a review_log transition'); END;
CREATE TRIGGER venues_status_guard BEFORE UPDATE OF status, approved_by, approved_at, approval_rule ON venues
WHEN (NEW.status IS NOT OLD.status OR NEW.approved_by IS NOT OLD.approved_by
      OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approval_rule IS NOT OLD.approval_rule)
  AND NOT EXISTS (
    SELECT 1 FROM review_log l
    WHERE l.id = (SELECT max(id) FROM review_log WHERE entity_type = 'venue' AND entity_id = OLD.id)
      AND l.action = 'transition' AND l.from_status = OLD.status AND l.to_status = NEW.status
  )
BEGIN SELECT RAISE(ABORT, 'status changes only through a review_log transition'); END;
CREATE TRIGGER venue_sessions_status_guard BEFORE UPDATE OF status, approved_by, approved_at, approval_rule ON venue_sessions
WHEN (NEW.status IS NOT OLD.status OR NEW.approved_by IS NOT OLD.approved_by
      OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approval_rule IS NOT OLD.approval_rule)
  AND NOT EXISTS (
    SELECT 1 FROM review_log l
    WHERE l.id = (SELECT max(id) FROM review_log WHERE entity_type = 'venue_session' AND entity_id = OLD.id)
      AND l.action = 'transition' AND l.from_status = OLD.status AND l.to_status = NEW.status
  )
BEGIN SELECT RAISE(ABORT, 'status changes only through a review_log transition'); END;

-- Rule 3: new rows start as draft with no approval.
CREATE TRIGGER events_insert_draft BEFORE INSERT ON events
WHEN NEW.status IS NOT 'draft' OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.approval_rule IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'new rows start as draft with no approval'); END;
CREATE TRIGGER venues_insert_draft BEFORE INSERT ON venues
WHEN NEW.status IS NOT 'draft' OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.approval_rule IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'new rows start as draft with no approval'); END;
CREATE TRIGGER venue_sessions_insert_draft BEFORE INSERT ON venue_sessions
WHEN NEW.status IS NOT 'draft' OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.approval_rule IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'new rows start as draft with no approval'); END;

-- Rules 1 and 7, closing the REPLACE path. In SQLite, INSERT OR REPLACE and
-- UPDATE OR REPLACE delete a conflicting row WITHOUT firing delete triggers.
-- Refuse any insert or key change that would collide with an existing row,
-- and never allow an id to change. Existing rows are changed by UPDATE only.
CREATE TRIGGER events_insert_no_collision BEFORE INSERT ON events
WHEN EXISTS (
  SELECT 1 FROM events
  WHERE id = NEW.id OR dedupe_key = NEW.dedupe_key
     OR (NEW.source_event_ref IS NOT NULL AND source_host = NEW.source_host AND source_event_ref = NEW.source_event_ref)
)
BEGIN SELECT RAISE(ABORT, 'event already exists; update it instead'); END;
CREATE TRIGGER venues_insert_no_collision BEFORE INSERT ON venues
WHEN EXISTS (
  SELECT 1 FROM venues
  WHERE id = NEW.id OR dedupe_key = NEW.dedupe_key
     OR (NEW.website_domain IS NOT NULL AND website_domain = NEW.website_domain)
)
BEGIN SELECT RAISE(ABORT, 'venue already exists; update it instead'); END;
CREATE TRIGGER venue_sessions_insert_no_collision BEFORE INSERT ON venue_sessions
WHEN EXISTS (
  SELECT 1 FROM venue_sessions
  WHERE id = NEW.id
     OR (venue_id = NEW.venue_id AND day_of_week = NEW.day_of_week AND start_time = NEW.start_time AND style = NEW.style)
)
BEGIN SELECT RAISE(ABORT, 'venue session already exists; update it instead'); END;
CREATE TRIGGER events_identity_guard BEFORE UPDATE ON events
WHEN NEW.id IS NOT OLD.id
  OR (NEW.dedupe_key IS NOT OLD.dedupe_key AND EXISTS (SELECT 1 FROM events WHERE dedupe_key = NEW.dedupe_key AND id <> OLD.id))
  OR (NEW.source_event_ref IS NOT NULL
      AND (NEW.source_event_ref IS NOT OLD.source_event_ref OR NEW.source_host IS NOT OLD.source_host)
      AND EXISTS (SELECT 1 FROM events WHERE source_host = NEW.source_host AND source_event_ref = NEW.source_event_ref AND id <> OLD.id))
BEGIN SELECT RAISE(ABORT, 'event ids never change and keys never collide'); END;
CREATE TRIGGER venues_identity_guard BEFORE UPDATE ON venues
WHEN NEW.id IS NOT OLD.id
  OR (NEW.dedupe_key IS NOT OLD.dedupe_key AND EXISTS (SELECT 1 FROM venues WHERE dedupe_key = NEW.dedupe_key AND id <> OLD.id))
  OR (NEW.website_domain IS NOT NULL AND NEW.website_domain IS NOT OLD.website_domain
      AND EXISTS (SELECT 1 FROM venues WHERE website_domain = NEW.website_domain AND id <> OLD.id))
BEGIN SELECT RAISE(ABORT, 'venue ids never change and keys never collide'); END;
CREATE TRIGGER venue_sessions_identity_guard BEFORE UPDATE ON venue_sessions
WHEN NEW.id IS NOT OLD.id
  OR ((NEW.venue_id IS NOT OLD.venue_id OR NEW.day_of_week IS NOT OLD.day_of_week
       OR NEW.start_time IS NOT OLD.start_time OR NEW.style IS NOT OLD.style)
      AND EXISTS (SELECT 1 FROM venue_sessions
                  WHERE venue_id = NEW.venue_id AND day_of_week = NEW.day_of_week
                    AND start_time = NEW.start_time AND style = NEW.style AND id <> OLD.id))
BEGIN SELECT RAISE(ABORT, 'venue session ids never change and keys never collide'); END;

-- Rule 4: an approved row's content is locked.
CREATE TRIGGER events_approved_content_lock BEFORE UPDATE ON events
WHEN OLD.status = 'approved' AND (
  NEW.event_type IS NOT OLD.event_type OR NEW.name IS NOT OLD.name
  OR NEW.organizer_name IS NOT OLD.organizer_name OR NEW.start_date IS NOT OLD.start_date
  OR NEW.end_date IS NOT OLD.end_date OR NEW.timezone IS NOT OLD.timezone
  OR NEW.venue_name IS NOT OLD.venue_name OR NEW.address IS NOT OLD.address
  OR NEW.city IS NOT OLD.city OR NEW.state IS NOT OLD.state OR NEW.country IS NOT OLD.country
  OR NEW.lat IS NOT OLD.lat OR NEW.lon IS NOT OLD.lon
  OR NEW.registration_url IS NOT OLD.registration_url
  OR NEW.registration_deadline IS NOT OLD.registration_deadline
  OR NEW.gi IS NOT OLD.gi OR NEW.nogi IS NOT OLD.nogi OR NEW.kids IS NOT OLD.kids
  OR NEW.source_url IS NOT OLD.source_url
)
BEGIN SELECT RAISE(ABORT, 'approved content is locked; transition to needs_review first'); END;
CREATE TRIGGER venues_approved_content_lock BEFORE UPDATE ON venues
WHEN OLD.status = 'approved' AND (
  NEW.name IS NOT OLD.name OR NEW.address IS NOT OLD.address OR NEW.city IS NOT OLD.city
  OR NEW.state IS NOT OLD.state OR NEW.country IS NOT OLD.country
  OR NEW.lat IS NOT OLD.lat OR NEW.lon IS NOT OLD.lon OR NEW.affiliation IS NOT OLD.affiliation
  OR NEW.phone IS NOT OLD.phone OR NEW.email IS NOT OLD.email OR NEW.website IS NOT OLD.website
  OR NEW.source_url IS NOT OLD.source_url
)
BEGIN SELECT RAISE(ABORT, 'approved content is locked; transition to needs_review first'); END;
CREATE TRIGGER venue_sessions_approved_content_lock BEFORE UPDATE ON venue_sessions
WHEN OLD.status = 'approved' AND (
  NEW.venue_id IS NOT OLD.venue_id OR NEW.day_of_week IS NOT OLD.day_of_week
  OR NEW.start_time IS NOT OLD.start_time OR NEW.end_time IS NOT OLD.end_time
  OR NEW.timezone IS NOT OLD.timezone OR NEW.style IS NOT OLD.style OR NEW.level IS NOT OLD.level
  OR NEW.is_open_mat IS NOT OLD.is_open_mat OR NEW.drop_in_policy IS NOT OLD.drop_in_policy
  OR NEW.drop_in_fee_cents IS NOT OLD.drop_in_fee_cents OR NEW.drop_in_currency IS NOT OLD.drop_in_currency
  OR NEW.source_url IS NOT OLD.source_url
)
BEGIN SELECT RAISE(ABORT, 'approved content is locked; transition to needs_review first'); END;

-- Per-type extensions: matching event type, and locked while the event is approved.
CREATE TRIGGER seminar_details_type BEFORE INSERT ON seminar_details
WHEN (SELECT event_type FROM events WHERE id = NEW.event_id) IS NOT 'seminar'
BEGIN SELECT RAISE(ABORT, 'seminar_details requires a seminar event'); END;
CREATE TRIGGER superfight_details_type BEFORE INSERT ON superfight_details
WHEN (SELECT event_type FROM events WHERE id = NEW.event_id) IS NOT 'superfight'
BEGIN SELECT RAISE(ABORT, 'superfight_details requires a superfight event'); END;
CREATE TRIGGER camp_details_type BEFORE INSERT ON camp_details
WHEN (SELECT event_type FROM events WHERE id = NEW.event_id) IS NOT 'camp'
BEGIN SELECT RAISE(ABORT, 'camp_details requires a camp event'); END;
CREATE TRIGGER competition_details_type BEFORE INSERT ON competition_details
WHEN (SELECT event_type FROM events WHERE id = NEW.event_id) NOT IN ('tournament', 'open_competition')
BEGIN SELECT RAISE(ABORT, 'competition_details requires a tournament or open_competition event'); END;
CREATE TRIGGER seminar_details_lock BEFORE UPDATE ON seminar_details
WHEN (SELECT status FROM events WHERE id = OLD.event_id) = 'approved'
BEGIN SELECT RAISE(ABORT, 'approved content is locked; transition to needs_review first'); END;
CREATE TRIGGER superfight_details_lock BEFORE UPDATE ON superfight_details
WHEN (SELECT status FROM events WHERE id = OLD.event_id) = 'approved'
BEGIN SELECT RAISE(ABORT, 'approved content is locked; transition to needs_review first'); END;
CREATE TRIGGER camp_details_lock BEFORE UPDATE ON camp_details
WHEN (SELECT status FROM events WHERE id = OLD.event_id) = 'approved'
BEGIN SELECT RAISE(ABORT, 'approved content is locked; transition to needs_review first'); END;
CREATE TRIGGER competition_details_lock BEFORE UPDATE ON competition_details
WHEN (SELECT status FROM events WHERE id = OLD.event_id) = 'approved'
BEGIN SELECT RAISE(ABORT, 'approved content is locked; transition to needs_review first'); END;

-- Rule 7: no hard deletes of listings. Rejected rows stay, so a rejected
-- event cannot quietly return under the same dedupe key.
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events are never deleted; transition to rejected'); END;
CREATE TRIGGER venues_no_delete BEFORE DELETE ON venues
BEGIN SELECT RAISE(ABORT, 'venues are never deleted; transition to rejected'); END;
CREATE TRIGGER venue_sessions_no_delete BEFORE DELETE ON venue_sessions
BEGIN SELECT RAISE(ABORT, 'venue_sessions are never deleted; transition to rejected'); END;
