-- Phase 2B: optional supplier/company label (present on some future imports; not in current src/data/products.js).
ALTER TABLE products ADD COLUMN company TEXT;
