-- ARCHITECTURE.md section 9, "one company, many hostnames" (founder ruling,
-- 2026-09-16): ratified the day the Smoothcomp terms review itself landed,
-- never migrated until now. Found the same day as EXC-148's tournaments
-- columns and the profile-column allow-list in the sibling excelsior-master
-- repo -- same shape, same standing rule (2026-09-18 founder ruling): a
-- documented-but-unbuilt schema object is a defect, not a blocker.
--
-- This one is load-bearing, not cosmetic: sources.host is 'smoothcomp.com',
-- the parent domain, but the company's own architecture doc says its parent
-- URLs REDIRECT to each organizer's real subdomain (e.g.
-- fujibjj.smoothcomp.com), and fetcher.js's fetchOnce() never follows a
-- redirect on purpose ("the destination is a path nobody reviewed"). Without
-- a real alias hostname to target, a fetch to the source's own host can
-- reach nothing but a 3xx response. Additive only.
--
-- Activation (rule 5: "before an alias becomes active, a human checks that
-- subdomain for a terms page of its own") is deliberately NOT performed by
-- this migration for any real hostname -- that is a human legal-judgment
-- step this migration only makes possible, never substitutes for. No row is
-- inserted here.
CREATE TABLE source_aliases (
  id                          TEXT PRIMARY KEY,
  source_id                   TEXT NOT NULL REFERENCES sources (id),
  host                        TEXT NOT NULL UNIQUE CHECK (host = lower(host)),
  added_by                    TEXT NOT NULL REFERENCES reviewers (email),
  added_on                    TEXT NOT NULL CHECK (date(added_on) IS added_on),
  -- Rule 4: a daily robots check PER ALIAS, independent of the company's
  -- own sources.robots_* fields (which cover the parent host's robots.txt,
  -- read once at the company-level review).
  robots_sha256               TEXT CHECK (robots_sha256 IS NULL OR length(robots_sha256) = 64),
  robots_read_on              TEXT CHECK (robots_read_on IS NULL OR date(robots_read_on) IS robots_read_on),
  -- Rule 5: the organizer subdomain's own terms page, if one exists. Null
  -- is a real, recorded answer ("none exists"), not a missing field --
  -- organizer_terms_checked_on is what the CHECK below actually requires.
  organizer_terms_url         TEXT CHECK (organizer_terms_url IS NULL OR organizer_terms_url LIKE 'https://%' OR organizer_terms_url LIKE 'http://%'),
  organizer_terms_checked_on  TEXT CHECK (organizer_terms_checked_on IS NULL OR date(organizer_terms_checked_on) IS organizer_terms_checked_on),
  active                      INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    active = 0 OR (
      robots_sha256 IS NOT NULL AND robots_read_on IS NOT NULL
      AND organizer_terms_checked_on IS NOT NULL
    )
  )
);

CREATE INDEX source_aliases_source_id_idx ON source_aliases (source_id);
