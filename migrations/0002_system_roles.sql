-- System roles. Editable through the interface later; ids are stable.

INSERT INTO roles (id, key, name, description, scope, is_system, created_at) VALUES ('role_platform_admin', 'platform_admin', 'Platform Administrator', 'Manages users and events across CampCount. Sees every event and its staff, but not participant data unless also assigned to the event.', 'platform', 1, '2026-10-23T00:00:00.000Z');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_platform_admin', 'platform.users.manage');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_platform_admin', 'platform.events.create');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_platform_admin', 'platform.events.oversee');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_platform_admin', 'platform.audit.read');

INSERT INTO roles (id, key, name, description, scope, is_system, created_at) VALUES ('role_camp_director', 'camp_director', 'Camp Director', 'Runs one event: configuration, roster, staff, stations, corrections, exports and close-out.', 'event', 1, '2026-10-23T00:00:00.000Z');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'event.view');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'event.configure');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'event.close');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'staff.manage');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'stations.manage');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'roster.view');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'roster.import');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'roster.edit');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'credentials.manage');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'activities.manage');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'meals.manage');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'meal.scan');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'site.scan');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'dietary.view_alert');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'dietary.view_detail');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'dietary.edit');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'photo.view_status');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'attendance.correct');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'reports.view');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'reports.export');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'reports.export_sensitive');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'activity.scan');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_camp_director', 'activity.view_roster');

INSERT INTO roles (id, key, name, description, scope, is_system, created_at) VALUES ('role_event_manager', 'event_manager', 'Event Manager', 'Helps run an event. Cannot assign staff, close the event, or see named dietary detail.', 'event', 1, '2026-10-23T00:00:00.000Z');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'event.view');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'event.configure');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'stations.manage');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'roster.view');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'roster.import');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'roster.edit');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'credentials.manage');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'activities.manage');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'meals.manage');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'meal.scan');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'site.scan');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'photo.view_status');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'attendance.correct');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'reports.view');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'reports.export');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'activity.scan');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_event_manager', 'activity.view_roster');

INSERT INTO roles (id, key, name, description, scope, is_system, created_at) VALUES ('role_activity_leader', 'activity_leader', 'Activity Leader', 'Scans participants in and out of assigned activities. Sees the activity roster and photo-consent markers only.', 'activity', 1, '2026-10-23T00:00:00.000Z');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_activity_leader', 'event.view');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_activity_leader', 'photo.view_status');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_activity_leader', 'activity.scan');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_activity_leader', 'activity.view_roster');

INSERT INTO roles (id, key, name, description, scope, is_system, created_at) VALUES ('role_meal_leader', 'meal_leader', 'Meal Leader', 'Scans meals, sees allergy alerts at the scan, and reads the catering dietary list.', 'event', 1, '2026-10-23T00:00:00.000Z');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_meal_leader', 'event.view');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_meal_leader', 'meal.scan');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_meal_leader', 'dietary.view_alert');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_meal_leader', 'dietary.view_detail');

INSERT INTO roles (id, key, name, description, scope, is_system, created_at) VALUES ('role_gate_volunteer', 'gate_volunteer', 'Gate Volunteer', 'Scans people on and off site.', 'event', 1, '2026-10-23T00:00:00.000Z');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_gate_volunteer', 'event.view');
INSERT INTO role_permissions (role_id, permission) VALUES ('role_gate_volunteer', 'site.scan');
