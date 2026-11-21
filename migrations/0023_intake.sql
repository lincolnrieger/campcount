-- Import & check: what each MyScout and Consent2Go export said about each
-- person, and who has been checked against it.
--
-- Only fingerprints of the files' contents are kept (one per column, keyed
-- with the camp's secret), never the values themselves. They let a later
-- upload tell which people changed, or appeared in the other system, since
-- they were last checked.

-- The latest sighting of a person in each source.
CREATE TABLE intake_sightings (
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_number  TEXT NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('myscout', 'consent2go')),
  name           TEXT NOT NULL,
  section        TEXT NOT NULL DEFAULT '',
  group_name     TEXT NOT NULL DEFAULT '',
  fields         TEXT NOT NULL, -- JSON: column name -> fingerprint
  first_seen_at  TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  PRIMARY KEY (event_id, member_number, source)
);

-- A person's check: the fingerprints it was made against, and the checklist.
CREATE TABLE intake_checks (
  event_id           TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_number      TEXT NOT NULL,
  myscout_fields     TEXT,          -- JSON fingerprints when checked; NULL if not in MyScout then
  consent2go_fields  TEXT,
  checklist          TEXT NOT NULL DEFAULT '{}',
  complete           INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
  left_off           INTEGER NOT NULL DEFAULT 0 CHECK (left_off IN (0, 1)),
  checked_at         TEXT NOT NULL,
  checked_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (event_id, member_number)
);
