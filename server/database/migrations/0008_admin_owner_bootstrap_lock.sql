-- Atomic first-owner bootstrap gate (singleton row) + backfill when owner already exists.
PRAGMA foreign_keys = ON;

CREATE TABLE admin_owner_bootstrap (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  owner_user_id TEXT NOT NULL,
  bootstrapped_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO admin_owner_bootstrap (singleton_id, owner_user_id)
SELECT 1, id
FROM admin_users
WHERE role = 'owner'
  AND password_hash IS NOT NULL
  AND trim(password_hash) != ''
  AND disabled_at IS NULL
ORDER BY updated_at DESC
LIMIT 1;
