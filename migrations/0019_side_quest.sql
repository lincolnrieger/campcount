-- Super Splash Side Quest: a secret game. When a participant's phone (opened
-- from their own lanyard) opens another participant's lanyard link, it
-- "collects" that person. Off unless the camp turns it on.
ALTER TABLE events ADD COLUMN feature_side_quest INTEGER NOT NULL DEFAULT 0 CHECK (feature_side_quest IN (0, 1));

-- Who has collected whom. Counted once per pair.
CREATE TABLE side_quest_collections (
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  collector_id  TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  collected_id  TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (collector_id, collected_id),
  CHECK (collector_id <> collected_id)
);
CREATE INDEX side_quest_event ON side_quest_collections (event_id, collector_id);
CREATE INDEX side_quest_collected ON side_quest_collections (collected_id);
