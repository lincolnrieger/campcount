-- Links for everyone (emailed before camp): open one, type a membership
-- number, and see your camp page with only the parts the link switches on
-- (programme, booking, teams, food). A camp can have several.
CREATE TABLE participant_links (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  features    INTEGER NOT NULL DEFAULT 15,   -- bits: 1 programme, 2 book, 4 teams, 8 food
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX participant_links_event ON participant_links (event_id);
