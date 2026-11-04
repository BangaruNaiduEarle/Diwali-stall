-- Platform Admin identity (explicit registry; no auto-promotion from owner/super_admin).
PRAGMA foreign_keys = ON;

CREATE TABLE platform_admins (
  admin_user_id TEXT NOT NULL PRIMARY KEY
    REFERENCES admin_users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
