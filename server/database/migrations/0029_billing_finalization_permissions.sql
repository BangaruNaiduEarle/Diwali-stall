-- Additive Billing Finalization delegation. Existing Phase 2 grants remain valid.
CREATE TABLE billing_finalization_permissions (
 id TEXT PRIMARY KEY NOT NULL, business_id TEXT NOT NULL, location_id TEXT NOT NULL,
 season_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES admin_users(id),
 grantor_user_id TEXT NOT NULL REFERENCES admin_users(id),
 granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 revoked_at TEXT, revoked_by TEXT REFERENCES admin_users(id), revoke_operation_id TEXT UNIQUE
);
CREATE UNIQUE INDEX billing_permission_active ON billing_finalization_permissions(business_id,location_id,season_id,user_id) WHERE revoked_at IS NULL;
CREATE VIEW live_billing_finalization_permissions AS
 SELECT p.* FROM billing_finalization_permissions p
 JOIN business_locations l ON l.id=p.location_id AND l.business_id=p.business_id
 JOIN businesses b ON b.id=p.business_id JOIN business_seasons s ON s.id=p.season_id
 JOIN location_seasons ls ON ls.location_id=p.location_id AND ls.season_id=p.season_id
 JOIN admin_users target ON target.id=p.user_id JOIN admin_users issuer ON issuer.id=p.grantor_user_id
 JOIN season_members tsm ON tsm.admin_user_id=p.user_id AND tsm.season_id=p.season_id
 JOIN location_members tlm ON tlm.admin_user_id=p.user_id AND tlm.season_id=p.season_id AND tlm.location_id=p.location_id
 JOIN season_members ism ON ism.admin_user_id=p.grantor_user_id AND ism.season_id=p.season_id
 JOIN location_members ilm ON ilm.admin_user_id=p.grantor_user_id AND ilm.season_id=p.season_id AND ilm.location_id=p.location_id
 WHERE p.revoked_at IS NULL AND b.status='active' AND l.status='active' AND s.status='active' AND ls.status='active'
 AND COALESCE(target.disabled_at,'')='' AND COALESCE(issuer.disabled_at,'')=''
 AND COALESCE(tsm.disabled_at,'')='' AND COALESCE(tlm.disabled_at,'')='' AND COALESCE(ism.disabled_at,'')='' AND COALESCE(ilm.disabled_at,'')=''
 AND tsm.role IN ('admin','super_admin','owner') AND tlm.role IN ('admin','super_admin','owner') AND (tsm.role='admin' OR tlm.role='admin')
 AND ism.role IN ('owner','super_admin') AND ilm.role IN ('owner','super_admin');
CREATE TRIGGER billing_permission_issue AFTER INSERT ON billing_finalization_permissions
 WHEN NEW.revoked_at IS NOT NULL OR NEW.revoked_by IS NOT NULL OR NEW.revoke_operation_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM live_billing_finalization_permissions WHERE id=NEW.id)
 BEGIN SELECT RAISE(ABORT,'billing_permission_authority_changed'); END;
CREATE TRIGGER billing_permission_update BEFORE UPDATE ON billing_finalization_permissions
 WHEN NEW.id IS NOT OLD.id OR NEW.business_id IS NOT OLD.business_id OR NEW.location_id IS NOT OLD.location_id
 OR NEW.season_id IS NOT OLD.season_id OR NEW.user_id IS NOT OLD.user_id OR NEW.grantor_user_id IS NOT OLD.grantor_user_id OR NEW.granted_at IS NOT OLD.granted_at
 OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
 OR (NEW.revoked_by IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM admin_users u JOIN season_members sm ON sm.admin_user_id=u.id AND sm.season_id=OLD.season_id
 JOIN location_members lm ON lm.admin_user_id=u.id AND lm.season_id=sm.season_id AND lm.location_id=OLD.location_id
 JOIN business_locations l ON l.id=lm.location_id AND l.business_id=OLD.business_id
 JOIN businesses b ON b.id=l.business_id JOIN business_seasons s ON s.id=sm.season_id
 JOIN location_seasons ls ON ls.location_id=l.id AND ls.season_id=s.id
 WHERE u.id=NEW.revoked_by AND sm.role IN ('owner','super_admin') AND lm.role IN ('owner','super_admin')
 AND COALESCE(u.disabled_at,'')='' AND COALESCE(sm.disabled_at,'')='' AND COALESCE(lm.disabled_at,'')=''
 AND b.status='active' AND l.status='active' AND s.status='active' AND ls.status='active'))
 BEGIN SELECT RAISE(ABORT,'billing_permission_immutable_or_revoke_denied'); END;
CREATE TRIGGER billing_permission_no_delete BEFORE DELETE ON billing_finalization_permissions
 BEGIN SELECT RAISE(ABORT,'billing_permission_history_retained'); END;
ALTER TABLE offline_final_price_grants ADD COLUMN billing_permission_id TEXT REFERENCES billing_finalization_permissions(id);
DROP VIEW live_offline_final_price_grants;
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
WHERE (g.revoked_at IS NULL AND d.disabled_at IS NULL)
 AND (NOT EXISTS (SELECT 1 FROM offline_final_price_invalidations invalid WHERE invalid.grant_id=g.id))
 AND (g.issued_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now') AND g.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 AND (b.status='active' AND l.status='active' AND s.status='active' AND ls.status='active')
 AND ((target.disabled_at IS NULL OR target.disabled_at='') AND (tsm.disabled_at IS NULL OR tsm.disabled_at='') AND (tlm.disabled_at IS NULL OR tlm.disabled_at=''))
 AND (tsm.role IN ('admin','super_admin','owner') AND tlm.role IN ('admin','super_admin','owner') AND (tsm.role='admin' OR tlm.role='admin'))
 AND ((issuer.disabled_at IS NULL OR issuer.disabled_at='') AND (osm.disabled_at IS NULL OR osm.disabled_at='') AND (olm.disabled_at IS NULL OR olm.disabled_at=''))
 AND (((g.billing_permission_id IS NULL AND osm.role='owner' AND olm.role='owner') OR
 (g.billing_permission_id IS NOT NULL AND osm.role IN ('owner','super_admin') AND olm.role IN ('owner','super_admin')
 AND EXISTS (SELECT 1 FROM billing_finalization_permissions p WHERE p.revoked_at IS NULL AND p.id=g.billing_permission_id
 AND p.business_id=g.business_id AND p.location_id=g.location_id AND p.season_id=g.season_id
 AND p.user_id=g.user_id AND p.grantor_user_id=g.owner_user_id AND g.can_finalize=1))));

DROP TRIGGER final_price_grant_update;
CREATE TRIGGER final_price_grant_update BEFORE UPDATE ON offline_final_price_grants
WHEN NEW.billing_permission_id IS NOT OLD.billing_permission_id OR NEW.id IS NOT OLD.id OR NEW.business_id IS NOT OLD.business_id OR NEW.location_id IS NOT OLD.location_id
  OR NEW.season_id IS NOT OLD.season_id OR NEW.user_id IS NOT OLD.user_id OR NEW.device_id IS NOT OLD.device_id
  OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.can_finalize IS NOT OLD.can_finalize
  OR NEW.issued_at IS NOT OLD.issued_at OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.certificate_json IS NOT OLD.certificate_json OR NEW.final_prices_json IS NOT OLD.final_prices_json
  OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.revoked_by IS NULL
  OR NOT EXISTS (SELECT 1 FROM admin_users u JOIN season_members sm ON sm.admin_user_id=u.id
    JOIN location_members lm ON lm.admin_user_id=u.id AND lm.season_id=sm.season_id
    WHERE u.id=NEW.revoked_by AND sm.season_id=OLD.season_id AND lm.location_id=OLD.location_id
      AND ((sm.role='owner' AND lm.role='owner') OR (OLD.billing_permission_id IS NOT NULL AND sm.role IN ('owner','super_admin') AND lm.role IN ('owner','super_admin'))) AND (u.disabled_at IS NULL OR u.disabled_at='')
      AND (sm.disabled_at IS NULL OR sm.disabled_at='') AND (lm.disabled_at IS NULL OR lm.disabled_at=''))
BEGIN SELECT RAISE(ABORT,'offline_grant_immutable_or_revoke_denied'); END;
CREATE TRIGGER billing_permission_location_members_changed AFTER UPDATE OF role,disabled_at ON location_members WHEN NEW.role IS NOT OLD.role OR NEW.disabled_at IS NOT OLD.disabled_at BEGIN
 UPDATE billing_finalization_permissions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE revoked_at IS NULL AND location_id=OLD.location_id AND season_id=OLD.season_id AND (user_id=OLD.admin_user_id OR grantor_user_id=OLD.admin_user_id); END;
CREATE TRIGGER billing_permission_location_members_removed AFTER DELETE ON location_members BEGIN
 UPDATE billing_finalization_permissions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE revoked_at IS NULL AND location_id=OLD.location_id AND season_id=OLD.season_id AND (user_id=OLD.admin_user_id OR grantor_user_id=OLD.admin_user_id); END;

CREATE TRIGGER billing_permission_season_members_changed AFTER UPDATE OF role,disabled_at ON season_members WHEN NEW.role IS NOT OLD.role OR NEW.disabled_at IS NOT OLD.disabled_at BEGIN
 UPDATE billing_finalization_permissions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE revoked_at IS NULL AND season_id=OLD.season_id AND (user_id=OLD.admin_user_id OR grantor_user_id=OLD.admin_user_id); END;
CREATE TRIGGER billing_permission_season_members_removed AFTER DELETE ON season_members BEGIN
 UPDATE billing_finalization_permissions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE revoked_at IS NULL AND season_id=OLD.season_id AND (user_id=OLD.admin_user_id OR grantor_user_id=OLD.admin_user_id); END;

CREATE TRIGGER billing_permission_admin_users_changed AFTER UPDATE OF disabled_at ON admin_users WHEN NEW.disabled_at IS NOT OLD.disabled_at BEGIN
 UPDATE billing_finalization_permissions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE revoked_at IS NULL AND (user_id=OLD.id OR grantor_user_id=OLD.id); END;
