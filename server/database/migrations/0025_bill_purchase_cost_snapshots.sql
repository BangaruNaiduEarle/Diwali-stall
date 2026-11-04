-- Additive foundation only. Apply separately to an authorized disposable/target
-- database after 0024; never reconstruct historical costs from current rates.
-- A payment account is created once, inside the existing finalization statement.
CREATE TABLE bill_item_purchase_costs (
  quotation_item_id INTEGER PRIMARY KEY NOT NULL REFERENCES quotation_items(id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL REFERENCES request_payment_accounts(request_id) ON DELETE RESTRICT,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE RESTRICT,
  request_line_id TEXT,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  location_id TEXT NOT NULL REFERENCES business_locations(id),
  season_id TEXT NOT NULL REFERENCES business_seasons(id),
  product_id TEXT,
  quantity INTEGER NOT NULL CHECK(typeof(quantity) = 'integer' AND quantity BETWEEN 1 AND 99),
  unit_type TEXT,
  bill_line_count INTEGER NOT NULL CHECK(bill_line_count > 0),
  source_purchase_rate_id INTEGER,
  purchase_pack_cost_paise INTEGER,
  pieces_per_pack INTEGER,
  purchase_unit_paise INTEGER,
  purchase_line_paise INTEGER,
  unavailable_reason TEXT CHECK(unavailable_reason IN ('missing_purchase_rate','unsupported_family_pack','missing_unit_basis','unsafe_cost')),
  captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(request_id, request_line_id),
  CHECK((unavailable_reason IS NOT NULL AND purchase_unit_paise IS NULL AND purchase_line_paise IS NULL)
    OR (unavailable_reason IS NULL AND typeof(purchase_unit_paise) = 'integer'
      AND purchase_unit_paise BETWEEN 0 AND 9007199254740991
      AND typeof(purchase_line_paise) = 'integer' AND purchase_line_paise BETWEEN 0 AND 9007199254740991
      AND purchase_line_paise = purchase_unit_paise * quantity))
);
CREATE INDEX idx_bill_purchase_cost_scope ON bill_item_purchase_costs(business_id,location_id,season_id,request_id);

CREATE TRIGGER bill_purchase_cost_no_update BEFORE UPDATE ON bill_item_purchase_costs
BEGIN SELECT RAISE(ABORT,'bill_purchase_costs_immutable'); END;
CREATE TRIGGER bill_purchase_cost_no_delete BEFORE DELETE ON bill_item_purchase_costs
BEGIN SELECT RAISE(ABORT,'bill_purchase_costs_immutable'); END;
-- Explicit duplicate guard also blocks INSERT OR REPLACE (SQLite REPLACE does
-- not reliably invoke delete triggers unless recursive triggers are enabled).
CREATE TRIGGER bill_purchase_cost_scope BEFORE INSERT ON bill_item_purchase_costs
WHEN EXISTS (SELECT 1 FROM bill_item_purchase_costs WHERE quotation_item_id = NEW.quotation_item_id
  OR (NEW.request_line_id IS NOT NULL AND request_id = NEW.request_id AND request_line_id = NEW.request_line_id))
  OR NOT EXISTS (
    SELECT 1 FROM request_payment_accounts a
    JOIN customer_requests r ON r.id = a.request_id
    JOIN quotation_items i ON i.quotation_id = a.quotation_id
    WHERE a.request_id = NEW.request_id AND a.quotation_id = NEW.quotation_id AND i.id = NEW.quotation_item_id
      AND a.business_id = NEW.business_id AND a.location_id = NEW.location_id AND a.season_id = NEW.season_id
      AND r.status = 'closed' AND r.finalization_status = 'finalized' AND r.audit_actor_user_id IS NOT NULL
      AND i.request_line_id IS NEW.request_line_id AND i.product_id IS NEW.product_id
      AND i.quantity = NEW.quantity AND i.unit_type IS NEW.unit_type
  )
BEGIN SELECT RAISE(ABORT,'bill_purchase_cost_scope_or_duplicate'); END;

-- Revalidate live authority at the same commit boundary, including online
-- finalization. Legacy writers without an authenticated location actor retain
-- their existing behavior and produce no guessed historical costs.
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
      AND r.audit_actor_role IN ('owner','super_admin')
      AND sm.role IN ('owner','super_admin') AND lm.role IN ('owner','super_admin')
      AND (u.disabled_at IS NULL OR u.disabled_at = '') AND (sm.disabled_at IS NULL OR sm.disabled_at = '')
      AND (lm.disabled_at IS NULL OR lm.disabled_at = '')
      AND b.status = 'active' AND l.status = 'active' AND s.status = 'active' AND ls.status = 'active'
  )
BEGIN SELECT RAISE(ABORT,'bill_purchase_cost_authority_changed'); END;

CREATE TRIGGER bill_purchase_cost_on_finalization AFTER INSERT ON request_payment_accounts
WHEN (SELECT audit_actor_user_id FROM customer_requests WHERE id = NEW.request_id) IS NOT NULL
BEGIN
  INSERT INTO bill_item_purchase_costs(quotation_item_id,request_id,quotation_id,request_line_id,
    business_id,location_id,season_id,product_id,quantity,unit_type,bill_line_count,
    source_purchase_rate_id,purchase_pack_cost_paise,pieces_per_pack,purchase_unit_paise,purchase_line_paise,unavailable_reason)
  SELECT id,NEW.request_id,NEW.quotation_id,request_line_id,NEW.business_id,NEW.location_id,NEW.season_id,
    product_id,quantity,unit_type,line_count,rate_id,pack_cost,pieces,
    CASE WHEN reason IS NULL THEN unit_cost END,
    CASE WHEN reason IS NULL THEN unit_cost * quantity END,reason
  FROM (
    SELECT *, CASE
      WHEN product_id IS NULL THEN 'unsupported_family_pack'
      WHEN NOT reliable_unit THEN 'missing_unit_basis'
      WHEN rate_id IS NULL THEN 'missing_purchase_rate'
      WHEN typeof(unit_cost) != 'integer' OR unit_cost < 0 OR unit_cost > 9007199254740991 / quantity THEN 'unsafe_cost'
      ELSE NULL END AS reason
    FROM (
      SELECT *, CASE WHEN unit_type = 'piece' THEN
        CASE WHEN typeof(pieces) = 'integer' AND pieces > 0 THEN pack_cost / pieces END
        ELSE pack_cost END AS unit_cost,
        COALESCE((request_line_id IS NOT NULL AND matched_line IS NOT NULL AND unit_type IN ('box','piece')
          AND (unit_type != 'piece' OR (typeof(pieces) = 'integer' AND pieces > 0))),0) AS reliable_unit
      FROM (
        SELECT i.id,i.request_line_id,i.product_id,i.quantity,i.unit_type,c.line_id AS matched_line,
          (SELECT count(*) FROM quotation_items WHERE quotation_id = NEW.quotation_id) AS line_count,
          pr.id AS rate_id,pr.unit_rate_paise AS pack_cost,
          CASE WHEN json_valid(i.pack_snapshot) THEN json_extract(i.pack_snapshot,'$.piecesPerPack') END AS pieces
        FROM quotation_items i
        LEFT JOIN customer_request_items c ON c.request_id = NEW.request_id AND c.line_id = i.request_line_id
          AND c.product_id IS i.product_id AND c.quantity = i.quantity AND c.unit_type IS i.unit_type
        LEFT JOIN products p ON p.id = i.product_id AND p.location_id = NEW.location_id
        LEFT JOIN product_purchase_rates pr ON pr.product_id = p.id AND pr.location_id = NEW.location_id AND pr.effective_to IS NULL
        WHERE i.quotation_id = NEW.quotation_id
      )
    )
  );
END;
