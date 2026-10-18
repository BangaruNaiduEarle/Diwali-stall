-- Production admin login: password hashes + server-side sessions (no Cloudflare Access required).
PRAGMA foreign_keys = ON;

ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'
  CHECK (role IN ('owner', 'admin'));

ALTER TABLE admin_users ADD COLUMN password_hash TEXT;

ALTER TABLE admin_users ADD COLUMN disabled_at TEXT;

CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,
  FOREIGN KEY (admin_user_id) REFERENCES admin_users (id) ON DELETE CASCADE
);

CREATE INDEX idx_admin_sessions_user ON admin_sessions (admin_user_id);
CREATE INDEX idx_admin_sessions_expires ON admin_sessions (expires_at);

CREATE TABLE admin_login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_normalized TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now')),
  success INTEGER NOT NULL DEFAULT 0 CHECK (success IN (0, 1))
);

CREATE INDEX idx_admin_login_attempts_email_time ON admin_login_attempts (email_normalized, attempted_at);
CREATE INDEX idx_admin_login_attempts_ip_time ON admin_login_attempts (ip_hash, attempted_at);
