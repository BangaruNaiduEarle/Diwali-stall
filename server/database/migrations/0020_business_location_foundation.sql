-- Business/location foundation; prepared only, NOT executed or rehearsed.
-- Migration path: server/database/migrations/0020_business_location_foundation.sql.
-- Discovered by wrangler.toml: migrations_dir = 'database/migrations'.
-- Apply only through a separately authorized single-file Wrangler migration rehearsal.
-- No explicit transaction: Wrangler owns the atomic migration batch and history INSERT.
-- Never run individual statements or split this file across invocations.
-- Keep foreign keys enabled. Do not use IGNORE/REPLACE to suppress assertion failures.
-- Baseline/snapshot comparison and independent schema-policy review are external gates.
-- Capture existing counts; verify exact preservation rather than requiring fixture totals.
-- Other seasons are optional and remain unmapped; their original records are preserved.
-- Helpers contain transient original data inside the migration transaction, not exports.
-- Successful completion drops every helper; failure requires enclosing-batch rollback.
-- Table-valued PRAGMAs, trigger parsing, rollback and compatibility MUST be rehearsed in D1.

CREATE TABLE _0020_assert (
  assertion TEXT PRIMARY KEY NOT NULL,
  ok INTEGER NOT NULL CONSTRAINT migration_0020_assertion_failed CHECK (ok = 1)
);

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.foreign_keys_enabled', CASE WHEN (SELECT foreign_keys FROM pragma_foreign_keys) = 1 THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.no_foreign_key_violations', CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.no_foundation_or_helper_conflicts', CASE WHEN NOT EXISTS (
  SELECT 1 FROM sqlite_master
  WHERE name IN ('businesses', 'business_locations', 'location_seasons', 'location_members')
     OR (substr(name, 1, 6) = '_0020_' AND name <> '_0020_assert')
) THEN 1 ELSE 0 END;

-- The two inventory assertions together require the exact original non-platform
-- inventory: 20 application tables plus sqlite_sequence. No platform table names,
-- schemas, column lists or data are required to exist or remain unchanged.
WITH expected_tables(name) AS (
  VALUES
    ('admin_login_attempts'),
    ('admin_owner_bootstrap'),
    ('admin_sessions'),
    ('admin_users'),
    ('business_seasons'),
    ('categories'),
    ('customer_request_items'),
    ('customer_requests'),
    ('d1_migrations'),
    ('family_pack_images'),
    ('family_pack_items'),
    ('family_packs'),
    ('platform_admins'),
    ('platform_settings'),
    ('private_rates'),
    ('product_purchase_rates'),
    ('products'),
    ('quotation_items'),
    ('quotations'),
    ('season_members'),
    ('sqlite_sequence')
)
INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.exact_original_table_inventory', CASE WHEN NOT EXISTS (
  SELECT name FROM sqlite_master
  WHERE type = 'table' AND name <> '_0020_assert'
    AND substr(lower(name), 1, 4) <> '_cf_'
  EXCEPT SELECT name FROM expected_tables
) THEN 1 ELSE 0 END;

WITH expected_tables(name) AS (
  VALUES
    ('admin_login_attempts'),
    ('admin_owner_bootstrap'),
    ('admin_sessions'),
    ('admin_users'),
    ('business_seasons'),
    ('categories'),
    ('customer_request_items'),
    ('customer_requests'),
    ('d1_migrations'),
    ('family_pack_images'),
    ('family_pack_items'),
    ('family_packs'),
    ('platform_admins'),
    ('platform_settings'),
    ('private_rates'),
    ('product_purchase_rates'),
    ('products'),
    ('quotation_items'),
    ('quotations'),
    ('season_members'),
    ('sqlite_sequence')
)
INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.required_original_tables_present', CASE WHEN NOT EXISTS (
  SELECT name FROM expected_tables
  EXCEPT SELECT name FROM sqlite_master
  WHERE type = 'table' AND name <> '_0020_assert'
    AND substr(lower(name), 1, 4) <> '_cf_'
) THEN 1 ELSE 0 END;

WITH expected_migrations(name) AS (
  VALUES
    ('0001_initial_schema.sql'),
    ('0002_seed_categories.sql'),
    ('0003_products_company.sql'),
    ('0004_products_selling_price_paise.sql'),
    ('0005_product_purchase_rates.sql'),
    ('0006_quotations_one_active_per_request.sql'),
    ('0007_admin_password_auth.sql'),
    ('0008_admin_owner_bootstrap_lock.sql'),
    ('0009_family_packs.sql'),
    ('0010_customer_request_unit_price.sql'),
    ('0010_products_final_price_paise.sql'),
    ('0011_admin_super_admin_role.sql'),
    ('0012_customer_request_public_reference.sql'),
    ('0013_customer_request_delivery_fields.sql'),
    ('0014_products_pieces_per_pack_loose_sale.sql'),
    ('0015_quotations_quick_bill_audit.sql'),
    ('0016_customer_request_finalization_assignment.sql'),
    ('0017_customer_request_workflow_audit.sql'),
    ('0018_business_seasons_foundation.sql'),
    ('0019_platform_admins.sql')
)
INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.migration_inventory', CASE WHEN (SELECT COUNT(*) FROM d1_migrations) = 20
AND NOT EXISTS (
  SELECT name FROM d1_migrations
  EXCEPT SELECT name FROM expected_migrations
)
AND NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0020_business_location_foundation.sql') THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.valid_2026_season', CASE WHEN (SELECT COUNT(*) FROM business_seasons WHERE id = 'season-2026' AND code = '2026' AND status = 'active') = 1 THEN 1 ELSE 0 END;

-- Helpers are created only after the exact original table/history inventories pass.
-- Counts are captured before any ownership backfill; full typed row snapshots below
-- separately protect every original value, including records outside season-2026.
CREATE TABLE _0020_baseline_counts (
  table_name TEXT PRIMARY KEY NOT NULL,
  total_count INTEGER NOT NULL CHECK (total_count >= 0),
  target_count INTEGER NOT NULL CHECK (target_count >= 0 AND target_count <= total_count)
);

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.no_ownership_column.categories', CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_table_info('categories') WHERE name = 'location_id') THEN 1 ELSE 0 END;

INSERT INTO _0020_baseline_counts
SELECT 'categories', COUNT(*), COUNT(CASE WHEN season_id = 'season-2026' THEN 1 END) FROM categories;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.no_ownership_column.products', CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_table_info('products') WHERE name = 'location_id') THEN 1 ELSE 0 END;

INSERT INTO _0020_baseline_counts
SELECT 'products', COUNT(*), COUNT(CASE WHEN season_id = 'season-2026' THEN 1 END) FROM products;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.no_ownership_column.family_packs', CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_table_info('family_packs') WHERE name = 'location_id') THEN 1 ELSE 0 END;

INSERT INTO _0020_baseline_counts
SELECT 'family_packs', COUNT(*), COUNT(CASE WHEN season_id = 'season-2026' THEN 1 END) FROM family_packs;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.no_ownership_column.private_rates', CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_table_info('private_rates') WHERE name = 'location_id') THEN 1 ELSE 0 END;

INSERT INTO _0020_baseline_counts
SELECT 'private_rates', COUNT(*), COUNT(CASE WHEN season_id = 'season-2026' THEN 1 END) FROM private_rates;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.no_ownership_column.product_purchase_rates', CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_table_info('product_purchase_rates') WHERE name = 'location_id') THEN 1 ELSE 0 END;

INSERT INTO _0020_baseline_counts
SELECT 'product_purchase_rates', COUNT(*), COUNT(CASE WHEN season_id = 'season-2026' THEN 1 END) FROM product_purchase_rates;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.no_ownership_column.customer_requests', CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_table_info('customer_requests') WHERE name = 'location_id') THEN 1 ELSE 0 END;

INSERT INTO _0020_baseline_counts
SELECT 'customer_requests', COUNT(*), COUNT(CASE WHEN season_id = 'season-2026' THEN 1 END) FROM customer_requests;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.no_ownership_column.quotations', CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_table_info('quotations') WHERE name = 'location_id') THEN 1 ELSE 0 END;

INSERT INTO _0020_baseline_counts
SELECT 'quotations', COUNT(*), COUNT(CASE WHEN season_id = 'season-2026' THEN 1 END) FROM quotations;

INSERT INTO _0020_baseline_counts
SELECT 'season_members', COUNT(*), COUNT(CASE WHEN season_id = 'season-2026' THEN 1 END) FROM season_members;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.2026_product_categories', CASE WHEN NOT EXISTS (
  SELECT 1 FROM products p LEFT JOIN categories c ON c.slug = p.category_slug
  WHERE p.season_id = 'season-2026' AND (c.slug IS NULL OR c.season_id IS NOT p.season_id)
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.2026_rate_parent.private_rates', CASE WHEN NOT EXISTS (
  SELECT 1 FROM private_rates r LEFT JOIN products p ON p.id = r.product_id
  WHERE r.season_id = 'season-2026' AND (p.id IS NULL OR p.season_id IS NOT r.season_id)
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.2026_rate_parent.product_purchase_rates', CASE WHEN NOT EXISTS (
  SELECT 1 FROM product_purchase_rates r LEFT JOIN products p ON p.id = r.product_id
  WHERE r.season_id = 'season-2026' AND (p.id IS NULL OR p.season_id IS NOT r.season_id)
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.2026_pack_components', CASE WHEN NOT EXISTS (
  SELECT 1 FROM family_pack_items i
  JOIN family_packs f ON f.id = i.family_pack_id
  LEFT JOIN products p ON p.id = i.product_id
  WHERE f.season_id = 'season-2026' AND (p.id IS NULL OR p.season_id IS NOT f.season_id)
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.2026_request_lines', CASE WHEN NOT EXISTS (
  SELECT 1 FROM customer_request_items i
  JOIN customer_requests r ON r.id = i.request_id
  LEFT JOIN products p ON p.id = i.product_id
  LEFT JOIN family_packs f ON f.id = i.family_pack_id
  WHERE r.season_id = 'season-2026'
    AND ((i.product_id IS NOT NULL AND (p.id IS NULL OR p.season_id IS NOT r.season_id))
      OR (i.family_pack_id IS NOT NULL AND (f.id IS NULL OR f.season_id IS NOT r.season_id)))
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.2026_quotation_parents', CASE WHEN NOT EXISTS (
  SELECT 1 FROM quotations q LEFT JOIN customer_requests r ON r.id = q.customer_request_id
  WHERE q.season_id = 'season-2026' AND (r.id IS NULL OR r.season_id IS NOT q.season_id)
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.2026_quotation_lines', CASE WHEN NOT EXISTS (
  SELECT 1 FROM quotation_items i JOIN quotations q ON q.id = i.quotation_id
  LEFT JOIN products p ON p.id = i.product_id
  WHERE q.season_id = 'season-2026' AND i.product_id IS NOT NULL
    AND (p.id IS NULL OR p.season_id IS NOT q.season_id)
) THEN 1 ELSE 0 END;

-- Reject extra original columns rather than silently omitting them from snapshots.
INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.admin_login_attempts', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('admin_login_attempts')) = 5
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('admin_login_attempts') WHERE name NOT IN ('id', 'email_normalized', 'ip_hash', 'attempted_at', 'success')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.admin_owner_bootstrap', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('admin_owner_bootstrap')) = 3
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('admin_owner_bootstrap') WHERE name NOT IN ('singleton_id', 'owner_user_id', 'bootstrapped_at')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.admin_sessions', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('admin_sessions')) = 5
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('admin_sessions') WHERE name NOT IN ('id', 'admin_user_id', 'expires_at', 'created_at', 'last_seen_at')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.admin_users', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('admin_users')) = 8
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('admin_users') WHERE name NOT IN ('id', 'email', 'display_name', 'created_at', 'updated_at', 'role', 'password_hash', 'disabled_at')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.business_seasons', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('business_seasons')) = 6
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('business_seasons') WHERE name NOT IN ('id', 'code', 'label', 'status', 'created_at', 'updated_at')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.categories', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('categories')) = 6
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('categories') WHERE name NOT IN ('slug', 'label', 'sort_order', 'created_at', 'updated_at', 'season_id')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.customer_request_items', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('customer_request_items')) = 9
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('customer_request_items') WHERE name NOT IN ('id', 'request_id', 'line_number', 'product_id', 'product_name', 'quantity', 'created_at', 'family_pack_id', 'unit_price_paise')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.customer_requests', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('customer_requests')) = 22
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('customer_requests') WHERE name NOT IN ('id', 'status', 'customer_name', 'customer_phone', 'customer_area', 'pickup_preference', 'customer_note', 'source', 'raw_message', 'created_at', 'updated_at', 'public_reference', 'delivery_address', 'delivery_landmark', 'delivery_maps_url', 'finalization_status', 'assigned_to_email', 'assigned_by_email', 'assigned_at', 'closed_by_email', 'closed_at', 'season_id')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.d1_migrations', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('d1_migrations')) = 3
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('d1_migrations') WHERE name NOT IN ('id', 'name', 'applied_at')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.family_pack_images', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('family_pack_images')) = 6
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('family_pack_images') WHERE name NOT IN ('id', 'family_pack_id', 'sort_order', 'url', 'is_cover', 'created_at')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.family_pack_items', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('family_pack_items')) = 6
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('family_pack_items') WHERE name NOT IN ('id', 'family_pack_id', 'product_id', 'quantity', 'unit_label', 'sort_order')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.family_packs', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('family_packs')) = 12
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('family_packs') WHERE name NOT IN ('id', 'slug', 'name', 'short_description', 'selling_price_paise', 'pack_label', 'sort_order', 'active', 'archived', 'created_at', 'updated_at', 'season_id')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.platform_admins', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('platform_admins')) = 2
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('platform_admins') WHERE name NOT IN ('admin_user_id', 'created_at')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.platform_settings', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('platform_settings')) = 4
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('platform_settings') WHERE name NOT IN ('singleton_id', 'public_catalogue_season_id', 'updated_at', 'updated_by_email')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.private_rates', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('private_rates')) = 9
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('private_rates') WHERE name NOT IN ('id', 'product_id', 'unit_rate_paise', 'effective_from', 'effective_to', 'notes', 'created_at', 'updated_at', 'season_id')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.product_purchase_rates', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('product_purchase_rates')) = 9
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('product_purchase_rates') WHERE name NOT IN ('id', 'product_id', 'unit_rate_paise', 'effective_from', 'effective_to', 'notes', 'created_at', 'updated_at', 'season_id')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.products', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('products')) = 18
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('products') WHERE name NOT IN ('id', 'category_slug', 'name', 'pack', 'description', 'featured', 'stock_status', 'active', 'sort_order', 'images_json', 'created_at', 'updated_at', 'company', 'selling_price_paise', 'final_price_paise', 'pieces_per_pack', 'allow_loose_sale', 'season_id')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.quotation_items', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('quotation_items')) = 9
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('quotation_items') WHERE name NOT IN ('id', 'quotation_id', 'line_number', 'product_id', 'product_name', 'quantity', 'unit_rate_paise', 'line_total_paise', 'created_at')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.quotations', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('quotations')) = 20
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('quotations') WHERE name NOT IN ('id', 'customer_request_id', 'status', 'customer_name', 'customer_phone', 'customer_note', 'currency', 'subtotal_paise', 'adjustment_paise', 'total_paise', 'wa_message_text', 'created_by_email', 'created_at', 'updated_at', 'pricing_mode', 'selling_subtotal_paise', 'final_subtotal_paise', 'bargain_floor_paise', 'accepted_amount_paise', 'season_id')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.season_members', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('season_members')) = 5
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('season_members') WHERE name NOT IN ('season_id', 'admin_user_id', 'role', 'created_at', 'disabled_at')
  ) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.original_columns.sqlite_sequence', CASE WHEN
  (SELECT COUNT(*) FROM pragma_table_xinfo('sqlite_sequence')) = 2
  AND NOT EXISTS (
    SELECT 1 FROM pragma_table_xinfo('sqlite_sequence') WHERE name NOT IN ('name', 'seq')
  ) THEN 1 ELSE 0 END;


-- Preserve every original application table, global settings/auth/history, SQLite
-- sequences and unowned rows. Platform-owned objects are excluded without any
-- assumptions about their schema or bookkeeping. Helpers have NO column affinity:
-- copying values must not coerce their SQLite storage classes.
CREATE TABLE _0020_before_schema (type, name, tbl_name, sql);
INSERT INTO _0020_before_schema
SELECT type, name, tbl_name, sql FROM sqlite_master
WHERE substr(name, 1, 6) <> '_0020_' AND substr(tbl_name, 1, 6) <> '_0020_'
  AND substr(lower(name), 1, 4) <> '_cf_'
  AND substr(lower(tbl_name), 1, 4) <> '_cf_';

CREATE TABLE "_0020_before_admin_login_attempts" ("id", "email_normalized", "ip_hash", "attempted_at", "success");
INSERT INTO "_0020_before_admin_login_attempts" ("id", "email_normalized", "ip_hash", "attempted_at", "success")
SELECT "id", "email_normalized", "ip_hash", "attempted_at", "success" FROM "admin_login_attempts";

CREATE TABLE "_0020_before_admin_owner_bootstrap" ("singleton_id", "owner_user_id", "bootstrapped_at");
INSERT INTO "_0020_before_admin_owner_bootstrap" ("singleton_id", "owner_user_id", "bootstrapped_at")
SELECT "singleton_id", "owner_user_id", "bootstrapped_at" FROM "admin_owner_bootstrap";

CREATE TABLE "_0020_before_admin_sessions" ("id", "admin_user_id", "expires_at", "created_at", "last_seen_at");
INSERT INTO "_0020_before_admin_sessions" ("id", "admin_user_id", "expires_at", "created_at", "last_seen_at")
SELECT "id", "admin_user_id", "expires_at", "created_at", "last_seen_at" FROM "admin_sessions";

CREATE TABLE "_0020_before_admin_users" ("id", "email", "display_name", "created_at", "updated_at", "role", "password_hash", "disabled_at");
INSERT INTO "_0020_before_admin_users" ("id", "email", "display_name", "created_at", "updated_at", "role", "password_hash", "disabled_at")
SELECT "id", "email", "display_name", "created_at", "updated_at", "role", "password_hash", "disabled_at" FROM "admin_users";

CREATE TABLE "_0020_before_business_seasons" ("id", "code", "label", "status", "created_at", "updated_at");
INSERT INTO "_0020_before_business_seasons" ("id", "code", "label", "status", "created_at", "updated_at")
SELECT "id", "code", "label", "status", "created_at", "updated_at" FROM "business_seasons";

CREATE TABLE "_0020_before_categories" ("slug", "label", "sort_order", "created_at", "updated_at", "season_id");
INSERT INTO "_0020_before_categories" ("slug", "label", "sort_order", "created_at", "updated_at", "season_id")
SELECT "slug", "label", "sort_order", "created_at", "updated_at", "season_id" FROM "categories";

CREATE TABLE "_0020_before_customer_request_items" ("id", "request_id", "line_number", "product_id", "product_name", "quantity", "created_at", "family_pack_id", "unit_price_paise");
INSERT INTO "_0020_before_customer_request_items" ("id", "request_id", "line_number", "product_id", "product_name", "quantity", "created_at", "family_pack_id", "unit_price_paise")
SELECT "id", "request_id", "line_number", "product_id", "product_name", "quantity", "created_at", "family_pack_id", "unit_price_paise" FROM "customer_request_items";

CREATE TABLE "_0020_before_customer_requests" ("id", "status", "customer_name", "customer_phone", "customer_area", "pickup_preference", "customer_note", "source", "raw_message", "created_at", "updated_at", "public_reference", "delivery_address", "delivery_landmark", "delivery_maps_url", "finalization_status", "assigned_to_email", "assigned_by_email", "assigned_at", "closed_by_email", "closed_at", "season_id");
INSERT INTO "_0020_before_customer_requests" ("id", "status", "customer_name", "customer_phone", "customer_area", "pickup_preference", "customer_note", "source", "raw_message", "created_at", "updated_at", "public_reference", "delivery_address", "delivery_landmark", "delivery_maps_url", "finalization_status", "assigned_to_email", "assigned_by_email", "assigned_at", "closed_by_email", "closed_at", "season_id")
SELECT "id", "status", "customer_name", "customer_phone", "customer_area", "pickup_preference", "customer_note", "source", "raw_message", "created_at", "updated_at", "public_reference", "delivery_address", "delivery_landmark", "delivery_maps_url", "finalization_status", "assigned_to_email", "assigned_by_email", "assigned_at", "closed_by_email", "closed_at", "season_id" FROM "customer_requests";

CREATE TABLE "_0020_before_d1_migrations" ("id", "name", "applied_at");
INSERT INTO "_0020_before_d1_migrations" ("id", "name", "applied_at")
SELECT "id", "name", "applied_at" FROM "d1_migrations";

CREATE TABLE "_0020_before_family_pack_images" ("id", "family_pack_id", "sort_order", "url", "is_cover", "created_at");
INSERT INTO "_0020_before_family_pack_images" ("id", "family_pack_id", "sort_order", "url", "is_cover", "created_at")
SELECT "id", "family_pack_id", "sort_order", "url", "is_cover", "created_at" FROM "family_pack_images";

CREATE TABLE "_0020_before_family_pack_items" ("id", "family_pack_id", "product_id", "quantity", "unit_label", "sort_order");
INSERT INTO "_0020_before_family_pack_items" ("id", "family_pack_id", "product_id", "quantity", "unit_label", "sort_order")
SELECT "id", "family_pack_id", "product_id", "quantity", "unit_label", "sort_order" FROM "family_pack_items";

CREATE TABLE "_0020_before_family_packs" ("id", "slug", "name", "short_description", "selling_price_paise", "pack_label", "sort_order", "active", "archived", "created_at", "updated_at", "season_id");
INSERT INTO "_0020_before_family_packs" ("id", "slug", "name", "short_description", "selling_price_paise", "pack_label", "sort_order", "active", "archived", "created_at", "updated_at", "season_id")
SELECT "id", "slug", "name", "short_description", "selling_price_paise", "pack_label", "sort_order", "active", "archived", "created_at", "updated_at", "season_id" FROM "family_packs";

CREATE TABLE "_0020_before_platform_admins" ("admin_user_id", "created_at");
INSERT INTO "_0020_before_platform_admins" ("admin_user_id", "created_at")
SELECT "admin_user_id", "created_at" FROM "platform_admins";

CREATE TABLE "_0020_before_platform_settings" ("singleton_id", "public_catalogue_season_id", "updated_at", "updated_by_email");
INSERT INTO "_0020_before_platform_settings" ("singleton_id", "public_catalogue_season_id", "updated_at", "updated_by_email")
SELECT "singleton_id", "public_catalogue_season_id", "updated_at", "updated_by_email" FROM "platform_settings";

CREATE TABLE "_0020_before_private_rates" ("id", "product_id", "unit_rate_paise", "effective_from", "effective_to", "notes", "created_at", "updated_at", "season_id");
INSERT INTO "_0020_before_private_rates" ("id", "product_id", "unit_rate_paise", "effective_from", "effective_to", "notes", "created_at", "updated_at", "season_id")
SELECT "id", "product_id", "unit_rate_paise", "effective_from", "effective_to", "notes", "created_at", "updated_at", "season_id" FROM "private_rates";

CREATE TABLE "_0020_before_product_purchase_rates" ("id", "product_id", "unit_rate_paise", "effective_from", "effective_to", "notes", "created_at", "updated_at", "season_id");
INSERT INTO "_0020_before_product_purchase_rates" ("id", "product_id", "unit_rate_paise", "effective_from", "effective_to", "notes", "created_at", "updated_at", "season_id")
SELECT "id", "product_id", "unit_rate_paise", "effective_from", "effective_to", "notes", "created_at", "updated_at", "season_id" FROM "product_purchase_rates";

CREATE TABLE "_0020_before_products" ("id", "category_slug", "name", "pack", "description", "featured", "stock_status", "active", "sort_order", "images_json", "created_at", "updated_at", "company", "selling_price_paise", "final_price_paise", "pieces_per_pack", "allow_loose_sale", "season_id");
INSERT INTO "_0020_before_products" ("id", "category_slug", "name", "pack", "description", "featured", "stock_status", "active", "sort_order", "images_json", "created_at", "updated_at", "company", "selling_price_paise", "final_price_paise", "pieces_per_pack", "allow_loose_sale", "season_id")
SELECT "id", "category_slug", "name", "pack", "description", "featured", "stock_status", "active", "sort_order", "images_json", "created_at", "updated_at", "company", "selling_price_paise", "final_price_paise", "pieces_per_pack", "allow_loose_sale", "season_id" FROM "products";

CREATE TABLE "_0020_before_quotation_items" ("id", "quotation_id", "line_number", "product_id", "product_name", "quantity", "unit_rate_paise", "line_total_paise", "created_at");
INSERT INTO "_0020_before_quotation_items" ("id", "quotation_id", "line_number", "product_id", "product_name", "quantity", "unit_rate_paise", "line_total_paise", "created_at")
SELECT "id", "quotation_id", "line_number", "product_id", "product_name", "quantity", "unit_rate_paise", "line_total_paise", "created_at" FROM "quotation_items";

CREATE TABLE "_0020_before_quotations" ("id", "customer_request_id", "status", "customer_name", "customer_phone", "customer_note", "currency", "subtotal_paise", "adjustment_paise", "total_paise", "wa_message_text", "created_by_email", "created_at", "updated_at", "pricing_mode", "selling_subtotal_paise", "final_subtotal_paise", "bargain_floor_paise", "accepted_amount_paise", "season_id");
INSERT INTO "_0020_before_quotations" ("id", "customer_request_id", "status", "customer_name", "customer_phone", "customer_note", "currency", "subtotal_paise", "adjustment_paise", "total_paise", "wa_message_text", "created_by_email", "created_at", "updated_at", "pricing_mode", "selling_subtotal_paise", "final_subtotal_paise", "bargain_floor_paise", "accepted_amount_paise", "season_id")
SELECT "id", "customer_request_id", "status", "customer_name", "customer_phone", "customer_note", "currency", "subtotal_paise", "adjustment_paise", "total_paise", "wa_message_text", "created_by_email", "created_at", "updated_at", "pricing_mode", "selling_subtotal_paise", "final_subtotal_paise", "bargain_floor_paise", "accepted_amount_paise", "season_id" FROM "quotations";

CREATE TABLE "_0020_before_season_members" ("season_id", "admin_user_id", "role", "created_at", "disabled_at");
INSERT INTO "_0020_before_season_members" ("season_id", "admin_user_id", "role", "created_at", "disabled_at")
SELECT "season_id", "admin_user_id", "role", "created_at", "disabled_at" FROM "season_members";

CREATE TABLE "_0020_before_sqlite_sequence" ("name", "seq");
INSERT INTO "_0020_before_sqlite_sequence" ("name", "seq")
SELECT "name", "seq" FROM "sqlite_sequence";

-- Stable business identity; physical location identity is a separate row.
CREATE TABLE businesses (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  slug TEXT NOT NULL UNIQUE CHECK (length(trim(slug)) > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  business_type TEXT NOT NULL CHECK (business_type IN ('permanent', 'seasonal')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE business_locations (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  business_id TEXT NOT NULL REFERENCES businesses(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  slug TEXT NOT NULL CHECK (length(trim(slug)) > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  address TEXT,
  stall_label TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (business_id, slug)
);

CREATE TABLE location_seasons (
  location_id TEXT NOT NULL REFERENCES business_locations(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  season_id TEXT NOT NULL REFERENCES business_seasons(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  operating_year INTEGER NOT NULL CHECK (typeof(operating_year) = 'integer' AND operating_year BETWEEN 1 AND 9999),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (location_id, season_id)
);

CREATE TABLE location_members (
  location_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  admin_user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'super_admin', 'admin')),
  disabled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (location_id, season_id, admin_user_id),
  FOREIGN KEY (location_id, season_id)
    REFERENCES location_seasons(location_id, season_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (season_id, admin_user_id)
    REFERENCES season_members(season_id, admin_user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
-- Membership existence and allowed role values are enforced above. Future API
-- authorization must require BOTH memberships, respect BOTH disabled states and
-- intersect capabilities; a location role never replaces the season role.

CREATE INDEX idx_location_seasons_season ON location_seasons(season_id, location_id);
CREATE INDEX idx_location_members_user ON location_members(admin_user_id, season_id, location_id);
-- UNIQUE(business_id, slug) already indexes business_locations by business_id.

-- Association identity/year cannot be rewritten or removed to reuse a seasonal
-- site in another year. Archive existing associations and insert new records.
CREATE TRIGGER trg_0020_location_season_insert
BEFORE INSERT ON location_seasons
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM location_seasons
    WHERE location_id = NEW.location_id AND season_id = NEW.season_id
  ) THEN RAISE(ABORT, 'location-season identity already exists') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM business_locations l
    JOIN businesses b ON b.id = l.business_id
    JOIN location_seasons s ON s.location_id = l.id
    WHERE l.id = NEW.location_id AND b.business_type = 'seasonal'
      AND s.operating_year IS NOT NEW.operating_year
  ) THEN RAISE(ABORT, 'seasonal location cannot span operating years') END;
END;

CREATE TRIGGER trg_0020_location_season_identity
BEFORE UPDATE OF location_id, season_id, operating_year ON location_seasons
WHEN NEW.location_id IS NOT OLD.location_id
  OR NEW.season_id IS NOT OLD.season_id
  OR NEW.operating_year IS NOT OLD.operating_year
BEGIN
  SELECT RAISE(ABORT, 'location-season identity and year are immutable');
END;

CREATE TRIGGER trg_0020_location_season_delete
BEFORE DELETE ON location_seasons
BEGIN
  SELECT RAISE(ABORT, 'archive location-season associations instead of deleting');
END;

CREATE TRIGGER trg_0020_location_identity
BEFORE UPDATE OF id, business_id ON business_locations
WHEN NEW.id IS NOT OLD.id OR NEW.business_id IS NOT OLD.business_id
BEGIN
  SELECT RAISE(ABORT, 'location identity and business ownership are immutable');
END;

CREATE TRIGGER trg_0020_business_identity
BEFORE UPDATE OF id, business_type ON businesses
WHEN NEW.id IS NOT OLD.id
  OR (NEW.business_type IS NOT OLD.business_type
      AND EXISTS (SELECT 1 FROM business_locations WHERE business_id = OLD.id))
BEGIN
  SELECT RAISE(ABORT, 'business identity or type cannot invalidate locations');
END;

-- No one-location-per-business/year uniqueness rule: concurrent sites are allowed.
-- Every added operational FK stays nullable, with no default. Existing catalogue
-- season_id remains provenance; transaction season_id remains the operating period.
-- Existing global category/pack slug constraints are deliberately unchanged.
ALTER TABLE categories ADD COLUMN location_id TEXT REFERENCES business_locations(id);
ALTER TABLE products ADD COLUMN location_id TEXT REFERENCES business_locations(id);
ALTER TABLE family_packs ADD COLUMN location_id TEXT REFERENCES business_locations(id);
ALTER TABLE private_rates ADD COLUMN location_id TEXT REFERENCES business_locations(id);
ALTER TABLE product_purchase_rates ADD COLUMN location_id TEXT REFERENCES business_locations(id);
ALTER TABLE customer_requests ADD COLUMN location_id TEXT REFERENCES business_locations(id);
ALTER TABLE quotations ADD COLUMN location_id TEXT REFERENCES business_locations(id);

CREATE INDEX idx_categories_location ON categories(location_id);
CREATE INDEX idx_products_location ON products(location_id);
CREATE INDEX idx_family_packs_location ON family_packs(location_id);
CREATE INDEX idx_private_rates_location_product ON private_rates(location_id, product_id);
CREATE INDEX idx_purchase_rates_location_product ON product_purchase_rates(location_id, product_id);
CREATE INDEX idx_requests_location_season_created ON customer_requests(location_id, season_id, created_at);
CREATE INDEX idx_quotations_location_season_request ON quotations(location_id, season_id, customer_request_id);

INSERT INTO _0020_assert (assertion, ok)
SELECT 'pre.proposed_identity_conflicts', CASE WHEN NOT EXISTS (SELECT 1 FROM businesses WHERE id = 'business-diwali' OR slug = 'diwali')
AND NOT EXISTS (SELECT 1 FROM business_locations WHERE id = 'location-diwali-2026'
  OR (business_id = 'business-diwali' AND slug = 'diwali-2026'))
AND NOT EXISTS (SELECT 1 FROM location_seasons WHERE location_id = 'location-diwali-2026')
AND NOT EXISTS (SELECT 1 FROM location_members WHERE location_id = 'location-diwali-2026') THEN 1 ELSE 0 END;

INSERT INTO businesses (id, slug, name, business_type)
VALUES ('business-diwali', 'diwali', 'Diwali', 'seasonal');

INSERT INTO business_locations (id, business_id, slug, name, address, stall_label)
VALUES ('location-diwali-2026', 'business-diwali', 'diwali-2026', 'Diwali 2026', NULL, NULL);

INSERT INTO location_seasons (location_id, season_id, operating_year)
SELECT 'location-diwali-2026', id, 2026 FROM business_seasons WHERE id = 'season-2026';

-- Ordered root/parent backfill. Never assign a location to any other season.
UPDATE categories SET location_id = 'location-diwali-2026'
WHERE season_id = 'season-2026';

UPDATE products SET location_id = (
  SELECT c.location_id FROM categories c
  WHERE c.slug = products.category_slug AND c.season_id = 'season-2026'
)
WHERE season_id = 'season-2026';

UPDATE family_packs SET location_id = 'location-diwali-2026'
WHERE season_id = 'season-2026';

UPDATE private_rates SET location_id = (
  SELECT p.location_id FROM products p
  WHERE p.id = private_rates.product_id AND p.season_id = 'season-2026'
)
WHERE season_id = 'season-2026';

UPDATE product_purchase_rates SET location_id = (
  SELECT p.location_id FROM products p
  WHERE p.id = product_purchase_rates.product_id AND p.season_id = 'season-2026'
)
WHERE season_id = 'season-2026';

UPDATE customer_requests SET location_id = 'location-diwali-2026'
WHERE season_id = 'season-2026';

UPDATE quotations SET location_id = (
  SELECT r.location_id FROM customer_requests r
  WHERE r.id = quotations.customer_request_id AND r.season_id = 'season-2026'
)
WHERE season_id = 'season-2026';

INSERT INTO location_members
  (location_id, season_id, admin_user_id, role, disabled_at, created_at)
SELECT 'location-diwali-2026', season_id, admin_user_id, role, disabled_at, created_at
FROM season_members WHERE season_id = 'season-2026';

-- Rate triggers intentionally installed only after product/rate backfill.
-- A legacy omitted/NULL location is derived ONLY from the referenced product,
-- never from a default location or season. Non-NULL mismatches are rejected.
-- Derivation and its validating UPDATE are within the original INSERT statement.
CREATE TRIGGER trg_0020_private_rates_insert
AFTER INSERT ON private_rates
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id)
    THEN RAISE(ABORT, 'rate product does not exist') END;
  SELECT CASE WHEN NEW.location_id IS NOT NULL AND NEW.location_id IS NOT (
    SELECT location_id FROM products WHERE id = NEW.product_id
  ) THEN RAISE(ABORT, 'rate location must match product location') END;
  UPDATE private_rates SET location_id = (
    SELECT location_id FROM products WHERE id = NEW.product_id
  )
  WHERE id = NEW.id AND NEW.location_id IS NULL
    AND (SELECT location_id FROM products WHERE id = NEW.product_id) IS NOT NULL;
END;

CREATE TRIGGER trg_0020_private_rates_update
BEFORE UPDATE OF product_id, location_id ON private_rates
WHEN NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id)
  OR NEW.location_id IS NOT (SELECT location_id FROM products WHERE id = NEW.product_id)
BEGIN
  SELECT RAISE(ABORT, 'rate location must match product location');
END;

CREATE TRIGGER trg_0020_product_purchase_rates_insert
AFTER INSERT ON product_purchase_rates
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id)
    THEN RAISE(ABORT, 'rate product does not exist') END;
  SELECT CASE WHEN NEW.location_id IS NOT NULL AND NEW.location_id IS NOT (
    SELECT location_id FROM products WHERE id = NEW.product_id
  ) THEN RAISE(ABORT, 'rate location must match product location') END;
  UPDATE product_purchase_rates SET location_id = (
    SELECT location_id FROM products WHERE id = NEW.product_id
  )
  WHERE id = NEW.id AND NEW.location_id IS NULL
    AND (SELECT location_id FROM products WHERE id = NEW.product_id) IS NOT NULL;
END;

CREATE TRIGGER trg_0020_product_purchase_rates_update
BEFORE UPDATE OF product_id, location_id ON product_purchase_rates
WHEN NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id)
  OR NEW.location_id IS NOT (SELECT location_id FROM products WHERE id = NEW.product_id)
BEGIN
  SELECT RAISE(ABORT, 'rate location must match product location');
END;

CREATE TRIGGER trg_0020_product_rate_ownership
BEFORE UPDATE OF id, location_id ON products
WHEN EXISTS (
  SELECT 1 FROM private_rates r WHERE r.product_id = OLD.id
    AND (NEW.id IS NOT OLD.id OR r.location_id IS NOT NEW.location_id)
) OR EXISTS (
  SELECT 1 FROM product_purchase_rates r WHERE r.product_id = OLD.id
    AND (NEW.id IS NOT OLD.id OR r.location_id IS NOT NEW.location_id)
)
BEGIN
  SELECT RAISE(ABORT, 'product ownership change would invalidate rates');
END;

-- Failing assertions, not informational SELECTs: any violation aborts the
-- enclosing Wrangler batch. Constant assertion names avoid exposing row values.
INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.business_identity', CASE WHEN (SELECT COUNT(*) FROM businesses) = 1
AND EXISTS (SELECT 1 FROM businesses WHERE id = 'business-diwali' AND slug = 'diwali'
  AND name = 'Diwali' AND business_type = 'seasonal' AND status = 'active') THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.location_identity', CASE WHEN (SELECT COUNT(*) FROM business_locations) = 1
AND EXISTS (SELECT 1 FROM business_locations WHERE id = 'location-diwali-2026'
  AND business_id = 'business-diwali' AND slug = 'diwali-2026'
  AND address IS NULL AND stall_label IS NULL AND status = 'active') THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.only_2026_association', CASE WHEN (SELECT COUNT(*) FROM location_seasons) = 1
AND EXISTS (SELECT 1 FROM location_seasons WHERE location_id = 'location-diwali-2026'
  AND season_id = 'season-2026' AND operating_year = 2026 AND status = 'active') THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.2026_count.categories', CASE WHEN (SELECT COUNT(*) FROM "categories" WHERE season_id = 'season-2026'
  AND location_id = 'location-diwali-2026') = (SELECT target_count FROM _0020_baseline_counts WHERE table_name = 'categories')
AND (SELECT COUNT(*) FROM categories) = (SELECT total_count FROM _0020_baseline_counts WHERE table_name = 'categories') THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.only_2026_owned.categories', CASE WHEN NOT EXISTS (
  SELECT 1 FROM "categories"
  WHERE location_id IS NOT CASE WHEN season_id = 'season-2026' THEN 'location-diwali-2026' ELSE NULL END
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.2026_count.products', CASE WHEN (SELECT COUNT(*) FROM "products" WHERE season_id = 'season-2026'
  AND location_id = 'location-diwali-2026') = (SELECT target_count FROM _0020_baseline_counts WHERE table_name = 'products')
AND (SELECT COUNT(*) FROM products) = (SELECT total_count FROM _0020_baseline_counts WHERE table_name = 'products') THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.only_2026_owned.products', CASE WHEN NOT EXISTS (
  SELECT 1 FROM "products"
  WHERE location_id IS NOT CASE WHEN season_id = 'season-2026' THEN 'location-diwali-2026' ELSE NULL END
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.2026_count.family_packs', CASE WHEN (SELECT COUNT(*) FROM "family_packs" WHERE season_id = 'season-2026'
  AND location_id = 'location-diwali-2026') = (SELECT target_count FROM _0020_baseline_counts WHERE table_name = 'family_packs')
AND (SELECT COUNT(*) FROM family_packs) = (SELECT total_count FROM _0020_baseline_counts WHERE table_name = 'family_packs') THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.only_2026_owned.family_packs', CASE WHEN NOT EXISTS (
  SELECT 1 FROM "family_packs"
  WHERE location_id IS NOT CASE WHEN season_id = 'season-2026' THEN 'location-diwali-2026' ELSE NULL END
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.2026_count.private_rates', CASE WHEN (SELECT COUNT(*) FROM "private_rates" WHERE season_id = 'season-2026'
  AND location_id = 'location-diwali-2026') = (SELECT target_count FROM _0020_baseline_counts WHERE table_name = 'private_rates')
AND (SELECT COUNT(*) FROM private_rates) = (SELECT total_count FROM _0020_baseline_counts WHERE table_name = 'private_rates') THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.only_2026_owned.private_rates', CASE WHEN NOT EXISTS (
  SELECT 1 FROM "private_rates"
  WHERE location_id IS NOT CASE WHEN season_id = 'season-2026' THEN 'location-diwali-2026' ELSE NULL END
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.2026_count.product_purchase_rates', CASE WHEN (SELECT COUNT(*) FROM "product_purchase_rates" WHERE season_id = 'season-2026'
  AND location_id = 'location-diwali-2026') = (SELECT target_count FROM _0020_baseline_counts WHERE table_name = 'product_purchase_rates')
AND (SELECT COUNT(*) FROM product_purchase_rates) = (SELECT total_count FROM _0020_baseline_counts WHERE table_name = 'product_purchase_rates') THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.only_2026_owned.product_purchase_rates', CASE WHEN NOT EXISTS (
  SELECT 1 FROM "product_purchase_rates"
  WHERE location_id IS NOT CASE WHEN season_id = 'season-2026' THEN 'location-diwali-2026' ELSE NULL END
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.2026_count.customer_requests', CASE WHEN (SELECT COUNT(*) FROM "customer_requests" WHERE season_id = 'season-2026'
  AND location_id = 'location-diwali-2026') = (SELECT target_count FROM _0020_baseline_counts WHERE table_name = 'customer_requests')
AND (SELECT COUNT(*) FROM customer_requests) = (SELECT total_count FROM _0020_baseline_counts WHERE table_name = 'customer_requests') THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.only_2026_owned.customer_requests', CASE WHEN NOT EXISTS (
  SELECT 1 FROM "customer_requests"
  WHERE location_id IS NOT CASE WHEN season_id = 'season-2026' THEN 'location-diwali-2026' ELSE NULL END
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.2026_count.quotations', CASE WHEN (SELECT COUNT(*) FROM "quotations" WHERE season_id = 'season-2026'
  AND location_id = 'location-diwali-2026') = (SELECT target_count FROM _0020_baseline_counts WHERE table_name = 'quotations')
AND (SELECT COUNT(*) FROM quotations) = (SELECT total_count FROM _0020_baseline_counts WHERE table_name = 'quotations') THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.only_2026_owned.quotations', CASE WHEN NOT EXISTS (
  SELECT 1 FROM "quotations"
  WHERE location_id IS NOT CASE WHEN season_id = 'season-2026' THEN 'location-diwali-2026' ELSE NULL END
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.location_membership_count', CASE WHEN (SELECT COUNT(*) FROM location_members) = (SELECT target_count FROM _0020_baseline_counts WHERE table_name = 'season_members')
AND (SELECT COUNT(*) FROM season_members) = (SELECT total_count FROM _0020_baseline_counts WHERE table_name = 'season_members') THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.exact_membership_copy', CASE WHEN NOT EXISTS (
  SELECT location_id, season_id, admin_user_id, role, disabled_at, created_at FROM location_members
  EXCEPT SELECT 'location-diwali-2026', season_id, admin_user_id, role, disabled_at, created_at
  FROM season_members WHERE season_id = 'season-2026'
) AND NOT EXISTS (
  SELECT 'location-diwali-2026', season_id, admin_user_id, role, disabled_at, created_at
  FROM season_members WHERE season_id = 'season-2026'
  EXCEPT SELECT location_id, season_id, admin_user_id, role, disabled_at, created_at FROM location_members
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.no_other_season_mapping', CASE WHEN NOT EXISTS (SELECT 1 FROM location_seasons WHERE season_id IS NOT 'season-2026')
AND NOT EXISTS (SELECT 1 FROM location_members WHERE season_id IS NOT 'season-2026') THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.rate_location.private_rates', CASE WHEN NOT EXISTS (
  SELECT 1 FROM private_rates r LEFT JOIN products p ON p.id = r.product_id
  WHERE p.id IS NULL OR r.location_id IS NOT p.location_id
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.rate_location.product_purchase_rates', CASE WHEN NOT EXISTS (
  SELECT 1 FROM product_purchase_rates r LEFT JOIN products p ON p.id = r.product_id
  WHERE p.id IS NULL OR r.location_id IS NOT p.location_id
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.quotation_request_scope', CASE WHEN NOT EXISTS (
  SELECT 1 FROM quotations q LEFT JOIN customer_requests r ON r.id = q.customer_request_id
  WHERE q.customer_request_id IS NOT NULL
    AND (r.id IS NULL OR q.location_id IS NOT r.location_id OR q.season_id IS NOT r.season_id)
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.product_category_location', CASE WHEN NOT EXISTS (
  SELECT 1 FROM products p JOIN categories c ON c.slug = p.category_slug
  WHERE p.location_id IS NOT c.location_id
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.pack_component_location', CASE WHEN NOT EXISTS (
  SELECT 1 FROM family_pack_items i JOIN family_packs f ON f.id = i.family_pack_id
  JOIN products p ON p.id = i.product_id WHERE f.location_id IS NOT p.location_id
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.request_line_location', CASE WHEN NOT EXISTS (
  SELECT 1 FROM customer_request_items i JOIN customer_requests r ON r.id = i.request_id
  LEFT JOIN products p ON p.id = i.product_id LEFT JOIN family_packs f ON f.id = i.family_pack_id
  WHERE (i.product_id IS NOT NULL AND r.location_id IS NOT p.location_id)
     OR (i.family_pack_id IS NOT NULL AND r.location_id IS NOT f.location_id)
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.quotation_line_location', CASE WHEN NOT EXISTS (
  SELECT 1 FROM quotation_items i JOIN quotations q ON q.id = i.quotation_id
  JOIN products p ON p.id = i.product_id WHERE q.location_id IS NOT p.location_id
) THEN 1 ELSE 0 END;

-- Presence and definition checks together preserve the original schema-object
-- validation. The snapshot contains no platform-owned objects.
INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_schema_objects', CASE WHEN NOT EXISTS (
  SELECT 1 FROM _0020_before_schema b LEFT JOIN sqlite_master a ON a.type = b.type AND a.name = b.name
  WHERE NOT (b.type = 'table' AND b.name IN ('categories', 'products', 'family_packs', 'private_rates', 'product_purchase_rates', 'customer_requests', 'quotations'))
    AND a.name IS NULL
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_schema_definitions', CASE WHEN NOT EXISTS (
  SELECT 1 FROM _0020_before_schema b JOIN sqlite_master a ON a.type = b.type AND a.name = b.name
  WHERE NOT (b.type = 'table' AND b.name IN ('categories', 'products', 'family_packs', 'private_rates', 'product_purchase_rates', 'customer_requests', 'quotations'))
    AND (a.tbl_name IS NOT b.tbl_name OR a.sql IS NOT b.sql)
) THEN 1 ELSE 0 END;

-- Original-column preservation is a symmetric multiset comparison.
-- Explicit storage-class tags distinguish INTEGER/REAL/TEXT/BLOB/NULL, and
-- BINARY collation detects case-only changes even in NOCASE source columns.
-- Group counts preserve duplicate rows. New location_id is NEVER compared
-- as an original column. The migration-history INSERT belongs to Wrangler
-- AFTER this file, so all original history/sequence values must still match here.

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.admin_login_attempts', CASE WHEN NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("email_normalized"), "email_normalized" COLLATE BINARY,
    typeof("ip_hash"), "ip_hash" COLLATE BINARY, typeof("attempted_at"), "attempted_at" COLLATE BINARY,
    typeof("success"), "success" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_admin_login_attempts"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("email_normalized"), "email_normalized" COLLATE BINARY,
    typeof("ip_hash"), "ip_hash" COLLATE BINARY, typeof("attempted_at"), "attempted_at" COLLATE BINARY,
    typeof("success"), "success" COLLATE BINARY, COUNT(*)
  FROM "admin_login_attempts"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
) AND NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("email_normalized"), "email_normalized" COLLATE BINARY,
    typeof("ip_hash"), "ip_hash" COLLATE BINARY, typeof("attempted_at"), "attempted_at" COLLATE BINARY,
    typeof("success"), "success" COLLATE BINARY, COUNT(*)
  FROM "admin_login_attempts"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("email_normalized"), "email_normalized" COLLATE BINARY,
    typeof("ip_hash"), "ip_hash" COLLATE BINARY, typeof("attempted_at"), "attempted_at" COLLATE BINARY,
    typeof("success"), "success" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_admin_login_attempts"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.admin_owner_bootstrap', CASE WHEN NOT EXISTS (
  SELECT typeof("singleton_id"), "singleton_id" COLLATE BINARY, typeof("owner_user_id"), "owner_user_id" COLLATE BINARY,
    typeof("bootstrapped_at"), "bootstrapped_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_admin_owner_bootstrap"
  GROUP BY 1, 2, 3, 4, 5, 6
  EXCEPT
  SELECT typeof("singleton_id"), "singleton_id" COLLATE BINARY, typeof("owner_user_id"), "owner_user_id" COLLATE BINARY,
    typeof("bootstrapped_at"), "bootstrapped_at" COLLATE BINARY, COUNT(*)
  FROM "admin_owner_bootstrap"
  GROUP BY 1, 2, 3, 4, 5, 6
) AND NOT EXISTS (
  SELECT typeof("singleton_id"), "singleton_id" COLLATE BINARY, typeof("owner_user_id"), "owner_user_id" COLLATE BINARY,
    typeof("bootstrapped_at"), "bootstrapped_at" COLLATE BINARY, COUNT(*)
  FROM "admin_owner_bootstrap"
  GROUP BY 1, 2, 3, 4, 5, 6
  EXCEPT
  SELECT typeof("singleton_id"), "singleton_id" COLLATE BINARY, typeof("owner_user_id"), "owner_user_id" COLLATE BINARY,
    typeof("bootstrapped_at"), "bootstrapped_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_admin_owner_bootstrap"
  GROUP BY 1, 2, 3, 4, 5, 6
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.admin_sessions', CASE WHEN NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("admin_user_id"), "admin_user_id" COLLATE BINARY,
    typeof("expires_at"), "expires_at" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("last_seen_at"), "last_seen_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_admin_sessions"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("admin_user_id"), "admin_user_id" COLLATE BINARY,
    typeof("expires_at"), "expires_at" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("last_seen_at"), "last_seen_at" COLLATE BINARY, COUNT(*)
  FROM "admin_sessions"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
) AND NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("admin_user_id"), "admin_user_id" COLLATE BINARY,
    typeof("expires_at"), "expires_at" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("last_seen_at"), "last_seen_at" COLLATE BINARY, COUNT(*)
  FROM "admin_sessions"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("admin_user_id"), "admin_user_id" COLLATE BINARY,
    typeof("expires_at"), "expires_at" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("last_seen_at"), "last_seen_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_admin_sessions"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.admin_users', CASE WHEN NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("email"), "email" COLLATE BINARY,
    typeof("display_name"), "display_name" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("role"), "role" COLLATE BINARY,
    typeof("password_hash"), "password_hash" COLLATE BINARY, typeof("disabled_at"), "disabled_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_admin_users"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("email"), "email" COLLATE BINARY,
    typeof("display_name"), "display_name" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("role"), "role" COLLATE BINARY,
    typeof("password_hash"), "password_hash" COLLATE BINARY, typeof("disabled_at"), "disabled_at" COLLATE BINARY, COUNT(*)
  FROM "admin_users"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
) AND NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("email"), "email" COLLATE BINARY,
    typeof("display_name"), "display_name" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("role"), "role" COLLATE BINARY,
    typeof("password_hash"), "password_hash" COLLATE BINARY, typeof("disabled_at"), "disabled_at" COLLATE BINARY, COUNT(*)
  FROM "admin_users"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("email"), "email" COLLATE BINARY,
    typeof("display_name"), "display_name" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("role"), "role" COLLATE BINARY,
    typeof("password_hash"), "password_hash" COLLATE BINARY, typeof("disabled_at"), "disabled_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_admin_users"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.business_seasons', CASE WHEN NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("code"), "code" COLLATE BINARY,
    typeof("label"), "label" COLLATE BINARY, typeof("status"), "status" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_business_seasons"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("code"), "code" COLLATE BINARY,
    typeof("label"), "label" COLLATE BINARY, typeof("status"), "status" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY, COUNT(*)
  FROM "business_seasons"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
) AND NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("code"), "code" COLLATE BINARY,
    typeof("label"), "label" COLLATE BINARY, typeof("status"), "status" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY, COUNT(*)
  FROM "business_seasons"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("code"), "code" COLLATE BINARY,
    typeof("label"), "label" COLLATE BINARY, typeof("status"), "status" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_business_seasons"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.categories', CASE WHEN NOT EXISTS (
  SELECT typeof("slug"), "slug" COLLATE BINARY, typeof("label"), "label" COLLATE BINARY,
    typeof("sort_order"), "sort_order" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_categories"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
  EXCEPT
  SELECT typeof("slug"), "slug" COLLATE BINARY, typeof("label"), "label" COLLATE BINARY,
    typeof("sort_order"), "sort_order" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "categories"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
) AND NOT EXISTS (
  SELECT typeof("slug"), "slug" COLLATE BINARY, typeof("label"), "label" COLLATE BINARY,
    typeof("sort_order"), "sort_order" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "categories"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
  EXCEPT
  SELECT typeof("slug"), "slug" COLLATE BINARY, typeof("label"), "label" COLLATE BINARY,
    typeof("sort_order"), "sort_order" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_categories"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.customer_request_items', CASE WHEN NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("request_id"), "request_id" COLLATE BINARY,
    typeof("line_number"), "line_number" COLLATE BINARY, typeof("product_id"), "product_id" COLLATE BINARY,
    typeof("product_name"), "product_name" COLLATE BINARY, typeof("quantity"), "quantity" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("family_pack_id"), "family_pack_id" COLLATE BINARY,
    typeof("unit_price_paise"), "unit_price_paise" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_customer_request_items"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("request_id"), "request_id" COLLATE BINARY,
    typeof("line_number"), "line_number" COLLATE BINARY, typeof("product_id"), "product_id" COLLATE BINARY,
    typeof("product_name"), "product_name" COLLATE BINARY, typeof("quantity"), "quantity" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("family_pack_id"), "family_pack_id" COLLATE BINARY,
    typeof("unit_price_paise"), "unit_price_paise" COLLATE BINARY, COUNT(*)
  FROM "customer_request_items"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
) AND NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("request_id"), "request_id" COLLATE BINARY,
    typeof("line_number"), "line_number" COLLATE BINARY, typeof("product_id"), "product_id" COLLATE BINARY,
    typeof("product_name"), "product_name" COLLATE BINARY, typeof("quantity"), "quantity" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("family_pack_id"), "family_pack_id" COLLATE BINARY,
    typeof("unit_price_paise"), "unit_price_paise" COLLATE BINARY, COUNT(*)
  FROM "customer_request_items"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("request_id"), "request_id" COLLATE BINARY,
    typeof("line_number"), "line_number" COLLATE BINARY, typeof("product_id"), "product_id" COLLATE BINARY,
    typeof("product_name"), "product_name" COLLATE BINARY, typeof("quantity"), "quantity" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("family_pack_id"), "family_pack_id" COLLATE BINARY,
    typeof("unit_price_paise"), "unit_price_paise" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_customer_request_items"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.customer_requests', CASE WHEN NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("status"), "status" COLLATE BINARY,
    typeof("customer_name"), "customer_name" COLLATE BINARY, typeof("customer_phone"), "customer_phone" COLLATE BINARY,
    typeof("customer_area"), "customer_area" COLLATE BINARY, typeof("pickup_preference"), "pickup_preference" COLLATE BINARY,
    typeof("customer_note"), "customer_note" COLLATE BINARY, typeof("source"), "source" COLLATE BINARY,
    typeof("raw_message"), "raw_message" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("public_reference"), "public_reference" COLLATE BINARY,
    typeof("delivery_address"), "delivery_address" COLLATE BINARY, typeof("delivery_landmark"), "delivery_landmark" COLLATE BINARY,
    typeof("delivery_maps_url"), "delivery_maps_url" COLLATE BINARY, typeof("finalization_status"), "finalization_status" COLLATE BINARY,
    typeof("assigned_to_email"), "assigned_to_email" COLLATE BINARY, typeof("assigned_by_email"), "assigned_by_email" COLLATE BINARY,
    typeof("assigned_at"), "assigned_at" COLLATE BINARY, typeof("closed_by_email"), "closed_by_email" COLLATE BINARY,
    typeof("closed_at"), "closed_at" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_customer_requests"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("status"), "status" COLLATE BINARY,
    typeof("customer_name"), "customer_name" COLLATE BINARY, typeof("customer_phone"), "customer_phone" COLLATE BINARY,
    typeof("customer_area"), "customer_area" COLLATE BINARY, typeof("pickup_preference"), "pickup_preference" COLLATE BINARY,
    typeof("customer_note"), "customer_note" COLLATE BINARY, typeof("source"), "source" COLLATE BINARY,
    typeof("raw_message"), "raw_message" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("public_reference"), "public_reference" COLLATE BINARY,
    typeof("delivery_address"), "delivery_address" COLLATE BINARY, typeof("delivery_landmark"), "delivery_landmark" COLLATE BINARY,
    typeof("delivery_maps_url"), "delivery_maps_url" COLLATE BINARY, typeof("finalization_status"), "finalization_status" COLLATE BINARY,
    typeof("assigned_to_email"), "assigned_to_email" COLLATE BINARY, typeof("assigned_by_email"), "assigned_by_email" COLLATE BINARY,
    typeof("assigned_at"), "assigned_at" COLLATE BINARY, typeof("closed_by_email"), "closed_by_email" COLLATE BINARY,
    typeof("closed_at"), "closed_at" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "customer_requests"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44
) AND NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("status"), "status" COLLATE BINARY,
    typeof("customer_name"), "customer_name" COLLATE BINARY, typeof("customer_phone"), "customer_phone" COLLATE BINARY,
    typeof("customer_area"), "customer_area" COLLATE BINARY, typeof("pickup_preference"), "pickup_preference" COLLATE BINARY,
    typeof("customer_note"), "customer_note" COLLATE BINARY, typeof("source"), "source" COLLATE BINARY,
    typeof("raw_message"), "raw_message" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("public_reference"), "public_reference" COLLATE BINARY,
    typeof("delivery_address"), "delivery_address" COLLATE BINARY, typeof("delivery_landmark"), "delivery_landmark" COLLATE BINARY,
    typeof("delivery_maps_url"), "delivery_maps_url" COLLATE BINARY, typeof("finalization_status"), "finalization_status" COLLATE BINARY,
    typeof("assigned_to_email"), "assigned_to_email" COLLATE BINARY, typeof("assigned_by_email"), "assigned_by_email" COLLATE BINARY,
    typeof("assigned_at"), "assigned_at" COLLATE BINARY, typeof("closed_by_email"), "closed_by_email" COLLATE BINARY,
    typeof("closed_at"), "closed_at" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "customer_requests"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("status"), "status" COLLATE BINARY,
    typeof("customer_name"), "customer_name" COLLATE BINARY, typeof("customer_phone"), "customer_phone" COLLATE BINARY,
    typeof("customer_area"), "customer_area" COLLATE BINARY, typeof("pickup_preference"), "pickup_preference" COLLATE BINARY,
    typeof("customer_note"), "customer_note" COLLATE BINARY, typeof("source"), "source" COLLATE BINARY,
    typeof("raw_message"), "raw_message" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("public_reference"), "public_reference" COLLATE BINARY,
    typeof("delivery_address"), "delivery_address" COLLATE BINARY, typeof("delivery_landmark"), "delivery_landmark" COLLATE BINARY,
    typeof("delivery_maps_url"), "delivery_maps_url" COLLATE BINARY, typeof("finalization_status"), "finalization_status" COLLATE BINARY,
    typeof("assigned_to_email"), "assigned_to_email" COLLATE BINARY, typeof("assigned_by_email"), "assigned_by_email" COLLATE BINARY,
    typeof("assigned_at"), "assigned_at" COLLATE BINARY, typeof("closed_by_email"), "closed_by_email" COLLATE BINARY,
    typeof("closed_at"), "closed_at" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_customer_requests"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.d1_migrations', CASE WHEN NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("name"), "name" COLLATE BINARY,
    typeof("applied_at"), "applied_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_d1_migrations"
  GROUP BY 1, 2, 3, 4, 5, 6
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("name"), "name" COLLATE BINARY,
    typeof("applied_at"), "applied_at" COLLATE BINARY, COUNT(*)
  FROM "d1_migrations"
  GROUP BY 1, 2, 3, 4, 5, 6
) AND NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("name"), "name" COLLATE BINARY,
    typeof("applied_at"), "applied_at" COLLATE BINARY, COUNT(*)
  FROM "d1_migrations"
  GROUP BY 1, 2, 3, 4, 5, 6
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("name"), "name" COLLATE BINARY,
    typeof("applied_at"), "applied_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_d1_migrations"
  GROUP BY 1, 2, 3, 4, 5, 6
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.family_pack_images', CASE WHEN NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("family_pack_id"), "family_pack_id" COLLATE BINARY,
    typeof("sort_order"), "sort_order" COLLATE BINARY, typeof("url"), "url" COLLATE BINARY,
    typeof("is_cover"), "is_cover" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_family_pack_images"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("family_pack_id"), "family_pack_id" COLLATE BINARY,
    typeof("sort_order"), "sort_order" COLLATE BINARY, typeof("url"), "url" COLLATE BINARY,
    typeof("is_cover"), "is_cover" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY, COUNT(*)
  FROM "family_pack_images"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
) AND NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("family_pack_id"), "family_pack_id" COLLATE BINARY,
    typeof("sort_order"), "sort_order" COLLATE BINARY, typeof("url"), "url" COLLATE BINARY,
    typeof("is_cover"), "is_cover" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY, COUNT(*)
  FROM "family_pack_images"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("family_pack_id"), "family_pack_id" COLLATE BINARY,
    typeof("sort_order"), "sort_order" COLLATE BINARY, typeof("url"), "url" COLLATE BINARY,
    typeof("is_cover"), "is_cover" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_family_pack_images"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.family_pack_items', CASE WHEN NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("family_pack_id"), "family_pack_id" COLLATE BINARY,
    typeof("product_id"), "product_id" COLLATE BINARY, typeof("quantity"), "quantity" COLLATE BINARY,
    typeof("unit_label"), "unit_label" COLLATE BINARY, typeof("sort_order"), "sort_order" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_family_pack_items"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("family_pack_id"), "family_pack_id" COLLATE BINARY,
    typeof("product_id"), "product_id" COLLATE BINARY, typeof("quantity"), "quantity" COLLATE BINARY,
    typeof("unit_label"), "unit_label" COLLATE BINARY, typeof("sort_order"), "sort_order" COLLATE BINARY, COUNT(*)
  FROM "family_pack_items"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
) AND NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("family_pack_id"), "family_pack_id" COLLATE BINARY,
    typeof("product_id"), "product_id" COLLATE BINARY, typeof("quantity"), "quantity" COLLATE BINARY,
    typeof("unit_label"), "unit_label" COLLATE BINARY, typeof("sort_order"), "sort_order" COLLATE BINARY, COUNT(*)
  FROM "family_pack_items"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("family_pack_id"), "family_pack_id" COLLATE BINARY,
    typeof("product_id"), "product_id" COLLATE BINARY, typeof("quantity"), "quantity" COLLATE BINARY,
    typeof("unit_label"), "unit_label" COLLATE BINARY, typeof("sort_order"), "sort_order" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_family_pack_items"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.family_packs', CASE WHEN NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("slug"), "slug" COLLATE BINARY,
    typeof("name"), "name" COLLATE BINARY, typeof("short_description"), "short_description" COLLATE BINARY,
    typeof("selling_price_paise"), "selling_price_paise" COLLATE BINARY, typeof("pack_label"), "pack_label" COLLATE BINARY,
    typeof("sort_order"), "sort_order" COLLATE BINARY, typeof("active"), "active" COLLATE BINARY,
    typeof("archived"), "archived" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_family_packs"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("slug"), "slug" COLLATE BINARY,
    typeof("name"), "name" COLLATE BINARY, typeof("short_description"), "short_description" COLLATE BINARY,
    typeof("selling_price_paise"), "selling_price_paise" COLLATE BINARY, typeof("pack_label"), "pack_label" COLLATE BINARY,
    typeof("sort_order"), "sort_order" COLLATE BINARY, typeof("active"), "active" COLLATE BINARY,
    typeof("archived"), "archived" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "family_packs"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24
) AND NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("slug"), "slug" COLLATE BINARY,
    typeof("name"), "name" COLLATE BINARY, typeof("short_description"), "short_description" COLLATE BINARY,
    typeof("selling_price_paise"), "selling_price_paise" COLLATE BINARY, typeof("pack_label"), "pack_label" COLLATE BINARY,
    typeof("sort_order"), "sort_order" COLLATE BINARY, typeof("active"), "active" COLLATE BINARY,
    typeof("archived"), "archived" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "family_packs"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("slug"), "slug" COLLATE BINARY,
    typeof("name"), "name" COLLATE BINARY, typeof("short_description"), "short_description" COLLATE BINARY,
    typeof("selling_price_paise"), "selling_price_paise" COLLATE BINARY, typeof("pack_label"), "pack_label" COLLATE BINARY,
    typeof("sort_order"), "sort_order" COLLATE BINARY, typeof("active"), "active" COLLATE BINARY,
    typeof("archived"), "archived" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_family_packs"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.platform_admins', CASE WHEN NOT EXISTS (
  SELECT typeof("admin_user_id"), "admin_user_id" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_platform_admins"
  GROUP BY 1, 2, 3, 4
  EXCEPT
  SELECT typeof("admin_user_id"), "admin_user_id" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY, COUNT(*)
  FROM "platform_admins"
  GROUP BY 1, 2, 3, 4
) AND NOT EXISTS (
  SELECT typeof("admin_user_id"), "admin_user_id" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY, COUNT(*)
  FROM "platform_admins"
  GROUP BY 1, 2, 3, 4
  EXCEPT
  SELECT typeof("admin_user_id"), "admin_user_id" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_platform_admins"
  GROUP BY 1, 2, 3, 4
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.platform_settings', CASE WHEN NOT EXISTS (
  SELECT typeof("singleton_id"), "singleton_id" COLLATE BINARY, typeof("public_catalogue_season_id"), "public_catalogue_season_id" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("updated_by_email"), "updated_by_email" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_platform_settings"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
  EXCEPT
  SELECT typeof("singleton_id"), "singleton_id" COLLATE BINARY, typeof("public_catalogue_season_id"), "public_catalogue_season_id" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("updated_by_email"), "updated_by_email" COLLATE BINARY, COUNT(*)
  FROM "platform_settings"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
) AND NOT EXISTS (
  SELECT typeof("singleton_id"), "singleton_id" COLLATE BINARY, typeof("public_catalogue_season_id"), "public_catalogue_season_id" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("updated_by_email"), "updated_by_email" COLLATE BINARY, COUNT(*)
  FROM "platform_settings"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
  EXCEPT
  SELECT typeof("singleton_id"), "singleton_id" COLLATE BINARY, typeof("public_catalogue_season_id"), "public_catalogue_season_id" COLLATE BINARY,
    typeof("updated_at"), "updated_at" COLLATE BINARY, typeof("updated_by_email"), "updated_by_email" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_platform_settings"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.private_rates', CASE WHEN NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("product_id"), "product_id" COLLATE BINARY,
    typeof("unit_rate_paise"), "unit_rate_paise" COLLATE BINARY, typeof("effective_from"), "effective_from" COLLATE BINARY,
    typeof("effective_to"), "effective_to" COLLATE BINARY, typeof("notes"), "notes" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY,
    typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_private_rates"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("product_id"), "product_id" COLLATE BINARY,
    typeof("unit_rate_paise"), "unit_rate_paise" COLLATE BINARY, typeof("effective_from"), "effective_from" COLLATE BINARY,
    typeof("effective_to"), "effective_to" COLLATE BINARY, typeof("notes"), "notes" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY,
    typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "private_rates"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
) AND NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("product_id"), "product_id" COLLATE BINARY,
    typeof("unit_rate_paise"), "unit_rate_paise" COLLATE BINARY, typeof("effective_from"), "effective_from" COLLATE BINARY,
    typeof("effective_to"), "effective_to" COLLATE BINARY, typeof("notes"), "notes" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY,
    typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "private_rates"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("product_id"), "product_id" COLLATE BINARY,
    typeof("unit_rate_paise"), "unit_rate_paise" COLLATE BINARY, typeof("effective_from"), "effective_from" COLLATE BINARY,
    typeof("effective_to"), "effective_to" COLLATE BINARY, typeof("notes"), "notes" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY,
    typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_private_rates"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.product_purchase_rates', CASE WHEN NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("product_id"), "product_id" COLLATE BINARY,
    typeof("unit_rate_paise"), "unit_rate_paise" COLLATE BINARY, typeof("effective_from"), "effective_from" COLLATE BINARY,
    typeof("effective_to"), "effective_to" COLLATE BINARY, typeof("notes"), "notes" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY,
    typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_product_purchase_rates"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("product_id"), "product_id" COLLATE BINARY,
    typeof("unit_rate_paise"), "unit_rate_paise" COLLATE BINARY, typeof("effective_from"), "effective_from" COLLATE BINARY,
    typeof("effective_to"), "effective_to" COLLATE BINARY, typeof("notes"), "notes" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY,
    typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "product_purchase_rates"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
) AND NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("product_id"), "product_id" COLLATE BINARY,
    typeof("unit_rate_paise"), "unit_rate_paise" COLLATE BINARY, typeof("effective_from"), "effective_from" COLLATE BINARY,
    typeof("effective_to"), "effective_to" COLLATE BINARY, typeof("notes"), "notes" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY,
    typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "product_purchase_rates"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("product_id"), "product_id" COLLATE BINARY,
    typeof("unit_rate_paise"), "unit_rate_paise" COLLATE BINARY, typeof("effective_from"), "effective_from" COLLATE BINARY,
    typeof("effective_to"), "effective_to" COLLATE BINARY, typeof("notes"), "notes" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY,
    typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_product_purchase_rates"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.products', CASE WHEN NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("category_slug"), "category_slug" COLLATE BINARY,
    typeof("name"), "name" COLLATE BINARY, typeof("pack"), "pack" COLLATE BINARY,
    typeof("description"), "description" COLLATE BINARY, typeof("featured"), "featured" COLLATE BINARY,
    typeof("stock_status"), "stock_status" COLLATE BINARY, typeof("active"), "active" COLLATE BINARY,
    typeof("sort_order"), "sort_order" COLLATE BINARY, typeof("images_json"), "images_json" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY,
    typeof("company"), "company" COLLATE BINARY, typeof("selling_price_paise"), "selling_price_paise" COLLATE BINARY,
    typeof("final_price_paise"), "final_price_paise" COLLATE BINARY, typeof("pieces_per_pack"), "pieces_per_pack" COLLATE BINARY,
    typeof("allow_loose_sale"), "allow_loose_sale" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_products"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("category_slug"), "category_slug" COLLATE BINARY,
    typeof("name"), "name" COLLATE BINARY, typeof("pack"), "pack" COLLATE BINARY,
    typeof("description"), "description" COLLATE BINARY, typeof("featured"), "featured" COLLATE BINARY,
    typeof("stock_status"), "stock_status" COLLATE BINARY, typeof("active"), "active" COLLATE BINARY,
    typeof("sort_order"), "sort_order" COLLATE BINARY, typeof("images_json"), "images_json" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY,
    typeof("company"), "company" COLLATE BINARY, typeof("selling_price_paise"), "selling_price_paise" COLLATE BINARY,
    typeof("final_price_paise"), "final_price_paise" COLLATE BINARY, typeof("pieces_per_pack"), "pieces_per_pack" COLLATE BINARY,
    typeof("allow_loose_sale"), "allow_loose_sale" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "products"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36
) AND NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("category_slug"), "category_slug" COLLATE BINARY,
    typeof("name"), "name" COLLATE BINARY, typeof("pack"), "pack" COLLATE BINARY,
    typeof("description"), "description" COLLATE BINARY, typeof("featured"), "featured" COLLATE BINARY,
    typeof("stock_status"), "stock_status" COLLATE BINARY, typeof("active"), "active" COLLATE BINARY,
    typeof("sort_order"), "sort_order" COLLATE BINARY, typeof("images_json"), "images_json" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY,
    typeof("company"), "company" COLLATE BINARY, typeof("selling_price_paise"), "selling_price_paise" COLLATE BINARY,
    typeof("final_price_paise"), "final_price_paise" COLLATE BINARY, typeof("pieces_per_pack"), "pieces_per_pack" COLLATE BINARY,
    typeof("allow_loose_sale"), "allow_loose_sale" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "products"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("category_slug"), "category_slug" COLLATE BINARY,
    typeof("name"), "name" COLLATE BINARY, typeof("pack"), "pack" COLLATE BINARY,
    typeof("description"), "description" COLLATE BINARY, typeof("featured"), "featured" COLLATE BINARY,
    typeof("stock_status"), "stock_status" COLLATE BINARY, typeof("active"), "active" COLLATE BINARY,
    typeof("sort_order"), "sort_order" COLLATE BINARY, typeof("images_json"), "images_json" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY,
    typeof("company"), "company" COLLATE BINARY, typeof("selling_price_paise"), "selling_price_paise" COLLATE BINARY,
    typeof("final_price_paise"), "final_price_paise" COLLATE BINARY, typeof("pieces_per_pack"), "pieces_per_pack" COLLATE BINARY,
    typeof("allow_loose_sale"), "allow_loose_sale" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_products"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.quotation_items', CASE WHEN NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("quotation_id"), "quotation_id" COLLATE BINARY,
    typeof("line_number"), "line_number" COLLATE BINARY, typeof("product_id"), "product_id" COLLATE BINARY,
    typeof("product_name"), "product_name" COLLATE BINARY, typeof("quantity"), "quantity" COLLATE BINARY,
    typeof("unit_rate_paise"), "unit_rate_paise" COLLATE BINARY, typeof("line_total_paise"), "line_total_paise" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_quotation_items"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("quotation_id"), "quotation_id" COLLATE BINARY,
    typeof("line_number"), "line_number" COLLATE BINARY, typeof("product_id"), "product_id" COLLATE BINARY,
    typeof("product_name"), "product_name" COLLATE BINARY, typeof("quantity"), "quantity" COLLATE BINARY,
    typeof("unit_rate_paise"), "unit_rate_paise" COLLATE BINARY, typeof("line_total_paise"), "line_total_paise" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, COUNT(*)
  FROM "quotation_items"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
) AND NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("quotation_id"), "quotation_id" COLLATE BINARY,
    typeof("line_number"), "line_number" COLLATE BINARY, typeof("product_id"), "product_id" COLLATE BINARY,
    typeof("product_name"), "product_name" COLLATE BINARY, typeof("quantity"), "quantity" COLLATE BINARY,
    typeof("unit_rate_paise"), "unit_rate_paise" COLLATE BINARY, typeof("line_total_paise"), "line_total_paise" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, COUNT(*)
  FROM "quotation_items"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("quotation_id"), "quotation_id" COLLATE BINARY,
    typeof("line_number"), "line_number" COLLATE BINARY, typeof("product_id"), "product_id" COLLATE BINARY,
    typeof("product_name"), "product_name" COLLATE BINARY, typeof("quantity"), "quantity" COLLATE BINARY,
    typeof("unit_rate_paise"), "unit_rate_paise" COLLATE BINARY, typeof("line_total_paise"), "line_total_paise" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_quotation_items"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.quotations', CASE WHEN NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("customer_request_id"), "customer_request_id" COLLATE BINARY,
    typeof("status"), "status" COLLATE BINARY, typeof("customer_name"), "customer_name" COLLATE BINARY,
    typeof("customer_phone"), "customer_phone" COLLATE BINARY, typeof("customer_note"), "customer_note" COLLATE BINARY,
    typeof("currency"), "currency" COLLATE BINARY, typeof("subtotal_paise"), "subtotal_paise" COLLATE BINARY,
    typeof("adjustment_paise"), "adjustment_paise" COLLATE BINARY, typeof("total_paise"), "total_paise" COLLATE BINARY,
    typeof("wa_message_text"), "wa_message_text" COLLATE BINARY, typeof("created_by_email"), "created_by_email" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY,
    typeof("pricing_mode"), "pricing_mode" COLLATE BINARY, typeof("selling_subtotal_paise"), "selling_subtotal_paise" COLLATE BINARY,
    typeof("final_subtotal_paise"), "final_subtotal_paise" COLLATE BINARY, typeof("bargain_floor_paise"), "bargain_floor_paise" COLLATE BINARY,
    typeof("accepted_amount_paise"), "accepted_amount_paise" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_quotations"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("customer_request_id"), "customer_request_id" COLLATE BINARY,
    typeof("status"), "status" COLLATE BINARY, typeof("customer_name"), "customer_name" COLLATE BINARY,
    typeof("customer_phone"), "customer_phone" COLLATE BINARY, typeof("customer_note"), "customer_note" COLLATE BINARY,
    typeof("currency"), "currency" COLLATE BINARY, typeof("subtotal_paise"), "subtotal_paise" COLLATE BINARY,
    typeof("adjustment_paise"), "adjustment_paise" COLLATE BINARY, typeof("total_paise"), "total_paise" COLLATE BINARY,
    typeof("wa_message_text"), "wa_message_text" COLLATE BINARY, typeof("created_by_email"), "created_by_email" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY,
    typeof("pricing_mode"), "pricing_mode" COLLATE BINARY, typeof("selling_subtotal_paise"), "selling_subtotal_paise" COLLATE BINARY,
    typeof("final_subtotal_paise"), "final_subtotal_paise" COLLATE BINARY, typeof("bargain_floor_paise"), "bargain_floor_paise" COLLATE BINARY,
    typeof("accepted_amount_paise"), "accepted_amount_paise" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "quotations"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40
) AND NOT EXISTS (
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("customer_request_id"), "customer_request_id" COLLATE BINARY,
    typeof("status"), "status" COLLATE BINARY, typeof("customer_name"), "customer_name" COLLATE BINARY,
    typeof("customer_phone"), "customer_phone" COLLATE BINARY, typeof("customer_note"), "customer_note" COLLATE BINARY,
    typeof("currency"), "currency" COLLATE BINARY, typeof("subtotal_paise"), "subtotal_paise" COLLATE BINARY,
    typeof("adjustment_paise"), "adjustment_paise" COLLATE BINARY, typeof("total_paise"), "total_paise" COLLATE BINARY,
    typeof("wa_message_text"), "wa_message_text" COLLATE BINARY, typeof("created_by_email"), "created_by_email" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY,
    typeof("pricing_mode"), "pricing_mode" COLLATE BINARY, typeof("selling_subtotal_paise"), "selling_subtotal_paise" COLLATE BINARY,
    typeof("final_subtotal_paise"), "final_subtotal_paise" COLLATE BINARY, typeof("bargain_floor_paise"), "bargain_floor_paise" COLLATE BINARY,
    typeof("accepted_amount_paise"), "accepted_amount_paise" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "quotations"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40
  EXCEPT
  SELECT typeof("id"), "id" COLLATE BINARY, typeof("customer_request_id"), "customer_request_id" COLLATE BINARY,
    typeof("status"), "status" COLLATE BINARY, typeof("customer_name"), "customer_name" COLLATE BINARY,
    typeof("customer_phone"), "customer_phone" COLLATE BINARY, typeof("customer_note"), "customer_note" COLLATE BINARY,
    typeof("currency"), "currency" COLLATE BINARY, typeof("subtotal_paise"), "subtotal_paise" COLLATE BINARY,
    typeof("adjustment_paise"), "adjustment_paise" COLLATE BINARY, typeof("total_paise"), "total_paise" COLLATE BINARY,
    typeof("wa_message_text"), "wa_message_text" COLLATE BINARY, typeof("created_by_email"), "created_by_email" COLLATE BINARY,
    typeof("created_at"), "created_at" COLLATE BINARY, typeof("updated_at"), "updated_at" COLLATE BINARY,
    typeof("pricing_mode"), "pricing_mode" COLLATE BINARY, typeof("selling_subtotal_paise"), "selling_subtotal_paise" COLLATE BINARY,
    typeof("final_subtotal_paise"), "final_subtotal_paise" COLLATE BINARY, typeof("bargain_floor_paise"), "bargain_floor_paise" COLLATE BINARY,
    typeof("accepted_amount_paise"), "accepted_amount_paise" COLLATE BINARY, typeof("season_id"), "season_id" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_quotations"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.season_members', CASE WHEN NOT EXISTS (
  SELECT typeof("season_id"), "season_id" COLLATE BINARY, typeof("admin_user_id"), "admin_user_id" COLLATE BINARY,
    typeof("role"), "role" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("disabled_at"), "disabled_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_season_members"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
  EXCEPT
  SELECT typeof("season_id"), "season_id" COLLATE BINARY, typeof("admin_user_id"), "admin_user_id" COLLATE BINARY,
    typeof("role"), "role" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("disabled_at"), "disabled_at" COLLATE BINARY, COUNT(*)
  FROM "season_members"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
) AND NOT EXISTS (
  SELECT typeof("season_id"), "season_id" COLLATE BINARY, typeof("admin_user_id"), "admin_user_id" COLLATE BINARY,
    typeof("role"), "role" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("disabled_at"), "disabled_at" COLLATE BINARY, COUNT(*)
  FROM "season_members"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
  EXCEPT
  SELECT typeof("season_id"), "season_id" COLLATE BINARY, typeof("admin_user_id"), "admin_user_id" COLLATE BINARY,
    typeof("role"), "role" COLLATE BINARY, typeof("created_at"), "created_at" COLLATE BINARY,
    typeof("disabled_at"), "disabled_at" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_season_members"
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.original_columns.sqlite_sequence', CASE WHEN NOT EXISTS (
  SELECT typeof("name"), "name" COLLATE BINARY, typeof("seq"), "seq" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_sqlite_sequence"
  GROUP BY 1, 2, 3, 4
  EXCEPT
  SELECT typeof("name"), "name" COLLATE BINARY, typeof("seq"), "seq" COLLATE BINARY, COUNT(*)
  FROM "sqlite_sequence"
  GROUP BY 1, 2, 3, 4
) AND NOT EXISTS (
  SELECT typeof("name"), "name" COLLATE BINARY, typeof("seq"), "seq" COLLATE BINARY, COUNT(*)
  FROM "sqlite_sequence"
  GROUP BY 1, 2, 3, 4
  EXCEPT
  SELECT typeof("name"), "name" COLLATE BINARY, typeof("seq"), "seq" COLLATE BINARY, COUNT(*)
  FROM "_0020_before_sqlite_sequence"
  GROUP BY 1, 2, 3, 4
) THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.foreign_keys_enabled', CASE WHEN (SELECT foreign_keys FROM pragma_foreign_keys) = 1 THEN 1 ELSE 0 END;

INSERT INTO _0020_assert (assertion, ok)
SELECT 'verify.no_foreign_key_violations', CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 1 ELSE 0 END;

-- No helper may survive a successful migration. No original table is dropped.
DROP TABLE "_0020_before_admin_login_attempts";
DROP TABLE "_0020_before_admin_owner_bootstrap";
DROP TABLE "_0020_before_admin_sessions";
DROP TABLE "_0020_before_admin_users";
DROP TABLE "_0020_before_business_seasons";
DROP TABLE "_0020_before_categories";
DROP TABLE "_0020_before_customer_request_items";
DROP TABLE "_0020_before_customer_requests";
DROP TABLE "_0020_before_d1_migrations";
DROP TABLE "_0020_before_family_pack_images";
DROP TABLE "_0020_before_family_pack_items";
DROP TABLE "_0020_before_family_packs";
DROP TABLE "_0020_before_platform_admins";
DROP TABLE "_0020_before_platform_settings";
DROP TABLE "_0020_before_private_rates";
DROP TABLE "_0020_before_product_purchase_rates";
DROP TABLE "_0020_before_products";
DROP TABLE "_0020_before_quotation_items";
DROP TABLE "_0020_before_quotations";
DROP TABLE "_0020_before_season_members";
DROP TABLE "_0020_before_sqlite_sequence";
DROP TABLE _0020_before_schema;
DROP TABLE _0020_baseline_counts;
DROP TABLE _0020_assert;

-- Wrangler appends its single 0020 history entry to this same migration batch.
-- Do not add a manual d1_migrations INSERT, explicit COMMIT, or SQL export here.
