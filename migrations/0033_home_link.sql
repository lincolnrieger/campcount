-- The link people get when they go to the camp's own address (<camp>.campcount.com)
-- and choose Participant. At most one per camp.
ALTER TABLE participant_links ADD COLUMN is_home INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX participant_links_home ON participant_links (event_id) WHERE is_home = 1;
