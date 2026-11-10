-- Where and how the name, role (Leader / Youth), group, QR code and typed code
-- print on each card size, chosen in Settings › Lanyards. JSON, one entry per
-- card size; an empty entry ({} or a null size) uses the built-in layout.
ALTER TABLE events ADD COLUMN lanyard_layout TEXT NOT NULL DEFAULT '{}';
