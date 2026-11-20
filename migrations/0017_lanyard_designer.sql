-- The lanyard designer (additive; the old uploaded artwork in lanyard_templates is left alone).

-- One design per camp: card size, orientation, and what's on the front and
-- back (JSON, validated by src/shared/lanyardDesign.ts on every save).
CREATE TABLE lanyard_designs (
  event_id    TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  design      TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- Images placed on a design (logos, photos, backgrounds). PNG, JPEG or WebP,
-- checked by their first bytes; never SVG.
CREATE TABLE lanyard_assets (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  content_type  TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  data          TEXT NOT NULL, -- base64
  bytes         INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX lanyard_assets_event ON lanyard_assets (event_id);
