-- Optional manually set final price (integer paise); not used for public catalogue billing.
ALTER TABLE products ADD COLUMN final_price_paise INTEGER CHECK (final_price_paise IS NULL OR final_price_paise >= 0);
