-- Snapshot public family-pack selling price at request time (admin quotation uses this; not client-supplied).
PRAGMA foreign_keys = ON;

ALTER TABLE customer_request_items ADD COLUMN unit_price_paise INTEGER
  CHECK (unit_price_paise IS NULL OR unit_price_paise > 0);
