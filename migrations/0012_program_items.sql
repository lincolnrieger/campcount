-- Programme items: things on the camp schedule that aren't booked or scanned
-- (Registrations open, Welcome, Club Splash, Movies, Depart).
ALTER TABLE activities ADD COLUMN kind TEXT NOT NULL DEFAULT 'activity' CHECK (kind IN ('activity', 'program'));
