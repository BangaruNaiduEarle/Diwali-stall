-- Payment management after prepared 0021. Do not apply to existing databases as part of implementation.
-- Existing finalized requests get only a verified agreed-amount account, never fabricated receipts.
CREATE TABLE request_payment_accounts (
  request_id TEXT PRIMARY KEY NOT NULL REFERENCES customer_requests(id) ON DELETE RESTRICT,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE RESTRICT,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  location_id TEXT NOT NULL REFERENCES business_locations(id),
  season_id TEXT NOT NULL REFERENCES business_seasons(id),
  amount_due_paise INTEGER NOT NULL CHECK(typeof(amount_due_paise) = 'integer' AND amount_due_paise > 0 AND amount_due_paise <= 9007199254740991),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TRIGGER payment_account_scope BEFORE INSERT ON request_payment_accounts
WHEN NOT EXISTS (SELECT 1 FROM customer_requests r JOIN quotations q ON q.customer_request_id = r.id
  JOIN business_locations l ON l.id = r.location_id
  WHERE r.id = NEW.request_id AND r.status = 'closed' AND r.finalization_status = 'finalized'
    AND q.id = NEW.quotation_id AND q.status != 'void'
    AND r.location_id = NEW.location_id AND r.season_id = NEW.season_id
    AND q.location_id = NEW.location_id AND q.season_id = NEW.season_id
    AND l.business_id = NEW.business_id AND q.accepted_amount_paise = NEW.amount_due_paise)
BEGIN SELECT RAISE(ABORT,'payment_account_scope_mismatch'); END;
CREATE TRIGGER payment_account_no_update BEFORE UPDATE ON request_payment_accounts
BEGIN SELECT RAISE(ABORT,'payment_accounts_immutable'); END;
CREATE TRIGGER payment_account_no_delete BEFORE DELETE ON request_payment_accounts
BEGIN SELECT RAISE(ABORT,'payment_accounts_immutable'); END;

INSERT INTO request_payment_accounts(request_id,quotation_id,business_id,location_id,season_id,amount_due_paise)
SELECT r.id,q.id,l.business_id,r.location_id,r.season_id,q.accepted_amount_paise
FROM customer_requests r JOIN business_locations l ON l.id = r.location_id
JOIN quotations q ON q.customer_request_id = r.id AND q.location_id = r.location_id AND q.season_id = r.season_id
WHERE r.status = 'closed' AND r.finalization_status = 'finalized' AND q.status != 'void'
  AND typeof(q.accepted_amount_paise) = 'integer' AND q.accepted_amount_paise > 0 AND q.accepted_amount_paise <= 9007199254740991
  AND (SELECT count(*) FROM quotations active_quote WHERE active_quote.customer_request_id = r.id AND active_quote.status != 'void') = 1;

CREATE TRIGGER payment_account_on_closure AFTER UPDATE OF status,finalization_status ON customer_requests
WHEN NEW.status = 'closed' AND NEW.finalization_status = 'finalized'
  AND (OLD.status IS NOT NEW.status OR OLD.finalization_status IS NOT NEW.finalization_status)
BEGIN
  INSERT INTO request_payment_accounts(request_id,quotation_id,business_id,location_id,season_id,amount_due_paise)
  SELECT NEW.id,q.id,l.business_id,NEW.location_id,NEW.season_id,q.accepted_amount_paise
  FROM quotations q JOIN business_locations l ON l.id = NEW.location_id
  WHERE q.customer_request_id = NEW.id AND q.location_id = NEW.location_id AND q.season_id = NEW.season_id AND q.status != 'void'
    AND typeof(q.accepted_amount_paise) = 'integer' AND q.accepted_amount_paise > 0 AND q.accepted_amount_paise <= 9007199254740991
    AND NOT EXISTS (SELECT 1 FROM request_payment_accounts a WHERE a.request_id = NEW.id);
END;

CREATE TABLE request_payment_ledger (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id TEXT NOT NULL UNIQUE,
  operation_id TEXT NOT NULL UNIQUE CHECK(length(operation_id) BETWEEN 8 AND 128),
  payload_fingerprint TEXT NOT NULL,
  request_id TEXT NOT NULL REFERENCES request_payment_accounts(request_id) ON DELETE RESTRICT,
  business_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK(entry_type IN ('PAYMENT','HOLD','RELEASE_HOLD')),
  amount_paise INTEGER NOT NULL CHECK(typeof(amount_paise) = 'integer' AND amount_paise BETWEEN 0 AND 9007199254740991),
  recording_mode TEXT NOT NULL CHECK(recording_mode IN ('ONLINE','OFFLINE')),
  payment_method TEXT CHECK(payment_method IN ('CASH','UPI','CARD','BANK','OTHER')),
  reference TEXT CHECK(reference IS NULL OR (length(reference) BETWEEN 1 AND 200 AND length(trim(reference)) > 0)),
  normalized_reference TEXT,
  details TEXT CHECK(details IS NULL OR length(details) <= 500),
  actor_user_id TEXT NOT NULL,
  actor_name TEXT,
  actor_role TEXT NOT NULL CHECK(actor_role IN ('owner','super_admin')),
  device_id TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK((entry_type = 'PAYMENT' AND amount_paise > 0 AND payment_method IS NOT NULL)
    OR (entry_type != 'PAYMENT' AND amount_paise = 0 AND payment_method IS NULL AND reference IS NULL AND normalized_reference IS NULL)),
  CHECK(entry_type != 'PAYMENT' OR payment_method NOT IN ('UPI','CARD','BANK') OR normalized_reference IS NOT NULL)
  ,CHECK((reference IS NULL AND normalized_reference IS NULL) OR (reference IS NOT NULL AND normalized_reference IS upper(replace(trim(reference),' ',''))))
);
CREATE INDEX idx_payment_ledger_scope ON request_payment_ledger(business_id,location_id,season_id,request_id,sequence);
CREATE INDEX idx_payment_ledger_request ON request_payment_ledger(request_id,sequence);
CREATE UNIQUE INDEX idx_payment_transaction_reference
ON request_payment_ledger(business_id,location_id,season_id,payment_method,normalized_reference)
WHERE entry_type = 'PAYMENT' AND payment_method != 'CASH' AND normalized_reference IS NOT NULL;

CREATE TRIGGER payment_ledger_no_update BEFORE UPDATE ON request_payment_ledger
BEGIN SELECT RAISE(ABORT,'payment_ledger_append_only'); END;
CREATE TRIGGER payment_ledger_no_delete BEFORE DELETE ON request_payment_ledger
BEGIN SELECT RAISE(ABORT,'payment_ledger_append_only'); END;

CREATE TRIGGER payment_ledger_scope BEFORE INSERT ON request_payment_ledger
WHEN NOT EXISTS (
  SELECT 1 FROM request_payment_accounts a JOIN customer_requests r ON r.id = a.request_id
  JOIN business_locations l ON l.id = a.location_id JOIN businesses b ON b.id = l.business_id
  JOIN location_seasons ls ON ls.location_id = a.location_id AND ls.season_id = a.season_id
  JOIN business_seasons s ON s.id = a.season_id
  JOIN admin_users u ON u.id = NEW.actor_user_id
  JOIN season_members sm ON sm.admin_user_id = u.id AND sm.season_id = a.season_id
  JOIN location_members lm ON lm.admin_user_id = u.id AND lm.season_id = a.season_id AND lm.location_id = a.location_id
  WHERE a.request_id = NEW.request_id AND a.business_id = NEW.business_id AND a.location_id = NEW.location_id AND a.season_id = NEW.season_id
    AND r.location_id = a.location_id AND r.season_id = a.season_id AND r.status = 'closed' AND r.finalization_status = 'finalized'
    AND b.id = a.business_id AND b.status = 'active' AND l.status = 'active' AND ls.status = 'active' AND s.status = 'active'
    AND (u.disabled_at IS NULL OR u.disabled_at = '') AND (sm.disabled_at IS NULL OR sm.disabled_at = '') AND (lm.disabled_at IS NULL OR lm.disabled_at = '')
    AND sm.role IN ('owner','super_admin') AND lm.role IN ('owner','super_admin')
    AND NEW.actor_role = CASE WHEN sm.role = 'super_admin' OR lm.role = 'super_admin' THEN 'super_admin' ELSE 'owner' END
)
BEGIN SELECT RAISE(ABORT,'payment_scope_or_authority_changed'); END;

CREATE TRIGGER payment_balance_guard BEFORE INSERT ON request_payment_ledger
WHEN NEW.entry_type = 'PAYMENT' AND NEW.amount_paise > (
  SELECT a.amount_due_paise - COALESCE((SELECT sum(p.amount_paise) FROM request_payment_ledger p WHERE p.request_id = a.request_id AND p.entry_type = 'PAYMENT'),0)
  FROM request_payment_accounts a WHERE a.request_id = NEW.request_id)
BEGIN SELECT RAISE(ABORT,'payment_exceeds_outstanding'); END;

CREATE TRIGGER payment_hold_guard BEFORE INSERT ON request_payment_ledger
WHEN NEW.entry_type = 'HOLD' AND (
  SELECT a.amount_due_paise - COALESCE((SELECT sum(p.amount_paise) FROM request_payment_ledger p WHERE p.request_id = a.request_id AND p.entry_type = 'PAYMENT'),0)
  FROM request_payment_accounts a WHERE a.request_id = NEW.request_id) = 0
BEGIN SELECT RAISE(ABORT,'paid_request_cannot_be_held'); END;

CREATE TRIGGER payment_workflow_event AFTER INSERT ON request_payment_ledger
BEGIN
  UPDATE customer_requests SET revision = revision + 1 WHERE id = NEW.request_id;
  INSERT INTO request_workflow_events(event_id,request_id,business_id,location_id,season_id,
    actor_user_id,actor_name,actor_role,device_id,event_type,occurred_at,received_at,revision,metadata_json)
  SELECT 'payment-event-' || NEW.payment_id,NEW.request_id,NEW.business_id,NEW.location_id,NEW.season_id,
    NEW.actor_user_id,NEW.actor_name,NEW.actor_role,NEW.device_id,
    CASE NEW.entry_type WHEN 'PAYMENT' THEN 'payment_recorded' WHEN 'HOLD' THEN 'payment_hold_set' ELSE 'payment_hold_released' END,
    NEW.occurred_at,NEW.received_at,r.revision,
    json_object('paymentId',NEW.payment_id,'operationId',NEW.operation_id,'entryType',NEW.entry_type,
      'amountPaise',NEW.amount_paise,'recordingMode',NEW.recording_mode,'paymentMethod',NEW.payment_method,'reference',NEW.reference)
  FROM customer_requests r WHERE r.id = NEW.request_id;
END;

CREATE VIEW request_payment_summary_base AS
SELECT r.id AS request_id,r.location_id,r.season_id,l.business_id,r.revision,
  r.status AS request_status,r.finalization_status,a.amount_due_paise,a.quotation_id,
  COALESCE((SELECT sum(p.amount_paise) FROM request_payment_ledger p WHERE p.request_id = a.request_id AND p.entry_type = 'PAYMENT'),0) AS received_paise,
  (SELECT count(*) FROM request_payment_ledger p WHERE p.request_id = a.request_id AND p.entry_type = 'PAYMENT') AS payment_count,
  (SELECT max(p.received_at) FROM request_payment_ledger p WHERE p.request_id = a.request_id AND p.entry_type = 'PAYMENT') AS last_payment_at,
  (SELECT p.entry_type FROM request_payment_ledger p WHERE p.request_id = a.request_id AND p.entry_type IN ('HOLD','RELEASE_HOLD') ORDER BY p.sequence DESC LIMIT 1) AS hold_state
FROM customer_requests r JOIN business_locations l ON l.id = r.location_id
LEFT JOIN request_payment_accounts a ON a.request_id = r.id AND a.location_id = r.location_id AND a.season_id = r.season_id AND a.business_id = l.business_id;

CREATE VIEW request_payment_summaries AS
SELECT *,amount_due_paise - received_paise AS outstanding_paise,
  CASE WHEN amount_due_paise IS NULL THEN 'UNPAID'
    WHEN received_paise = amount_due_paise THEN 'PAID'
    WHEN hold_state = 'HOLD' THEN 'HOLD' WHEN received_paise > 0 THEN 'PARTIAL' ELSE 'UNPAID' END AS payment_status
FROM request_payment_summary_base;
