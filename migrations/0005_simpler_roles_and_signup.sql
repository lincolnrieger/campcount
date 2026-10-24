-- Simpler roles: Event manager (runs the event), Scanner (site + every
-- activity) and Meal team (meals + dietary). Existing assignments move over:
--   camp_director, event_manager       -> event_manager (full event control)
--   activity_leader, gate_volunteer    -> scanner (all activities and the site)
--   meal_leader                        -> meal_leader, renamed "Meal team"
-- Accounts also get an email_verified_at, so self sign-up can tidy away
-- addresses that were never confirmed.

ALTER TABLE users ADD COLUMN email_verified_at TEXT;
UPDATE users SET email_verified_at = updated_at
 WHERE EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id) OR password_hash IS NOT NULL;

INSERT INTO roles (id, key, name, description, scope, is_system, created_at) VALUES
  ('role_scanner', 'scanner', 'Scanner', 'Scans people in and out of the site and every activity. Sees names, groups and photo markers.', 'event', 1, '2026-10-24T00:00:00.000Z');

INSERT INTO role_permissions (role_id, permission) VALUES ('role_scanner', 'event.view'), ('role_scanner', 'site.scan'), ('role_scanner', 'activity.scan'), ('role_scanner', 'activity.view_roster'), ('role_scanner', 'photo.view_status');

-- Event manager takes over everything a camp director could do.
DELETE FROM role_permissions WHERE role_id = 'role_event_manager';
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'event.view'), ('role_event_manager', 'event.configure'), ('role_event_manager', 'event.close'), ('role_event_manager', 'staff.manage'), ('role_event_manager', 'stations.manage'), ('role_event_manager', 'roster.view'), ('role_event_manager', 'roster.import'), ('role_event_manager', 'roster.edit'), ('role_event_manager', 'credentials.manage'), ('role_event_manager', 'activities.manage'), ('role_event_manager', 'meals.manage'), ('role_event_manager', 'meal.scan'), ('role_event_manager', 'site.scan'), ('role_event_manager', 'dietary.view_alert'), ('role_event_manager', 'dietary.view_detail'), ('role_event_manager', 'dietary.edit'), ('role_event_manager', 'photo.view_status'), ('role_event_manager', 'attendance.correct'), ('role_event_manager', 'reports.view'), ('role_event_manager', 'reports.export'), ('role_event_manager', 'reports.export_sensitive'), ('role_event_manager', 'activity.scan'), ('role_event_manager', 'activity.view_roster');
UPDATE roles SET name = 'Event manager',
  description = 'Runs the event: settings, roster, staff, lanyards, scanning, reports and close-out.'
 WHERE id = 'role_event_manager';
UPDATE roles SET name = 'Meal team',
  description = 'Scans people at meals, sees allergy alerts and who has eaten, and gets the catering list.'
 WHERE id = 'role_meal_leader';
UPDATE roles SET name = 'Platform admin' WHERE id = 'role_platform_admin';

-- Avoid duplicate active assignments before merging.
UPDATE assignments SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE revoked_at IS NULL AND role_id = 'role_event_manager'
   AND EXISTS (SELECT 1 FROM assignments d WHERE d.revoked_at IS NULL AND d.role_id = 'role_camp_director'
                AND d.user_id = assignments.user_id AND d.event_id = assignments.event_id);
UPDATE assignments SET role_id = 'role_event_manager' WHERE role_id = 'role_camp_director';

UPDATE assignments SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE revoked_at IS NULL AND role_id IN ('role_activity_leader', 'role_gate_volunteer')
   AND id NOT IN (SELECT min(id) FROM assignments
                   WHERE revoked_at IS NULL AND role_id IN ('role_activity_leader', 'role_gate_volunteer')
                   GROUP BY user_id, event_id);
UPDATE assignments SET role_id = 'role_scanner', activity_id = NULL WHERE role_id IN ('role_activity_leader', 'role_gate_volunteer');

UPDATE sessions SET preview_role_id = NULL, preview_event_id = NULL, preview_activity_id = NULL
 WHERE preview_role_id IN ('role_camp_director', 'role_activity_leader', 'role_gate_volunteer');

DELETE FROM role_permissions WHERE role_id IN ('role_camp_director', 'role_activity_leader', 'role_gate_volunteer');
DELETE FROM roles WHERE id IN ('role_camp_director', 'role_activity_leader', 'role_gate_volunteer');
