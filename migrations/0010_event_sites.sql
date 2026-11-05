-- Each event can have its own address (<subdomain>.campcount.com) and branding.
ALTER TABLE events ADD COLUMN subdomain TEXT;
ALTER TABLE events ADD COLUMN brand_color TEXT;
CREATE UNIQUE INDEX events_subdomain ON events (subdomain) WHERE subdomain IS NOT NULL;

-- Logos live apart from events so event queries stay small.
CREATE TABLE event_logos (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  data TEXT NOT NULL, -- base64
  updated_at TEXT NOT NULL
);
