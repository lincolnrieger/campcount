-- Which sections count as youth at this camp (everyone else is an adult).
-- Rovers are youth at some camps and helpers at others. Leaders are always
-- adults. A JSON list of section names.
ALTER TABLE events ADD COLUMN youth_sections TEXT NOT NULL DEFAULT '["Joeys","Cubs","Scouts","Venturers","Rovers","Other"]';
