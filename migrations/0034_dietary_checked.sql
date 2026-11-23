-- Import & check: whose dietary notes have been read, kept on the roster so it
-- doesn't depend on one browser. A JSON list of short fingerprints of the notes
-- that were read (never the notes themselves). '["*"]': checked before this was
-- kept, notes unknown. NULL: not checked through Import & check.
ALTER TABLE registrations ADD COLUMN dietary_checked TEXT;
UPDATE registrations SET dietary_checked = '["*"]'
 WHERE id IN (SELECT target_id FROM audit_log WHERE action = 'dietary.update' AND target_type = 'registration')
    OR id IN (SELECT registration_id FROM dietary_entries);
