-- Customer-facing estimate reference (DWL-XXXXXXXX), separate from internal request id.
PRAGMA foreign_keys = ON;

ALTER TABLE customer_requests ADD COLUMN public_reference TEXT;

CREATE UNIQUE INDEX idx_customer_requests_public_reference
  ON customer_requests (public_reference)
  WHERE public_reference IS NOT NULL;
