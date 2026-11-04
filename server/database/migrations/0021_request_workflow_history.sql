-- Request workflow history. Apply through the normal migration runner only.
-- Historical actors/devices/units stay NULL; revision 0 means history predates this migration.
ALTER TABLE customer_requests ADD COLUMN creator_user_id TEXT;
ALTER TABLE customer_requests ADD COLUMN creator_name TEXT;
ALTER TABLE customer_requests ADD COLUMN creator_role TEXT CHECK (creator_role IS NULL OR creator_role IN ('admin','owner','super_admin'));
ALTER TABLE customer_requests ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);
ALTER TABLE customer_requests ADD COLUMN assigned_to_user_id TEXT;
ALTER TABLE customer_requests ADD COLUMN assigned_to_name TEXT;
ALTER TABLE customer_requests ADD COLUMN assigned_to_role TEXT;
ALTER TABLE customer_requests ADD COLUMN assigned_by_user_id TEXT;
ALTER TABLE customer_requests ADD COLUMN assigned_by_name TEXT;
ALTER TABLE customer_requests ADD COLUMN assigned_by_role TEXT;
ALTER TABLE customer_requests ADD COLUMN audit_actor_user_id TEXT;
ALTER TABLE customer_requests ADD COLUMN audit_actor_name TEXT;
ALTER TABLE customer_requests ADD COLUMN audit_actor_role TEXT;
ALTER TABLE customer_requests ADD COLUMN audit_device_id TEXT;
ALTER TABLE customer_requests ADD COLUMN audit_occurred_at TEXT;

ALTER TABLE customer_request_items ADD COLUMN line_id TEXT;
ALTER TABLE customer_request_items ADD COLUMN unit_type TEXT CHECK (unit_type IS NULL OR unit_type IN ('box','piece'));
ALTER TABLE customer_request_items ADD COLUMN pack_snapshot TEXT CHECK (pack_snapshot IS NULL OR json_valid(pack_snapshot));
ALTER TABLE customer_request_items ADD COLUMN product_details_json TEXT CHECK (product_details_json IS NULL OR json_valid(product_details_json));
UPDATE customer_request_items SET line_id = 'historical-line-' || id;
CREATE UNIQUE INDEX idx_request_item_stable_line ON customer_request_items(request_id, line_id);

ALTER TABLE quotation_items ADD COLUMN request_line_id TEXT;
ALTER TABLE quotation_items ADD COLUMN unit_type TEXT;
ALTER TABLE quotation_items ADD COLUMN pack_snapshot TEXT;
ALTER TABLE quotation_items ADD COLUMN product_details_json TEXT;
UPDATE quotation_items SET request_line_id = (
  SELECT i.line_id FROM customer_request_items i JOIN quotations q ON q.customer_request_id = i.request_id
  WHERE q.id = quotation_items.quotation_id AND i.line_number = quotation_items.line_number
    AND i.product_id IS quotation_items.product_id AND i.product_name = quotation_items.product_name
    AND i.quantity = quotation_items.quantity
);

CREATE TABLE request_workflow_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES customer_requests(id) ON DELETE RESTRICT,
  business_id TEXT,
  location_id TEXT,
  season_id TEXT,
  actor_user_id TEXT,
  actor_name TEXT,
  actor_role TEXT,
  device_id TEXT,
  event_type TEXT NOT NULL,
  occurred_at TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  UNIQUE(request_id, revision)
);
CREATE INDEX idx_request_workflow_scope ON request_workflow_events(location_id, season_id, request_id, revision);

CREATE TRIGGER request_workflow_scope_guard BEFORE INSERT ON request_workflow_events
WHEN NOT EXISTS (SELECT 1 FROM customer_requests r WHERE r.id = NEW.request_id
  AND r.location_id IS NEW.location_id AND r.season_id IS NEW.season_id AND r.revision = NEW.revision
  AND NEW.business_id IS (SELECT business_id FROM business_locations WHERE id = r.location_id))
BEGIN SELECT RAISE(ABORT, 'workflow_event_scope_mismatch'); END;

CREATE TRIGGER request_workflow_no_update BEFORE UPDATE ON request_workflow_events
BEGIN SELECT RAISE(ABORT, 'workflow_events_append_only'); END;
CREATE TRIGGER request_workflow_no_delete BEFORE DELETE ON request_workflow_events
BEGIN SELECT RAISE(ABORT, 'workflow_events_append_only'); END;
CREATE TRIGGER request_creator_immutable BEFORE UPDATE OF creator_user_id, creator_name, creator_role, created_at ON customer_requests
WHEN NEW.creator_user_id IS NOT OLD.creator_user_id OR NEW.creator_name IS NOT OLD.creator_name
  OR NEW.creator_role IS NOT OLD.creator_role OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'request_creator_immutable'); END;
CREATE TRIGGER request_revision_monotonic BEFORE UPDATE OF revision ON customer_requests
WHEN NEW.revision != OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'request_revision_must_advance'); END;
CREATE TRIGGER request_line_id_immutable BEFORE UPDATE OF line_id ON customer_request_items
WHEN OLD.line_id IS NOT NULL AND NEW.line_id IS NOT OLD.line_id
BEGIN SELECT RAISE(ABORT, 'request_line_id_immutable'); END;

CREATE TRIGGER quotation_line_snapshot AFTER INSERT ON quotation_items
BEGIN
  UPDATE quotation_items SET
    request_line_id = (SELECT i.line_id FROM customer_request_items i JOIN quotations q ON q.customer_request_id = i.request_id WHERE q.id = NEW.quotation_id AND i.line_number = NEW.line_number),
    unit_type = (SELECT i.unit_type FROM customer_request_items i JOIN quotations q ON q.customer_request_id = i.request_id WHERE q.id = NEW.quotation_id AND i.line_number = NEW.line_number),
    pack_snapshot = (SELECT i.pack_snapshot FROM customer_request_items i JOIN quotations q ON q.customer_request_id = i.request_id WHERE q.id = NEW.quotation_id AND i.line_number = NEW.line_number),
    product_details_json = (SELECT i.product_details_json FROM customer_request_items i JOIN quotations q ON q.customer_request_id = i.request_id WHERE q.id = NEW.quotation_id AND i.line_number = NEW.line_number)
  WHERE id = NEW.id;
END;

CREATE TRIGGER request_created_history AFTER INSERT ON customer_requests BEGIN

  UPDATE customer_requests SET revision = revision + 1 WHERE id = NEW.id;
  INSERT INTO request_workflow_events(event_id,request_id,business_id,location_id,season_id,
    actor_user_id,actor_name,actor_role,device_id,event_type,occurred_at,revision,metadata_json)
  SELECT 'event-' || lower(hex(randomblob(16))), r.id,
    (SELECT business_id FROM business_locations WHERE id = r.location_id), r.location_id, r.season_id,
    r.audit_actor_user_id,r.audit_actor_name,r.audit_actor_role,r.audit_device_id,'request_created',r.audit_occurred_at,r.revision,json_object('after', json_object('status', NEW.status, 'finalizationStatus', NEW.finalization_status,
  'assignedToUserId', NEW.assigned_to_user_id, 'assignedToName', NEW.assigned_to_name, 'assignedToRole', NEW.assigned_to_role,
  'assignedToEmail', NEW.assigned_to_email, 'assignedByUserId', NEW.assigned_by_user_id, 'assignedByName', NEW.assigned_by_name, 'assignedByRole', NEW.assigned_by_role, 'assignedAt', NEW.assigned_at,
  'closedByEmail', NEW.closed_by_email, 'closedAt', NEW.closed_at,
  'creatorUserId', NEW.creator_user_id, 'creatorName', NEW.creator_name, 'creatorRole', NEW.creator_role, 'createdAt', NEW.created_at))
  FROM customer_requests r WHERE r.id = NEW.id;
END;
CREATE TRIGGER request_changed_history AFTER UPDATE OF status, finalization_status,
 assigned_to_user_id, assigned_to_name, assigned_to_role, assigned_to_email,
 assigned_by_user_id, assigned_by_name, assigned_by_role, assigned_at ON customer_requests
WHEN NEW.status IS NOT OLD.status OR NEW.finalization_status IS NOT OLD.finalization_status
 OR NEW.assigned_to_user_id IS NOT OLD.assigned_to_user_id OR NEW.assigned_to_name IS NOT OLD.assigned_to_name
 OR NEW.assigned_to_role IS NOT OLD.assigned_to_role OR NEW.assigned_to_email IS NOT OLD.assigned_to_email
 OR NEW.assigned_by_user_id IS NOT OLD.assigned_by_user_id OR NEW.assigned_by_name IS NOT OLD.assigned_by_name
 OR NEW.assigned_by_role IS NOT OLD.assigned_by_role OR NEW.assigned_at IS NOT OLD.assigned_at
BEGIN

  UPDATE customer_requests SET revision = revision + 1 WHERE id = NEW.id;
  INSERT INTO request_workflow_events(event_id,request_id,business_id,location_id,season_id,
    actor_user_id,actor_name,actor_role,device_id,event_type,occurred_at,revision,metadata_json)
  SELECT 'event-' || lower(hex(randomblob(16))), r.id,
    (SELECT business_id FROM business_locations WHERE id = r.location_id), r.location_id, r.season_id,
    r.audit_actor_user_id,r.audit_actor_name,r.audit_actor_role,r.audit_device_id,CASE WHEN NEW.status = 'closed' THEN 'request_closed'
 WHEN NEW.assigned_to_user_id IS NOT OLD.assigned_to_user_id OR NEW.assigned_to_name IS NOT OLD.assigned_to_name
   OR NEW.assigned_to_role IS NOT OLD.assigned_to_role OR NEW.assigned_to_email IS NOT OLD.assigned_to_email
   OR NEW.assigned_by_user_id IS NOT OLD.assigned_by_user_id OR NEW.assigned_by_name IS NOT OLD.assigned_by_name
   OR NEW.assigned_by_role IS NOT OLD.assigned_by_role OR NEW.assigned_at IS NOT OLD.assigned_at THEN 'request_assigned' ELSE 'request_status_changed' END,r.audit_occurred_at,r.revision,json_object('before', json_object('status', OLD.status, 'finalizationStatus', OLD.finalization_status,
  'assignedToUserId', OLD.assigned_to_user_id, 'assignedToName', OLD.assigned_to_name, 'assignedToRole', OLD.assigned_to_role,
  'assignedToEmail', OLD.assigned_to_email, 'assignedByUserId', OLD.assigned_by_user_id, 'assignedByName', OLD.assigned_by_name, 'assignedByRole', OLD.assigned_by_role, 'assignedAt', OLD.assigned_at,
  'closedByEmail', OLD.closed_by_email, 'closedAt', OLD.closed_at,
  'creatorUserId', OLD.creator_user_id, 'creatorName', OLD.creator_name, 'creatorRole', OLD.creator_role, 'createdAt', OLD.created_at), 'after', json_object('status', NEW.status, 'finalizationStatus', NEW.finalization_status,
  'assignedToUserId', NEW.assigned_to_user_id, 'assignedToName', NEW.assigned_to_name, 'assignedToRole', NEW.assigned_to_role,
  'assignedToEmail', NEW.assigned_to_email, 'assignedByUserId', NEW.assigned_by_user_id, 'assignedByName', NEW.assigned_by_name, 'assignedByRole', NEW.assigned_by_role, 'assignedAt', NEW.assigned_at,
  'closedByEmail', NEW.closed_by_email, 'closedAt', NEW.closed_at,
  'creatorUserId', NEW.creator_user_id, 'creatorName', NEW.creator_name, 'creatorRole', NEW.creator_role, 'createdAt', NEW.created_at))
  FROM customer_requests r WHERE r.id = NEW.id;
END;
CREATE TRIGGER request_item_added_history AFTER INSERT ON customer_request_items BEGIN
  UPDATE customer_request_items SET
    line_id = COALESCE(NEW.line_id, 'line-' || lower(hex(randomblob(16)))),
    unit_type = COALESCE(NEW.unit_type, CASE WHEN NEW.product_name LIKE '% (loose pc)' THEN 'piece' ELSE 'box' END),
    pack_snapshot = COALESCE(NEW.pack_snapshot, json_object(
      'label', COALESCE((SELECT pack FROM products WHERE id = NEW.product_id), (SELECT pack_label FROM family_packs WHERE id = NEW.family_pack_id)),
      'piecesPerPack', (SELECT pieces_per_pack FROM products WHERE id = NEW.product_id))),
    product_details_json = COALESCE(NEW.product_details_json, json_object(
      'productId', NEW.product_id, 'familyPackId', NEW.family_pack_id, 'name', NEW.product_name,
      'company', (SELECT company FROM products WHERE id = NEW.product_id)))
  WHERE id = NEW.id;

  UPDATE customer_requests SET revision = revision + 1 WHERE id = NEW.request_id;
  INSERT INTO request_workflow_events(event_id,request_id,business_id,location_id,season_id,
    actor_user_id,actor_name,actor_role,device_id,event_type,occurred_at,revision,metadata_json)
  SELECT 'event-' || lower(hex(randomblob(16))), r.id,
    (SELECT business_id FROM business_locations WHERE id = r.location_id), r.location_id, r.season_id,
    r.audit_actor_user_id,r.audit_actor_name,r.audit_actor_role,r.audit_device_id,'item_added',r.audit_occurred_at,r.revision,json_object('after', json((SELECT json_object('lineId', i.line_id, 'lineNumber', i.line_number, 'productId', i.product_id,
 'familyPackId', i.family_pack_id, 'productName', i.product_name, 'quantity', i.quantity,
 'unitPricePaise', i.unit_price_paise, 'unitType', i.unit_type,
 'packSnapshot', json(i.pack_snapshot), 'productDetails', json(i.product_details_json)) FROM customer_request_items i WHERE i.id = NEW.id)))
  FROM customer_requests r WHERE r.id = NEW.request_id;
END;
CREATE TRIGGER request_item_removed_history BEFORE DELETE ON customer_request_items BEGIN

  UPDATE customer_requests SET revision = revision + 1 WHERE id = OLD.request_id;
  INSERT INTO request_workflow_events(event_id,request_id,business_id,location_id,season_id,
    actor_user_id,actor_name,actor_role,device_id,event_type,occurred_at,revision,metadata_json)
  SELECT 'event-' || lower(hex(randomblob(16))), r.id,
    (SELECT business_id FROM business_locations WHERE id = r.location_id), r.location_id, r.season_id,
    r.audit_actor_user_id,r.audit_actor_name,r.audit_actor_role,r.audit_device_id,'item_removed',r.audit_occurred_at,r.revision,json_object('before', json_object('lineId', OLD.line_id, 'lineNumber', OLD.line_number, 'productId', OLD.product_id,
 'familyPackId', OLD.family_pack_id, 'productName', OLD.product_name, 'quantity', OLD.quantity,
 'unitPricePaise', OLD.unit_price_paise, 'unitType', OLD.unit_type,
 'packSnapshot', json(OLD.pack_snapshot), 'productDetails', json(OLD.product_details_json)))
  FROM customer_requests r WHERE r.id = OLD.request_id;
END;
CREATE TRIGGER request_item_changed_history AFTER UPDATE OF line_number, product_id, family_pack_id, product_name, quantity, unit_price_paise, unit_type, pack_snapshot, product_details_json ON customer_request_items
WHEN OLD.line_id IS NOT NULL AND (NEW.line_number IS NOT OLD.line_number OR NEW.product_id IS NOT OLD.product_id OR NEW.family_pack_id IS NOT OLD.family_pack_id
 OR NEW.product_name IS NOT OLD.product_name OR NEW.quantity IS NOT OLD.quantity
 OR NEW.unit_price_paise IS NOT OLD.unit_price_paise OR NEW.unit_type IS NOT OLD.unit_type
 OR NEW.pack_snapshot IS NOT OLD.pack_snapshot OR NEW.product_details_json IS NOT OLD.product_details_json)
BEGIN

  UPDATE customer_requests SET revision = revision + 1 WHERE id = NEW.request_id;
  INSERT INTO request_workflow_events(event_id,request_id,business_id,location_id,season_id,
    actor_user_id,actor_name,actor_role,device_id,event_type,occurred_at,revision,metadata_json)
  SELECT 'event-' || lower(hex(randomblob(16))), r.id,
    (SELECT business_id FROM business_locations WHERE id = r.location_id), r.location_id, r.season_id,
    r.audit_actor_user_id,r.audit_actor_name,r.audit_actor_role,r.audit_device_id,'item_changed',r.audit_occurred_at,r.revision,json_object('before', json_object('lineId', OLD.line_id, 'lineNumber', OLD.line_number, 'productId', OLD.product_id,
 'familyPackId', OLD.family_pack_id, 'productName', OLD.product_name, 'quantity', OLD.quantity,
 'unitPricePaise', OLD.unit_price_paise, 'unitType', OLD.unit_type,
 'packSnapshot', json(OLD.pack_snapshot), 'productDetails', json(OLD.product_details_json)), 'after', json_object('lineId', NEW.line_id, 'lineNumber', NEW.line_number, 'productId', NEW.product_id,
 'familyPackId', NEW.family_pack_id, 'productName', NEW.product_name, 'quantity', NEW.quantity,
 'unitPricePaise', NEW.unit_price_paise, 'unitType', NEW.unit_type,
 'packSnapshot', json(NEW.pack_snapshot), 'productDetails', json(NEW.product_details_json)))
  FROM customer_requests r WHERE r.id = NEW.request_id;
END;
CREATE TRIGGER quotation_created_history AFTER INSERT ON quotations WHEN NEW.customer_request_id IS NOT NULL BEGIN

  UPDATE customer_requests SET revision = revision + 1 WHERE id = NEW.customer_request_id;
  INSERT INTO request_workflow_events(event_id,request_id,business_id,location_id,season_id,
    actor_user_id,actor_name,actor_role,device_id,event_type,occurred_at,revision,metadata_json)
  SELECT 'event-' || lower(hex(randomblob(16))), r.id,
    (SELECT business_id FROM business_locations WHERE id = r.location_id), r.location_id, r.season_id,
    r.audit_actor_user_id,r.audit_actor_name,r.audit_actor_role,r.audit_device_id,'quotation_created',r.audit_occurred_at,r.revision,json_object('after', json_object('quotationId', NEW.id, 'status', NEW.status, 'totalPaise', NEW.total_paise,
 'acceptedAmountPaise', NEW.accepted_amount_paise))
  FROM customer_requests r WHERE r.id = NEW.customer_request_id;
END;
CREATE TRIGGER quotation_adjusted_history AFTER UPDATE OF status, total_paise, accepted_amount_paise ON quotations
WHEN NEW.customer_request_id IS NOT NULL AND (NEW.status IS NOT OLD.status OR NEW.total_paise IS NOT OLD.total_paise OR NEW.accepted_amount_paise IS NOT OLD.accepted_amount_paise)
BEGIN

  UPDATE customer_requests SET revision = revision + 1 WHERE id = NEW.customer_request_id;
  INSERT INTO request_workflow_events(event_id,request_id,business_id,location_id,season_id,
    actor_user_id,actor_name,actor_role,device_id,event_type,occurred_at,revision,metadata_json)
  SELECT 'event-' || lower(hex(randomblob(16))), r.id,
    (SELECT business_id FROM business_locations WHERE id = r.location_id), r.location_id, r.season_id,
    r.audit_actor_user_id,r.audit_actor_name,r.audit_actor_role,r.audit_device_id,'quotation_adjusted',r.audit_occurred_at,r.revision,json_object('before', json_object('quotationId', OLD.id, 'status', OLD.status, 'totalPaise', OLD.total_paise,
 'acceptedAmountPaise', OLD.accepted_amount_paise), 'after', json_object('quotationId', NEW.id, 'status', NEW.status, 'totalPaise', NEW.total_paise,
 'acceptedAmountPaise', NEW.accepted_amount_paise))
  FROM customer_requests r WHERE r.id = NEW.customer_request_id;
END;
