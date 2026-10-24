-- 1. The public registration page is removed: the roster is managed by the
--    event team (MyScout import or Add person). Requests and settings go.
DROP TABLE registration_requests;
DROP INDEX events_registration_code;
ALTER TABLE events DROP COLUMN registration_code;
ALTER TABLE events DROP COLUMN registration_open;
ALTER TABLE events DROP COLUMN registration_auto_approve;
ALTER TABLE events DROP COLUMN registration_closes_on;
ALTER TABLE events DROP COLUMN registration_limit;

-- 2. Activity sign-up: people book activity sessions themselves at a
--    sign-up screen (or from their own lanyard link). The screen's link
--    holds this random code; making a new one retires the old link.
ALTER TABLE events ADD COLUMN signup_code TEXT;
CREATE UNIQUE INDEX events_signup_code ON events (signup_code) WHERE signup_code IS NOT NULL;

-- 3. The meal team keeps allergy alerts at the scan but no longer gets the
--    catering dietary report.
DELETE FROM role_permissions WHERE role_id = 'role_meal_leader' AND permission = 'dietary.view_detail';
UPDATE roles SET description = 'Scans people at meals, sees allergy alerts at the scan, and sees who has eaten.'
 WHERE id = 'role_meal_leader';
