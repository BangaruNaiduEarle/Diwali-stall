-- Prepared migration only. Apply to an explicitly authorized local database;
-- development tests apply it only to disposable fixtures. Requires 0023–0027.
CREATE UNIQUE INDEX offline_payment_recovery_once ON offline_sync_receipts(resolution_of)
  WHERE resolution_of IS NOT NULL AND operation_type='PAYMENT';
CREATE TRIGGER payment_recovered_capture_guard BEFORE INSERT ON request_payment_ledger
WHEN EXISTS (SELECT 1 FROM offline_sync_receipts WHERE resolution_of=NEW.operation_id AND operation_type='PAYMENT')
BEGIN SELECT RAISE(ABORT,'payment_capture_already_recovered'); END;
CREATE TABLE offline_final_price_devices (
  business_id TEXT NOT NULL, location_id TEXT NOT NULL, season_id TEXT NOT NULL,
  user_id TEXT NOT NULL, device_id TEXT NOT NULL, public_key_json TEXT NOT NULL CHECK(json_valid(public_key_json)),
  PRIMARY KEY(business_id,location_id,season_id,user_id,device_id),
  FOREIGN KEY(business_id,location_id,season_id,user_id,device_id)
    REFERENCES offline_sync_devices(business_id,location_id,season_id,user_id,device_id)
);
CREATE TRIGGER final_price_device_no_update BEFORE UPDATE ON offline_final_price_devices
BEGIN SELECT RAISE(ABORT,'final_price_device_key_immutable'); END;
CREATE TRIGGER final_price_device_no_delete BEFORE DELETE ON offline_final_price_devices
BEGIN SELECT RAISE(ABORT,'final_price_device_key_retained'); END;

CREATE TABLE offline_final_price_grants (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL, location_id TEXT NOT NULL, season_id TEXT NOT NULL,
  user_id TEXT NOT NULL, device_id TEXT NOT NULL, owner_user_id TEXT NOT NULL REFERENCES admin_users(id),
  can_finalize INTEGER NOT NULL CHECK(can_finalize IN (0,1)),
  issued_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  certificate_json TEXT NOT NULL CHECK(json_valid(certificate_json)),
  final_prices_json TEXT NOT NULL CHECK(json_valid(final_prices_json)),
  revoked_at TEXT, revoked_by TEXT REFERENCES admin_users(id),
  CHECK(expires_at > issued_at AND julianday(expires_at) - julianday(issued_at) <= 1.000001),
  FOREIGN KEY(business_id,location_id,season_id,user_id,device_id)
    REFERENCES offline_final_price_devices(business_id,location_id,season_id,user_id,device_id)
);
CREATE INDEX final_price_grant_scope ON offline_final_price_grants(business_id,location_id,season_id,user_id,device_id);
CREATE TABLE offline_final_price_invalidations (
  grant_id TEXT PRIMARY KEY NOT NULL REFERENCES offline_final_price_grants(id),
  reason TEXT NOT NULL,
  invalidated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER final_price_invalidation_no_update BEFORE UPDATE ON offline_final_price_invalidations
BEGIN SELECT RAISE(ABORT,'offline_grant_invalidations_append_only'); END;
CREATE TRIGGER final_price_invalidation_no_delete BEFORE DELETE ON offline_final_price_invalidations
BEGIN SELECT RAISE(ABORT,'offline_grant_invalidations_append_only'); END;
-- Membership re-enabling or role promotion must not silently revive a grant.
CREATE TRIGGER final_price_location_authority_changed AFTER UPDATE OF role,disabled_at ON location_members
WHEN NEW.role IS NOT OLD.role OR NEW.disabled_at IS NOT OLD.disabled_at BEGIN
  INSERT OR IGNORE INTO offline_final_price_invalidations(grant_id,reason)
  SELECT id,'location_membership_changed' FROM offline_final_price_grants
  WHERE location_id=OLD.location_id AND season_id=OLD.season_id AND (user_id=OLD.admin_user_id OR owner_user_id=OLD.admin_user_id);
END;
CREATE TRIGGER final_price_location_authority_removed AFTER DELETE ON location_members BEGIN
  INSERT OR IGNORE INTO offline_final_price_invalidations(grant_id,reason)
  SELECT id,'location_membership_removed' FROM offline_final_price_grants
  WHERE location_id=OLD.location_id AND season_id=OLD.season_id AND (user_id=OLD.admin_user_id OR owner_user_id=OLD.admin_user_id);
END;
CREATE TRIGGER final_price_season_authority_changed AFTER UPDATE OF role,disabled_at ON season_members
WHEN NEW.role IS NOT OLD.role OR NEW.disabled_at IS NOT OLD.disabled_at BEGIN
  INSERT OR IGNORE INTO offline_final_price_invalidations(grant_id,reason)
  SELECT id,'season_membership_changed' FROM offline_final_price_grants
  WHERE season_id=OLD.season_id AND (user_id=OLD.admin_user_id OR owner_user_id=OLD.admin_user_id);
END;
CREATE TRIGGER final_price_season_authority_removed AFTER DELETE ON season_members BEGIN
  INSERT OR IGNORE INTO offline_final_price_invalidations(grant_id,reason)
  SELECT id,'season_membership_removed' FROM offline_final_price_grants
  WHERE season_id=OLD.season_id AND (user_id=OLD.admin_user_id OR owner_user_id=OLD.admin_user_id);
END;
CREATE TRIGGER final_price_user_authority_changed AFTER UPDATE OF disabled_at ON admin_users
WHEN NEW.disabled_at IS NOT OLD.disabled_at BEGIN
  INSERT OR IGNORE INTO offline_final_price_invalidations(grant_id,reason)
  SELECT id,'user_availability_changed' FROM offline_final_price_grants WHERE user_id=OLD.id OR owner_user_id=OLD.id;
END;
CREATE TRIGGER final_price_device_authority_changed AFTER UPDATE OF disabled_at ON offline_sync_devices
WHEN NEW.disabled_at IS NOT OLD.disabled_at BEGIN
  INSERT OR IGNORE INTO offline_final_price_invalidations(grant_id,reason)
  SELECT id,'device_availability_changed' FROM offline_final_price_grants
  WHERE business_id=OLD.business_id AND location_id=OLD.location_id AND season_id=OLD.season_id
    AND user_id=OLD.user_id AND device_id=OLD.device_id;
END;

-- The same view is used by issuance and commit-time checks. Both issuer roles
-- must still be Owner; target must still be an enabled effective Admin.
CREATE VIEW live_offline_final_price_grants AS
SELECT g.* FROM offline_final_price_grants g
JOIN offline_sync_devices d ON d.business_id=g.business_id AND d.location_id=g.location_id AND d.season_id=g.season_id AND d.user_id=g.user_id AND d.device_id=g.device_id
JOIN business_locations l ON l.id=g.location_id AND l.business_id=g.business_id
JOIN businesses b ON b.id=g.business_id
JOIN business_seasons s ON s.id=g.season_id
JOIN location_seasons ls ON ls.location_id=g.location_id AND ls.season_id=g.season_id
JOIN admin_users target ON target.id=g.user_id
JOIN season_members tsm ON tsm.admin_user_id=g.user_id AND tsm.season_id=g.season_id
JOIN location_members tlm ON tlm.admin_user_id=g.user_id AND tlm.location_id=g.location_id AND tlm.season_id=g.season_id
JOIN admin_users issuer ON issuer.id=g.owner_user_id
JOIN season_members osm ON osm.admin_user_id=g.owner_user_id AND osm.season_id=g.season_id
JOIN location_members olm ON olm.admin_user_id=g.owner_user_id AND olm.location_id=g.location_id AND olm.season_id=g.season_id
WHERE g.revoked_at IS NULL AND d.disabled_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM offline_final_price_invalidations invalid WHERE invalid.grant_id=g.id)
  AND g.issued_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now') AND g.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND b.status='active' AND l.status='active' AND s.status='active' AND ls.status='active'
  AND (target.disabled_at IS NULL OR target.disabled_at='') AND (tsm.disabled_at IS NULL OR tsm.disabled_at='') AND (tlm.disabled_at IS NULL OR tlm.disabled_at='')
  AND tsm.role IN ('admin','super_admin','owner') AND tlm.role IN ('admin','super_admin','owner') AND (tsm.role='admin' OR tlm.role='admin')
  AND (issuer.disabled_at IS NULL OR issuer.disabled_at='') AND (osm.disabled_at IS NULL OR osm.disabled_at='') AND (olm.disabled_at IS NULL OR olm.disabled_at='')
  AND osm.role='owner' AND olm.role='owner';

CREATE TRIGGER final_price_grant_issue AFTER INSERT ON offline_final_price_grants
WHEN NOT EXISTS (SELECT 1 FROM live_offline_final_price_grants WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'offline_grant_authority_changed'); END;
CREATE TRIGGER final_price_grant_update BEFORE UPDATE ON offline_final_price_grants
WHEN NEW.id IS NOT OLD.id OR NEW.business_id IS NOT OLD.business_id OR NEW.location_id IS NOT OLD.location_id
  OR NEW.season_id IS NOT OLD.season_id OR NEW.user_id IS NOT OLD.user_id OR NEW.device_id IS NOT OLD.device_id
  OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.can_finalize IS NOT OLD.can_finalize
  OR NEW.issued_at IS NOT OLD.issued_at OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.certificate_json IS NOT OLD.certificate_json OR NEW.final_prices_json IS NOT OLD.final_prices_json
  OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.revoked_by IS NULL
  OR NOT EXISTS (SELECT 1 FROM admin_users u JOIN season_members sm ON sm.admin_user_id=u.id
    JOIN location_members lm ON lm.admin_user_id=u.id AND lm.season_id=sm.season_id
    WHERE u.id=NEW.revoked_by AND sm.season_id=OLD.season_id AND lm.location_id=OLD.location_id
      AND sm.role='owner' AND lm.role='owner' AND (u.disabled_at IS NULL OR u.disabled_at='')
      AND (sm.disabled_at IS NULL OR sm.disabled_at='') AND (lm.disabled_at IS NULL OR lm.disabled_at=''))
BEGIN SELECT RAISE(ABORT,'offline_grant_immutable_or_revoke_denied'); END;
CREATE TRIGGER final_price_grant_no_delete BEFORE DELETE ON offline_final_price_grants
BEGIN SELECT RAISE(ABORT,'offline_grants_retained'); END;

CREATE TABLE offline_final_price_uses (
  operation_id TEXT PRIMARY KEY NOT NULL, grant_id TEXT NOT NULL REFERENCES offline_final_price_grants(id),
  request_id TEXT NOT NULL REFERENCES customer_requests(id), kind TEXT NOT NULL CHECK(kind IN ('AGREEMENT','CLOSE')),
  occurred_at TEXT NOT NULL, proof_json TEXT NOT NULL CHECK(json_valid(proof_json)),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER final_price_use_authority BEFORE INSERT ON offline_final_price_uses
WHEN NOT EXISTS (SELECT 1 FROM live_offline_final_price_grants g JOIN customer_requests r
  ON r.id=NEW.request_id AND r.location_id=g.location_id AND r.season_id=g.season_id
  WHERE g.id=NEW.grant_id AND g.can_finalize=1 AND NEW.occurred_at >= g.issued_at AND NEW.occurred_at < g.expires_at)
BEGIN SELECT RAISE(ABORT,'offline_grant_authority_changed'); END;
CREATE TRIGGER final_price_use_no_update BEFORE UPDATE ON offline_final_price_uses
BEGIN SELECT RAISE(ABORT,'offline_grant_uses_append_only'); END;
CREATE TRIGGER final_price_use_no_delete BEFORE DELETE ON offline_final_price_uses
BEGIN SELECT RAISE(ABORT,'offline_grant_uses_append_only'); END;

-- Retain the existing scope/role checks; add only audited grant uses.
DROP TRIGGER offline_receipt_authority;
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
    AND (NEW.operation_type IN ('CREATE','EDIT') OR NEW.actor_role IN ('owner','super_admin') OR (NEW.actor_role='admin' AND NEW.operation_type IN ('AGREEMENT','CLOSE') AND EXISTS (SELECT 1 FROM offline_final_price_uses used JOIN live_offline_final_price_grants granted ON granted.id=used.grant_id WHERE used.operation_id=NEW.operation_id AND used.request_id=NEW.request_id AND used.kind=NEW.operation_type AND granted.business_id=NEW.business_id AND granted.location_id=NEW.location_id AND granted.season_id=NEW.season_id AND granted.user_id=NEW.user_id AND granted.device_id=NEW.device_id AND granted.can_finalize=1)))
    AND r.revision = NEW.revision
)
BEGIN SELECT RAISE(ABORT,'offline_authority_changed'); END;

DROP TRIGGER bill_purchase_cost_authority;
CREATE TRIGGER bill_purchase_cost_authority BEFORE INSERT ON request_payment_accounts
WHEN (SELECT audit_actor_user_id FROM customer_requests WHERE id = NEW.request_id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM customer_requests r
    JOIN admin_users u ON u.id = r.audit_actor_user_id
    JOIN season_members sm ON sm.admin_user_id = u.id AND sm.season_id = NEW.season_id
    JOIN location_members lm ON lm.admin_user_id = u.id AND lm.location_id = NEW.location_id AND lm.season_id = NEW.season_id
    JOIN business_locations l ON l.id = NEW.location_id AND l.business_id = NEW.business_id
    JOIN businesses b ON b.id = l.business_id
    JOIN business_seasons s ON s.id = NEW.season_id
    JOIN location_seasons ls ON ls.location_id = l.id AND ls.season_id = s.id
    WHERE r.id = NEW.request_id AND r.location_id = l.id AND r.season_id = s.id
      AND (r.audit_actor_role IN ('owner','super_admin') OR (r.audit_actor_role='admin' AND EXISTS (SELECT 1 FROM offline_final_price_uses used JOIN live_offline_final_price_grants granted ON granted.id=used.grant_id WHERE used.request_id=r.id AND used.kind='CLOSE' AND granted.user_id=r.audit_actor_user_id AND granted.device_id=r.audit_device_id AND granted.business_id=NEW.business_id AND granted.location_id=NEW.location_id AND granted.season_id=NEW.season_id AND granted.can_finalize=1)))
      AND sm.role IN ('admin','owner','super_admin') AND lm.role IN ('admin','owner','super_admin') AND r.audit_actor_role = CASE WHEN sm.role='admin' OR lm.role='admin' THEN 'admin' WHEN sm.role='super_admin' OR lm.role='super_admin' THEN 'super_admin' ELSE 'owner' END
      AND (u.disabled_at IS NULL OR u.disabled_at = '') AND (sm.disabled_at IS NULL OR sm.disabled_at = '')
      AND (lm.disabled_at IS NULL OR lm.disabled_at = '')
      AND b.status = 'active' AND l.status = 'active' AND s.status = 'active' AND ls.status = 'active'
  )
BEGIN SELECT RAISE(ABORT,'bill_purchase_cost_authority_changed'); END;

-- Closed bill handoff requires the actual original CLOSE receipt (v3 only).
DROP TRIGGER handover_claim_authority;
CREATE TRIGGER handover_claim_authority BEFORE INSERT ON request_handover_claims
WHEN NOT EXISTS (
  SELECT 1 FROM customer_requests r
  JOIN business_locations l ON l.id = r.location_id AND l.business_id = NEW.business_id AND l.status = 'active'
  JOIN businesses b ON b.id = l.business_id AND b.status = 'active'
  JOIN business_seasons season ON season.id = r.season_id AND season.status = 'active'
  JOIN location_seasons ls ON ls.location_id = r.location_id AND ls.season_id = r.season_id AND ls.status = 'active'
  WHERE r.id = NEW.request_id AND r.location_id = NEW.location_id AND r.season_id = NEW.season_id
    AND r.creator_user_id = NEW.initiator_user_id AND ((r.status NOT IN ('closed','void') AND r.finalization_status IS NOT 'finalized') OR (r.status='closed' AND r.finalization_status='finalized' AND json_extract(NEW.signed_transfer_json,'$.payload.v')=3 AND r.revision=NEW.source_revision AND EXISTS (SELECT 1 FROM offline_sync_receipts closed WHERE closed.operation_id=json_extract(NEW.signed_transfer_json,'$.payload.bill.operations[#-1].operationId') AND closed.operation_type='CLOSE' AND closed.request_id=r.id AND closed.user_id=NEW.initiator_user_id AND closed.device_id=NEW.initiator_device_id AND closed.business_id=NEW.business_id AND closed.location_id=NEW.location_id AND closed.season_id=NEW.season_id AND closed.revision=r.revision)))
    AND NOT EXISTS (
      SELECT 1 FROM (SELECT NEW.initiator_user_id uid,NEW.initiator_device_id did,NEW.initiator_role role
        UNION ALL SELECT NEW.recipient_user_id,NEW.recipient_device_id,NEW.recipient_role) actor
      WHERE NOT EXISTS (
        SELECT 1 FROM offline_sync_devices d
        JOIN admin_users u ON u.id = d.user_id AND (u.disabled_at IS NULL OR u.disabled_at = '')
        JOIN season_members sm ON sm.admin_user_id = u.id AND sm.season_id = d.season_id AND (sm.disabled_at IS NULL OR sm.disabled_at = '')
        JOIN location_members lm ON lm.admin_user_id = u.id AND lm.location_id = d.location_id AND lm.season_id = d.season_id AND (lm.disabled_at IS NULL OR lm.disabled_at = '')
        WHERE d.business_id = NEW.business_id AND d.location_id = NEW.location_id AND d.season_id = NEW.season_id
          AND d.user_id = actor.uid AND d.device_id = actor.did AND d.disabled_at IS NULL
          AND sm.role IN ('admin','super_admin','owner') AND lm.role IN ('admin','super_admin','owner')
          AND actor.role = CASE WHEN sm.role = 'admin' OR lm.role = 'admin' THEN 'admin'
            WHEN sm.role = 'super_admin' OR lm.role = 'super_admin' THEN 'super_admin' ELSE 'owner' END
      )
    )
)
BEGIN SELECT RAISE(ABORT,'handover_authority_changed'); END;
