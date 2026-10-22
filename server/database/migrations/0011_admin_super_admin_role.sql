-- Extend admin_users.role to allow super_admin (full product pricing visibility like owner).
PRAGMA foreign_keys = OFF;

CREATE TABLE admin_users_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'super_admin', 'admin')),
  password_hash TEXT,
  disabled_at TEXT
);

INSERT INTO admin_users_new (
  id, email, display_name, created_at, updated_at, role, password_hash, disabled_at
)
SELECT id, email, display_name, created_at, updated_at, role, password_hash, disabled_at
FROM admin_users;

DROP TABLE admin_users;

ALTER TABLE admin_users_new RENAME TO admin_users;

PRAGMA foreign_keys = ON;
