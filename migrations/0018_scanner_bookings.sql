-- Scanners can add people to an activity's "To come" list (book them), move
-- them to another activity, or remove a booking, as well as scanning.
INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES ('role_scanner', 'activity.bookings');
UPDATE roles SET description = 'Scans people in and out of the site and every activity, and adds people to come to an activity. Sees names, groups and photo markers.'
 WHERE id = 'role_scanner';
