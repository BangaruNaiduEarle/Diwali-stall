-- Phase 5.2: supplier purchase/cost rates (Excel "Rate" column) — separate from private_rates (Excel X4 selling).
PRAGMA foreign_keys = ON;

CREATE TABLE product_purchase_rates (
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

CREATE UNIQUE INDEX idx_product_purchase_rates_one_current
  ON product_purchase_rates (product_id)
  WHERE effective_to IS NULL;

CREATE INDEX idx_product_purchase_rates_product ON product_purchase_rates (product_id);
