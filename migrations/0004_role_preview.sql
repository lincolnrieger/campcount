-- "View as": a platform admin can preview any event as any role. The preview
-- lives on the admin's own session, so stopping it needs no new sign-in.
ALTER TABLE sessions ADD COLUMN preview_event_id TEXT REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN preview_role_id TEXT REFERENCES roles(id);
ALTER TABLE sessions ADD COLUMN preview_activity_id TEXT REFERENCES activities(id) ON DELETE SET NULL;
