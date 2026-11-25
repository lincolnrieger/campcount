-- Only a person's name, participant ID (membership number) and role
-- (participant or leader) are kept. Everything else about people is deleted
-- here, and the columns and table that held it are removed:
--
-- * dietary needs and allergies (the whole dietary_entries table), and the
--   markers of who had been reviewed
-- * group, level, photo consent and car registration
--
-- Activity bookings, teams, duties and scans are kept. The spreadsheet
-- import is gone from the app (with its history table), so nothing new can
-- arrive this way either.
-- The camp settings that only existed for these (dietary and photo switches,
-- photo markers, level settings) go too, as do the import, dietary and
-- photo permissions.

DROP TABLE dietary_entries;
DROP TABLE import_jobs;

ALTER TABLE registrations DROP COLUMN level;
ALTER TABLE registrations DROP COLUMN group_name;
ALTER TABLE registrations DROP COLUMN photo_consent;
ALTER TABLE registrations DROP COLUMN car_rego;
ALTER TABLE registrations DROP COLUMN car_rego_asked_at;
ALTER TABLE registrations DROP COLUMN dietary_source_hash;
ALTER TABLE registrations DROP COLUMN dietary_review_pending;
ALTER TABLE registrations DROP COLUMN dietary_checked;

ALTER TABLE events DROP COLUMN feature_dietary;
ALTER TABLE events DROP COLUMN feature_photo;
ALTER TABLE events DROP COLUMN photo_marker;
ALTER TABLE events DROP COLUMN photo_marker_colour;
ALTER TABLE events DROP COLUMN photo_marker_label;
ALTER TABLE events DROP COLUMN youth_levels;
ALTER TABLE events DROP COLUMN level_settings;
ALTER TABLE events DROP COLUMN fingerprint_key;

DELETE FROM role_permissions WHERE permission IN ('roster.import', 'reports.export_sensitive', 'dietary.view_alert', 'dietary.view_detail', 'dietary.edit', 'photo.view_status');

-- Role descriptions that mentioned what's gone.
UPDATE roles SET description = 'Scans people at meals and sees who has eaten.' WHERE id = 'role_meal_leader';
UPDATE roles SET description = 'Scans people in and out of the site and every activity, and adds people to come to an activity. Sees names and roles.' WHERE id = 'role_scanner';
UPDATE roles SET description = 'Scans participants in and out of assigned activities. Sees the activity roster only.' WHERE id = 'role_activity_leader';
