-- Dietary notes are now stored encrypted (0036), which makes the stored value
-- longer than the 80-character limit the original table checked. Rebuild the
-- table without that database check. The app still limits notes to 80
-- characters before they're encrypted (dietaryEntrySchema).
PRAGMA defer_foreign_keys = true;

CREATE TABLE dietary_entries_new (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  registration_id  TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  category         TEXT NOT NULL CHECK (category IN ('allergy', 'intolerance', 'medical_diet', 'religious_cultural', 'preference')),
  item             TEXT NOT NULL,
  severity         TEXT NOT NULL DEFAULT 'standard' CHECK (severity IN ('standard', 'anaphylactic')),
  note             TEXT NOT NULL DEFAULT '',
  created_by       TEXT NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL
);
INSERT INTO dietary_entries_new (id, event_id, registration_id, category, item, severity, note, created_by, created_at)
  SELECT id, event_id, registration_id, category, item, severity, note, created_by, created_at FROM dietary_entries;
DROP TABLE dietary_entries;
ALTER TABLE dietary_entries_new RENAME TO dietary_entries;
CREATE INDEX dietary_entries_registration ON dietary_entries (registration_id);
CREATE INDEX dietary_entries_event ON dietary_entries (event_id);
