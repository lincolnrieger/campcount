-- When each lanyard was last downloaded for printing (People › Lanyards › Print),
-- so new registrations after a print run are easy to find. A reissued lanyard
-- is a new credential, so it starts unprinted.
ALTER TABLE credentials ADD COLUMN printed_at TEXT;
