-- Prepared only. Requires 0020, 0021 and 0022; no historical device identity is invented.
CREATE TABLE offline_sync_devices (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  location_id TEXT NOT NULL REFERENCES business_locations(id),
  season_id TEXT NOT NULL REFERENCES business_seasons(id),
  user_id TEXT NOT NULL REFERENCES admin_users(id),
  device_id TEXT NOT NULL CHECK(length(device_id) BETWEEN 8 AND 128),
  token_hash TEXT NOT NULL CHECK(length(token_hash) = 64),
  registered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  disabled_at TEXT,
  PRIMARY KEY(business_id,location_id,season_id,user_id,device_id)
);
CREATE TRIGGER offline_device_identity_immutable BEFORE UPDATE ON offline_sync_devices
WHEN NEW.business_id IS NOT OLD.business_id OR NEW.location_id IS NOT OLD.location_id
  OR NEW.season_id IS NOT OLD.season_id OR NEW.user_id IS NOT OLD.user_id
  OR NEW.device_id IS NOT OLD.device_id OR NEW.token_hash IS NOT OLD.token_hash
  OR NEW.registered_at IS NOT OLD.registered_at
BEGIN SELECT RAISE(ABORT,'offline_device_identity_immutable'); END;
CREATE TRIGGER offline_device_no_delete BEFORE DELETE ON offline_sync_devices
BEGIN SELECT RAISE(ABORT,'offline_device_retained'); END;

CREATE TABLE offline_sync_receipts (
  operation_id TEXT PRIMARY KEY NOT NULL,
  fingerprint TEXT NOT NULL CHECK(length(fingerprint) = 64),
  business_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK(actor_role IN ('admin','super_admin','owner')),
  captured_role TEXT CHECK(captured_role IS NULL OR captured_role IN ('admin','super_admin','owner')),
  operation_type TEXT NOT NULL CHECK(operation_type IN ('CREATE','EDIT','AGREEMENT','CLOSE','PAYMENT')),
  parent_operation_id TEXT,
  resolution_of TEXT,
  request_id TEXT NOT NULL REFERENCES customer_requests(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision > 0),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY(business_id,location_id,season_id,user_id,device_id)
    REFERENCES offline_sync_devices(business_id,location_id,season_id,user_id,device_id)
);
CREATE INDEX idx_offline_receipt_scope ON offline_sync_receipts(business_id,location_id,season_id,user_id,device_id,request_id);
CREATE TRIGGER offline_receipt_no_update BEFORE UPDATE ON offline_sync_receipts
BEGIN SELECT RAISE(ABORT,'offline_receipts_append_only'); END;
CREATE TRIGGER offline_receipt_no_delete BEFORE DELETE ON offline_sync_receipts
BEGIN SELECT RAISE(ABORT,'offline_receipts_append_only'); END;

-- This executes inside the existing business batch, rechecking authority at commit.
CREATE TRIGGER offline_receipt_authority BEFORE INSERT ON offline_sync_receipts
WHEN NOT EXISTS (
  SELECT 1 FROM offline_sync_devices d
  JOIN business_locations l ON l.id = d.location_id AND l.business_id = d.business_id
  JOIN businesses b ON b.id = d.business_id
  JOIN business_seasons s ON s.id = d.season_id
  JOIN location_seasons ls ON ls.location_id = d.location_id AND ls.season_id = d.season_id
  JOIN admin_users u ON u.id = d.user_id
  JOIN season_members sm ON sm.admin_user_id = u.id AND sm.season_id = d.season_id
  JOIN location_members lm ON lm.admin_user_id = u.id AND lm.location_id = d.location_id AND lm.season_id = d.season_id
  JOIN customer_requests r ON r.id = NEW.request_id AND r.location_id = d.location_id AND r.season_id = d.season_id
  WHERE d.business_id = NEW.business_id AND d.location_id = NEW.location_id AND d.season_id = NEW.season_id
    AND d.user_id = NEW.user_id AND d.device_id = NEW.device_id AND d.disabled_at IS NULL
    AND b.status = 'active' AND l.status = 'active' AND s.status = 'active' AND ls.status = 'active'
    AND (u.disabled_at IS NULL OR u.disabled_at = '') AND (sm.disabled_at IS NULL OR sm.disabled_at = '') AND (lm.disabled_at IS NULL OR lm.disabled_at = '')
    AND sm.role IN ('admin','super_admin','owner') AND lm.role IN ('admin','super_admin','owner')
    AND NEW.actor_role = CASE WHEN sm.role = 'admin' OR lm.role = 'admin' THEN 'admin'
      WHEN sm.role = 'super_admin' OR lm.role = 'super_admin' THEN 'super_admin' ELSE 'owner' END
    AND (NEW.operation_type IN ('CREATE','EDIT') OR NEW.actor_role IN ('owner','super_admin'))
    AND r.revision = NEW.revision
)
BEGIN SELECT RAISE(ABORT,'offline_authority_changed'); END;
