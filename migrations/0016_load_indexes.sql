-- Indexes for the busy moments at camp (additive; safe while the old version is serving).

-- Every participant sign-up request lists that person's bookings and checks
-- for clashes. Without this, each request read every booking in every camp.
CREATE INDEX IF NOT EXISTS activity_bookings_registration ON activity_bookings (registration_id);
-- The retention purge and event delete remove a camp's bookings.
CREATE INDEX IF NOT EXISTS activity_bookings_event ON activity_bookings (event_id);

-- Finding every camp a person is on (shared names), and cascades when people are removed.
CREATE INDEX IF NOT EXISTS registrations_person ON registrations (person_id);

-- Cascades and lookups when a card is replaced or removed.
CREATE INDEX IF NOT EXISTS scans_credential ON scans (credential_id);
