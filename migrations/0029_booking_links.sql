-- Links to book one activity, for emailing before camp (People type their
-- membership number). Their own code, separate from the sign-up kiosk's, so
-- sharing the links never shares the kiosk.
ALTER TABLE events ADD COLUMN booking_code TEXT;
CREATE UNIQUE INDEX events_booking_code ON events (booking_code) WHERE booking_code IS NOT NULL;
