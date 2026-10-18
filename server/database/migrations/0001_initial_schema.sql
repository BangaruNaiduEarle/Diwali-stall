-- Phase 2A: core schema (money in integer paise; no public price columns)
-- Wrangler tracks applied files in D1's d1_migrations table (no custom schema_migrations).

PRAGMA foreign_keys = ON;

CREATE TABLE categories (
  slug TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  category_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  pack TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  stock_status TEXT NOT NULL DEFAULT 'available'
    CHECK (stock_status IN ('available', 'soldout', 'sold-out')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  images_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_slug) REFERENCES categories (slug)
);

CREATE INDEX idx_products_category ON products (category_slug);
CREATE INDEX idx_products_active ON products (active);
CREATE INDEX idx_products_sort ON products (sort_order, id);

-- Owner allowlist; identity proven via Cloudflare Access (email claim), not app passwords.
CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE private_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  unit_rate_paise INTEGER NOT NULL CHECK (unit_rate_paise >= 0),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE UNIQUE INDEX idx_private_rates_one_current
  ON private_rates (product_id)
  WHERE effective_to IS NULL;

CREATE INDEX idx_private_rates_product ON private_rates (product_id);

CREATE TABLE customer_requests (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'reviewing', 'quoted', 'closed', 'void')),
  customer_name TEXT,
  customer_phone TEXT,
  customer_area TEXT,
  pickup_preference TEXT,
  customer_note TEXT,
  source TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (source IN ('whatsapp', 'web', 'manual')),
  raw_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_customer_requests_status ON customer_requests (status);
CREATE INDEX idx_customer_requests_created ON customer_requests (created_at);

CREATE TABLE customer_request_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  line_number INTEGER NOT NULL CHECK (line_number >= 1),
  product_id TEXT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 1 AND quantity <= 99),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (request_id) REFERENCES customer_requests (id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products (id),
  UNIQUE (request_id, line_number)
);

CREATE INDEX idx_customer_request_items_request ON customer_request_items (request_id);

CREATE TABLE quotations (
  id TEXT PRIMARY KEY,
  customer_request_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'void')),
  customer_name TEXT,
  customer_phone TEXT,
  customer_note TEXT,
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  subtotal_paise INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_paise >= 0),
  adjustment_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  wa_message_text TEXT,
  created_by_email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_request_id) REFERENCES customer_requests (id)
);

CREATE INDEX idx_quotations_status ON quotations (status);
CREATE INDEX idx_quotations_created ON quotations (created_at);
CREATE INDEX idx_quotations_request ON quotations (customer_request_id);

CREATE TABLE quotation_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id TEXT NOT NULL,
  line_number INTEGER NOT NULL CHECK (line_number >= 1),
  product_id TEXT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 1 AND quantity <= 99),
  unit_rate_paise INTEGER NOT NULL CHECK (unit_rate_paise >= 0),
  line_total_paise INTEGER NOT NULL CHECK (line_total_paise >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (quotation_id) REFERENCES quotations (id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products (id),
  UNIQUE (quotation_id, line_number),
  CHECK (line_total_paise = quantity * unit_rate_paise)
);

CREATE INDEX idx_quotation_items_quotation ON quotation_items (quotation_id);
