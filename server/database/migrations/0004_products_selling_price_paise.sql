-- Phase 5: optional public list price for admin/D1 (integer paise; public site may still use src/data/products.js until synced).
ALTER TABLE products ADD COLUMN selling_price_paise INTEGER CHECK (selling_price_paise IS NULL OR selling_price_paise >= 0);
