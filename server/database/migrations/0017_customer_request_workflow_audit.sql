-- Assignment / closure actor audit (future actions only; existing rows stay NULL).

ALTER TABLE customer_requests ADD COLUMN assigned_by_email TEXT;

ALTER TABLE customer_requests ADD COLUMN assigned_at TEXT;

ALTER TABLE customer_requests ADD COLUMN closed_by_email TEXT;

ALTER TABLE customer_requests ADD COLUMN closed_at TEXT;
