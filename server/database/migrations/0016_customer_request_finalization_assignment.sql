-- Quick Bill / stall finalization queue and optional assignee (NULL = legacy / public web requests).
PRAGMA foreign_keys = ON;

ALTER TABLE customer_requests ADD COLUMN finalization_status TEXT
  CHECK (finalization_status IS NULL OR finalization_status IN ('pending', 'finalized'));

ALTER TABLE customer_requests ADD COLUMN assigned_to_email TEXT;

CREATE INDEX idx_customer_requests_finalization_status
  ON customer_requests (finalization_status);
