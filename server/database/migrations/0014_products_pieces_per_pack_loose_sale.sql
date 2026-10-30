ALTER TABLE products ADD COLUMN pieces_per_pack INTEGER CHECK (pieces_per_pack IS NULL OR pieces_per_pack > 0);
ALTER TABLE products ADD COLUMN allow_loose_sale INTEGER NOT NULL DEFAULT 0 CHECK (allow_loose_sale IN (0, 1));
