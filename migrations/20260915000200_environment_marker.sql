-- Environment marker: each database records which environment it is.
-- The console reads this row to draw its PRODUCTION or STAGING badge, and
-- refuses every write when the row is missing or disagrees with the
-- console's own configuration. The badge is therefore proven by the database
-- it is connected to, not asserted by a setting.
--
-- Insert exactly one row, once per database, after this migration:
--   staging:    INSERT INTO environment_marker (id, name) VALUES (1, 'staging');
--   production: INSERT INTO environment_marker (id, name) VALUES (1, 'production');
-- The row can never be changed or deleted afterwards.

CREATE TABLE environment_marker (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  name       TEXT NOT NULL CHECK (name IN ('production', 'staging')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TRIGGER environment_marker_no_update BEFORE UPDATE ON environment_marker
BEGIN SELECT RAISE(ABORT, 'environment_marker never changes'); END;
CREATE TRIGGER environment_marker_no_delete BEFORE DELETE ON environment_marker
BEGIN SELECT RAISE(ABORT, 'environment_marker never changes'); END;
CREATE TRIGGER environment_marker_no_replace BEFORE INSERT ON environment_marker
WHEN EXISTS (SELECT 1 FROM environment_marker)
BEGIN SELECT RAISE(ABORT, 'environment_marker never changes'); END;
