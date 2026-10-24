-- Activity leader: runs one activity (or every activity if assigned to the
-- whole event). Sees the activity's roster and bookings, checks people in
-- and out, and can add or remove bookings for that activity. No access to
-- other activities, meals, dietary detail or event settings.
INSERT INTO roles (id, key, name, description, scope, is_system, created_at) VALUES
  ('role_activity_leader', 'activity_leader', 'Activity leader',
   'Runs an activity: sees who is booked and who is there, checks people in and out, and manages its bookings.',
   'activity', 1, '2026-10-24T00:00:00.000Z');
INSERT INTO role_permissions (role_id, permission) VALUES
  ('role_activity_leader', 'event.view'),
  ('role_activity_leader', 'activity.scan'),
  ('role_activity_leader', 'activity.view_roster'),
  ('role_activity_leader', 'activity.bookings'),
  ('role_activity_leader', 'photo.view_status');

-- Event managers can manage bookings for every activity too.
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'activity.bookings');
