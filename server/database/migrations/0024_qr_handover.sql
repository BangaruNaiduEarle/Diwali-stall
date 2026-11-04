-- PREPARED ONLY. Requires 0020–0023. Never apply automatically.
CREATE TABLE handover_device_keys (
  business_id TEXT NOT NULL, location_id TEXT NOT NULL, season_id TEXT NOT NULL,
  user_id TEXT NOT NULL, device_id TEXT NOT NULL, public_key_json TEXT NOT NULL CHECK(json_valid(public_key_json)),
  registered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(business_id,location_id,season_id,user_id,device_id),
  FOREIGN KEY(business_id,location_id,season_id,user_id,device_id)
    REFERENCES offline_sync_devices(business_id,location_id,season_id,user_id,device_id)
);
CREATE TRIGGER handover_key_no_update BEFORE UPDATE ON handover_device_keys BEGIN SELECT RAISE(ABORT,'handover_key_immutable'); END;
CREATE TRIGGER handover_key_no_delete BEFORE DELETE ON handover_device_keys BEGIN SELECT RAISE(ABORT,'handover_key_retained'); END;

CREATE TABLE request_handover_claims (
  transfer_id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL UNIQUE REFERENCES customer_requests(id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL UNIQUE,
  business_id TEXT NOT NULL, location_id TEXT NOT NULL, season_id TEXT NOT NULL,
  initiator_user_id TEXT NOT NULL, initiator_role TEXT NOT NULL, initiator_device_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL, recipient_role TEXT NOT NULL CHECK(recipient_role IN ('owner','super_admin')),
  recipient_device_id TEXT NOT NULL, source_revision INTEGER,
  occurred_at TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  signed_transfer_json TEXT NOT NULL CHECK(json_valid(signed_transfer_json)),
  FOREIGN KEY(business_id,location_id,season_id,initiator_user_id,initiator_device_id)
    REFERENCES offline_sync_devices(business_id,location_id,season_id,user_id,device_id),
  FOREIGN KEY(business_id,location_id,season_id,recipient_user_id,recipient_device_id)
    REFERENCES offline_sync_devices(business_id,location_id,season_id,user_id,device_id)
);
CREATE TRIGGER handover_claim_no_update BEFORE UPDATE ON request_handover_claims BEGIN SELECT RAISE(ABORT,'handover_claim_append_only'); END;
CREATE TRIGGER handover_claim_no_delete BEFORE DELETE ON request_handover_claims BEGIN SELECT RAISE(ABORT,'handover_claim_append_only'); END;
CREATE TRIGGER handover_claim_authority BEFORE INSERT ON request_handover_claims
WHEN NOT EXISTS (
  SELECT 1 FROM customer_requests r
  JOIN business_locations l ON l.id = r.location_id AND l.business_id = NEW.business_id AND l.status = 'active'
  JOIN businesses b ON b.id = l.business_id AND b.status = 'active'
  JOIN business_seasons season ON season.id = r.season_id AND season.status = 'active'
  JOIN location_seasons ls ON ls.location_id = r.location_id AND ls.season_id = r.season_id AND ls.status = 'active'
  WHERE r.id = NEW.request_id AND r.location_id = NEW.location_id AND r.season_id = NEW.season_id
    AND r.creator_user_id = NEW.initiator_user_id AND r.status NOT IN ('closed','void') AND r.finalization_status IS NOT 'finalized'
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
CREATE TRIGGER handover_claim_history AFTER INSERT ON request_handover_claims BEGIN
  UPDATE customer_requests SET revision = revision + 1 WHERE id = NEW.request_id;
  INSERT INTO request_workflow_events(event_id,request_id,business_id,location_id,season_id,actor_user_id,actor_name,actor_role,device_id,event_type,occurred_at,revision,metadata_json)
  SELECT 'handover-' || NEW.transfer_id,r.id,NEW.business_id,NEW.location_id,NEW.season_id,
    NEW.recipient_user_id,(SELECT display_name FROM admin_users WHERE id = NEW.recipient_user_id),NEW.recipient_role,
    NEW.recipient_device_id,'handover_accepted',NEW.occurred_at,r.revision,
    json_object('transferId',NEW.transfer_id,'creatorUserId',r.creator_user_id,'initiatorUserId',NEW.initiator_user_id,
      'initiatorRole',NEW.initiator_role,'initiatorDeviceId',NEW.initiator_device_id,'recipientUserId',NEW.recipient_user_id,
      'sourceRevision',NEW.source_revision,'signedOccurredAt',json_extract(NEW.signed_transfer_json,'$.payload.occurredAt'),
      'sourceOccurredAt',json_extract(NEW.signed_transfer_json,'$.payload.sourceOccurredAt'))
  FROM customer_requests r WHERE r.id = NEW.request_id;
  UPDATE customer_requests SET audit_actor_user_id = NEW.recipient_user_id,
    audit_actor_name = (SELECT display_name FROM admin_users WHERE id = NEW.recipient_user_id),
    audit_actor_role = NEW.recipient_role,audit_device_id = NEW.recipient_device_id,audit_occurred_at = NEW.occurred_at
    WHERE id = NEW.request_id;
  UPDATE customer_requests SET assigned_to_email = (SELECT email FROM admin_users WHERE id = NEW.recipient_user_id),
    assigned_to_user_id = NEW.recipient_user_id,assigned_to_name = (SELECT display_name FROM admin_users WHERE id = NEW.recipient_user_id),
    assigned_to_role = NEW.recipient_role,assigned_by_user_id = NEW.initiator_user_id,
    assigned_by_name = (SELECT display_name FROM admin_users WHERE id = NEW.initiator_user_id),assigned_by_role = NEW.initiator_role,
    assigned_by_email = (SELECT email FROM admin_users WHERE id = NEW.initiator_user_id),assigned_at = datetime('now')
    WHERE id = NEW.request_id;
  UPDATE customer_requests SET audit_actor_user_id=NULL,audit_actor_name=NULL,audit_actor_role=NULL,audit_device_id=NULL,audit_occurred_at=NULL
    WHERE id = NEW.request_id;
END;
