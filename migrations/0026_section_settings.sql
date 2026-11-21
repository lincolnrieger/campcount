-- A camp's own sections (Settings › Sections): renamed built-ins and added
-- ones, each with its lanyard word, colour and whether it counts as youth.
-- JSON; NULL means the built-in sections. Which are youth stays in
-- events.youth_sections (by name).
ALTER TABLE events ADD COLUMN section_settings TEXT;
