-- Teams can be open (anyone can join) or locked (join with the team's code,
-- or be added by someone already on it).
ALTER TABLE teams ADD COLUMN locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1));
ALTER TABLE teams ADD COLUMN join_code TEXT;
CREATE UNIQUE INDEX teams_join_code ON teams (activity_id, join_code) WHERE join_code IS NOT NULL;
