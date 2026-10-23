-- Passwords for day-to-day sign-in (email code is still used on first sign-in
-- and for "forgot password"), and demo data for testing.

ALTER TABLE users ADD COLUMN password_hash TEXT;      -- pbkdf2-sha256 + server pepper; never the password
ALTER TABLE users ADD COLUMN password_set_at TEXT;
ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1));

-- Demo events hold invented people only and can be deleted in one step.
ALTER TABLE events ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1));
