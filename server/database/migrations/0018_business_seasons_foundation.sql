-- Multi-season foundation (phase 1): registry, membership mirror, season_id column + backfill.
-- Does not change admin_users.role, PKs, or existing unique indexes.
-- Application continues to ignore season_id, season_members, and platform_settings until a later release.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Season registry
-- ---------------------------------------------------------------------------

CREATE TABLE business_seasons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO business_seasons (id, code, label, status)
VALUES ('season-2026', '2026', 'Diwali 2026', 'active');

-- ---------------------------------------------------------------------------
-- Public catalogue pointer (manual platform_admin selection in a later app release)
-- ---------------------------------------------------------------------------

CREATE TABLE platform_settings (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  public_catalogue_season_id TEXT NOT NULL
    REFERENCES business_seasons (id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by_email TEXT
);

INSERT INTO platform_settings (singleton_id, public_catalogue_season_id)
VALUES (1, 'season-2026');

-- ---------------------------------------------------------------------------
-- Season-scoped roles (mirror of admin_users.role for default season; app still uses admin_users.role)
-- ---------------------------------------------------------------------------

CREATE TABLE season_members (
  season_id TEXT NOT NULL
    REFERENCES business_seasons (id) ON DELETE CASCADE,
  admin_user_id TEXT NOT NULL
    REFERENCES admin_users (id) ON DELETE CASCADE,
  role TEXT NOT NULL
    CHECK (role IN ('owner', 'super_admin', 'admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  disabled_at TEXT,
  PRIMARY KEY (season_id, admin_user_id)
);

CREATE INDEX idx_season_members_user
  ON season_members (admin_user_id);

INSERT INTO season_members (season_id, admin_user_id, role, disabled_at)
SELECT
  'season-2026',
  id,
  role,
  disabled_at
FROM admin_users
WHERE role IN ('owner', 'super_admin', 'admin');

-- ---------------------------------------------------------------------------
-- season_id on approved tables (nullable; D1/SQLite disallows REFERENCES + non-NULL DEFAULT on ADD COLUMN)
-- ---------------------------------------------------------------------------

ALTER TABLE categories ADD COLUMN season_id TEXT REFERENCES business_seasons (id);

ALTER TABLE products ADD COLUMN season_id TEXT REFERENCES business_seasons (id);

ALTER TABLE family_packs ADD COLUMN season_id TEXT REFERENCES business_seasons (id);

ALTER TABLE customer_requests ADD COLUMN season_id TEXT REFERENCES business_seasons (id);

ALTER TABLE quotations ADD COLUMN season_id TEXT REFERENCES business_seasons (id);

ALTER TABLE private_rates ADD COLUMN season_id TEXT REFERENCES business_seasons (id);

ALTER TABLE product_purchase_rates ADD COLUMN season_id TEXT REFERENCES business_seasons (id);

UPDATE categories SET season_id = 'season-2026' WHERE season_id IS NULL;
UPDATE products SET season_id = 'season-2026' WHERE season_id IS NULL;
UPDATE family_packs SET season_id = 'season-2026' WHERE season_id IS NULL;
UPDATE customer_requests SET season_id = 'season-2026' WHERE season_id IS NULL;
UPDATE quotations SET season_id = 'season-2026' WHERE season_id IS NULL;
UPDATE private_rates SET season_id = 'season-2026' WHERE season_id IS NULL;
UPDATE product_purchase_rates SET season_id = 'season-2026' WHERE season_id IS NULL;

CREATE INDEX idx_categories_season ON categories (season_id);
CREATE INDEX idx_products_season ON products (season_id);
CREATE INDEX idx_family_packs_season ON family_packs (season_id);
CREATE INDEX idx_customer_requests_season ON customer_requests (season_id);
CREATE INDEX idx_quotations_season ON quotations (season_id);
CREATE INDEX idx_private_rates_season ON private_rates (season_id);
CREATE INDEX idx_product_purchase_rates_season ON product_purchase_rates (season_id);
