-- Nothing derived from dietary or medical notes is kept any more. Previously
-- each registration kept a keyed fingerprint of its imported dietary note (to
-- spot changed notes), and People kept short fingerprints of notes that had
-- been read. Both are cleared, and so is each event's fingerprint key. All
-- that's kept is whether someone's dietary needs have been reviewed.

UPDATE registrations
   SET dietary_checked = CASE WHEN dietary_checked IS NOT NULL OR dietary_source_hash IS NOT NULL THEN '["*"]' END,
       dietary_source_hash = NULL;

UPDATE events SET fingerprint_key = '';
