-- Meal items: the products that make up a meal (a breakfast can have 50),
-- each with its own ingredients, allergens and dietary labels, and dietary
-- alternatives that replace an item for the people who need them.
-- meal_services.ingredients stays, shown as "Additional notes".
CREATE TABLE meal_items (
  id                TEXT PRIMARY KEY,
  meal_id           TEXT NOT NULL REFERENCES meal_services(id) ON DELETE CASCADE,
  event_id          TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL,
  ingredients       TEXT NOT NULL DEFAULT '',
  contains          TEXT NOT NULL DEFAULT '[]',   -- JSON list of allergens
  may_contain       TEXT NOT NULL DEFAULT '[]',
  dietary           TEXT NOT NULL DEFAULT '[]',   -- JSON list of dietary labels
  is_alternative    INTEGER NOT NULL DEFAULT 0 CHECK (is_alternative IN (0, 1)),
  replaces_item_id  TEXT REFERENCES meal_items(id) ON DELETE SET NULL,
  alternative_for   TEXT NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'tbc')),
  internal_notes    TEXT NOT NULL DEFAULT '',     -- staff only, never shown to participants
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX meal_items_meal ON meal_items (meal_id, sort_order);
CREATE INDEX meal_items_event ON meal_items (event_id);
