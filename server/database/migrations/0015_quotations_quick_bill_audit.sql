-- Quick Bill bargaining audit on quotations (NULL = legacy / non-stall quotes).
PRAGMA foreign_keys = ON;

ALTER TABLE quotations ADD COLUMN pricing_mode TEXT
  CHECK (pricing_mode IS NULL OR pricing_mode IN ('selling', 'bargain'));

ALTER TABLE quotations ADD COLUMN selling_subtotal_paise INTEGER
  CHECK (selling_subtotal_paise IS NULL OR selling_subtotal_paise >= 0);

ALTER TABLE quotations ADD COLUMN final_subtotal_paise INTEGER
  CHECK (final_subtotal_paise IS NULL OR final_subtotal_paise >= 0);

ALTER TABLE quotations ADD COLUMN bargain_floor_paise INTEGER
  CHECK (bargain_floor_paise IS NULL OR bargain_floor_paise >= 0);

ALTER TABLE quotations ADD COLUMN accepted_amount_paise INTEGER
  CHECK (accepted_amount_paise IS NULL OR accepted_amount_paise >= 0);
