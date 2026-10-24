-- One-time links for setting or resetting a password.
--
-- "setup" links go to people whose account someone else created (an admin,
-- or an event manager adding new staff); "reset" links are made by an admin
-- for someone who has forgotten their password. Only a hash of the token is
-- stored, a link works once, and making a new link for a person retires any
-- earlier unused one.
CREATE TABLE password_links (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('setup', 'reset')),
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX password_links_user ON password_links (user_id);
