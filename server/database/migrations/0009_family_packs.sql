-- Family packs module (separate from products catalogue lines).
PRAGMA foreign_keys = ON;

CREATE TABLE family_packs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_description TEXT NOT NULL DEFAULT '',
  selling_price_paise INTEGER NOT NULL CHECK (selling_price_paise > 0),
  pack_label TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_family_packs_public_list
  ON family_packs (archived, active, sort_order, id);

CREATE TABLE family_pack_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_pack_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  url TEXT NOT NULL,
  is_cover INTEGER NOT NULL DEFAULT 0 CHECK (is_cover IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (family_pack_id) REFERENCES family_packs (id) ON DELETE CASCADE
);

CREATE INDEX idx_family_pack_images_pack
  ON family_pack_images (family_pack_id, sort_order);

CREATE TABLE family_pack_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_pack_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 1 AND quantity <= 999),
  unit_label TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (family_pack_id) REFERENCES family_packs (id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products (id)
);

CREATE INDEX idx_family_pack_items_pack
  ON family_pack_items (family_pack_id, sort_order);

ALTER TABLE customer_request_items ADD COLUMN family_pack_id TEXT REFERENCES family_packs (id);
