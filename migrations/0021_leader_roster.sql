-- Leader roster: duties (gate, kitchen, first aid…) at a time and place,
-- and the leaders assigned to each. A leader sees their own duties on the
-- page their lanyard opens.
CREATE TABLE duties (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  location    TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  starts_at   TEXT NOT NULL,
  ends_at     TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX duties_event ON duties (event_id, starts_at);

CREATE TABLE duty_assignments (
  duty_id          TEXT NOT NULL REFERENCES duties(id) ON DELETE CASCADE,
  registration_id  TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  created_at       TEXT NOT NULL,
  PRIMARY KEY (duty_id, registration_id)
);
CREATE INDEX duty_assignments_person ON duty_assignments (registration_id);
