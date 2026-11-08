-- 1. Stations can be deleted once they're finished. Scans keep pointing at
--    the station (they're append-only), so a deleted station is hidden
--    rather than removed.
ALTER TABLE stations ADD COLUMN deleted_at TEXT;

-- 2. How lanyards show someone without photo consent. One of:
--    black_border, colour_border, red_dot, camera_icon, none.
--    photo_marker_colour is used by colour_border. photo_marker_label prints
--    a small "No photos" next to the section.
ALTER TABLE events ADD COLUMN photo_marker TEXT NOT NULL DEFAULT 'black_border'
  CHECK (photo_marker IN ('black_border', 'colour_border', 'red_dot', 'camera_icon', 'none'));
ALTER TABLE events ADD COLUMN photo_marker_colour TEXT NOT NULL DEFAULT '#B3261E';
ALTER TABLE events ADD COLUMN photo_marker_label INTEGER NOT NULL DEFAULT 1 CHECK (photo_marker_label IN (0, 1));

-- 3. Team events (Soccer, Basketball…): participants make or join teams.
--    A team event is an activity with team settings, so it can be scheduled,
--    scanned and given its own leader like any other activity. Being on a
--    team books the person onto the activity.
CREATE TABLE team_events (
  activity_id        TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  event_id           TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  min_size           INTEGER NOT NULL DEFAULT 1 CHECK (min_size >= 1),
  max_size           INTEGER CHECK (max_size IS NULL OR max_size >= min_size),
  max_teams          INTEGER CHECK (max_teams IS NULL OR max_teams >= 1),
  registration_open  INTEGER NOT NULL DEFAULT 0 CHECK (registration_open IN (0, 1)),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX team_events_event ON team_events (event_id);

CREATE TABLE teams (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  activity_id  TEXT NOT NULL REFERENCES team_events(activity_id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (activity_id, name COLLATE NOCASE)
);
CREATE INDEX teams_activity ON teams (activity_id);

-- One team per person per team event.
CREATE TABLE team_members (
  team_id          TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  activity_id      TEXT NOT NULL REFERENCES team_events(activity_id) ON DELETE CASCADE,
  registration_id  TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  event_id         TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source           TEXT NOT NULL CHECK (source IN ('manual', 'self_signup')),
  joined_at        TEXT NOT NULL,
  PRIMARY KEY (team_id, registration_id),
  UNIQUE (activity_id, registration_id)
);
CREATE INDEX team_members_registration ON team_members (registration_id);
