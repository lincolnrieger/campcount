-- A banner graphic for one camp, shown across the top of each participant's
-- page in place of the camp's name. PNG, JPEG or WebP, checked by its first
-- bytes; never SVG.
CREATE TABLE event_banners (
  event_id      TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  content_type  TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  data          TEXT NOT NULL, -- base64
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  updated_at    TEXT NOT NULL
);
