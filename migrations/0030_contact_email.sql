-- Who people email about their camp (shown on booking links, e.g. to change a booking).
ALTER TABLE events ADD COLUMN contact_email TEXT NOT NULL DEFAULT '';
