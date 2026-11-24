-- Which levels count as youth at this camp (everyone else is an adult).
-- Rangers are youth at some camps and helpers at others. Leaders are always
-- adults. A JSON list of level names.
ALTER TABLE events ADD COLUMN youth_sections TEXT NOT NULL DEFAULT '["Participants"]';
