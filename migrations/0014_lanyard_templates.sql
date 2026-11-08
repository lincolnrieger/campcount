-- Each event can upload its own lanyard artwork, made from the blank
-- template CampCount gives out. One image per card size and side. Without
-- one, the built-in design is used. CampCount always prints the name, QR
-- code, typed code and section on top.
CREATE TABLE lanyard_templates (
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  size          TEXT NOT NULL CHECK (size IN ('lanyard', 'badge')),
  side          TEXT NOT NULL CHECK (side IN ('front', 'back')),
  content_type  TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg')),
  data          TEXT NOT NULL, -- base64
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (event_id, size, side)
);

-- With artwork on the front: print the coloured section band over it (on),
-- or just the section word, so the artwork's own band shows (off).
ALTER TABLE events ADD COLUMN lanyard_print_band INTEGER NOT NULL DEFAULT 1 CHECK (lanyard_print_band IN (0, 1));
