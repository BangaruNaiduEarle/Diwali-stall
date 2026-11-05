-- Informational request metadata only. Never used by the payment ledger.
ALTER TABLE customer_requests ADD COLUMN payment_preference_status TEXT
  CHECK (payment_preference_status IS NULL OR payment_preference_status IN ('paid', 'unpaid', 'partial_paid'));
ALTER TABLE customer_requests ADD COLUMN payment_preference_mode TEXT
  CHECK (payment_preference_mode IS NULL OR payment_preference_mode IN ('online', 'offline'));
ALTER TABLE customer_requests ADD COLUMN payment_preference_received_paise INTEGER
  CHECK (payment_preference_received_paise IS NULL OR
    (typeof(payment_preference_received_paise) = 'integer' AND payment_preference_received_paise > 0
      AND payment_preference_status = 'partial_paid'));
