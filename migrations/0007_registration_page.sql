-- Public registration page for each event.
--
-- A parent or leader fills in the form at /register/<code>, confirms their
-- email with a code, and the request waits for an event manager to approve
-- it (or is approved straight away if the event allows that). Only approved
-- requests join the roster, get a lanyard and appear on scanners.
ALTER TABLE events ADD COLUMN registration_code TEXT;          -- random; changing it retires the old link
ALTER TABLE events ADD COLUMN registration_open INTEGER NOT NULL DEFAULT 0 CHECK (registration_open IN (0, 1));
ALTER TABLE events ADD COLUMN registration_auto_approve INTEGER NOT NULL DEFAULT 0 CHECK (registration_auto_approve IN (0, 1));
ALTER TABLE events ADD COLUMN registration_closes_on TEXT;     -- last day to register (event-local date), optional
ALTER TABLE events ADD COLUMN registration_limit INTEGER CHECK (registration_limit IS NULL OR registration_limit > 0);
CREATE UNIQUE INDEX events_registration_code ON events (registration_code) WHERE registration_code IS NOT NULL;

-- SENSITIVE: contact email and dietary needs. Purged with the event's other
-- sensitive data (90 days after it closes); unconfirmed requests after a day.
CREATE TABLE registration_requests (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status            TEXT NOT NULL CHECK (status IN ('unconfirmed', 'pending', 'approved', 'declined')),
  member_number     TEXT NOT NULL,   -- GUEST-xxxx for people who aren't members
  first_name        TEXT NOT NULL,
  preferred_name    TEXT NOT NULL DEFAULT '',
  last_name         TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('youth', 'adult')),
  section           TEXT NOT NULL,
  group_name        TEXT NOT NULL DEFAULT '',
  position          TEXT NOT NULL DEFAULT '',
  photo_consent     TEXT NOT NULL CHECK (photo_consent IN ('yes', 'no', 'unknown')),
  dietary           TEXT NOT NULL DEFAULT '[]',   -- JSON array of structured dietary entries
  contact_email     TEXT NOT NULL,
  code_hash         TEXT,
  code_expires_at   TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  registration_id   TEXT REFERENCES registrations(id) ON DELETE SET NULL,
  decided_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at        TEXT,
  created_at        TEXT NOT NULL,
  confirmed_at      TEXT
);
CREATE INDEX registration_requests_event ON registration_requests (event_id, status);
