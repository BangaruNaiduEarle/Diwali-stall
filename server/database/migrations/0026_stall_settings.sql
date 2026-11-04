-- Independent stall settings. Prepare only; apply to authorized disposable
-- fixtures/targets separately. No existing table or settings row is rewritten.
CREATE TABLE location_settings (
  location_id TEXT PRIMARY KEY NOT NULL REFERENCES business_locations(id) ON DELETE RESTRICT,
  brand_name TEXT,
  whatsapp_number TEXT,
  phone TEXT,
  location_name TEXT,
  location_detail_lines_json TEXT CHECK(location_detail_lines_json IS NULL OR (json_valid(location_detail_lines_json) AND json_type(location_detail_lines_json) = 'array')),
  location_map_url TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision) = 'integer' AND revision >= 0),
  updated_at TEXT,
  updated_by_user_id TEXT REFERENCES admin_users(id) ON DELETE RESTRICT
);
CREATE TABLE location_season_settings (
  location_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  stall_dates_json TEXT CHECK(stall_dates_json IS NULL OR (json_valid(stall_dates_json) AND json_type(stall_dates_json) = 'array')),
  stall_timings TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision) = 'integer' AND revision >= 0),
  updated_at TEXT,
  updated_by_user_id TEXT REFERENCES admin_users(id) ON DELETE RESTRICT,
  PRIMARY KEY(location_id,season_id),
  FOREIGN KEY(location_id,season_id) REFERENCES location_seasons(location_id,season_id) ON DELETE RESTRICT
);
CREATE TABLE location_settings_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  location_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  actor_role TEXT NOT NULL CHECK(actor_role IN ('owner','super_admin')),
  profile_revision INTEGER NOT NULL CHECK(profile_revision >= 0),
  season_revision INTEGER NOT NULL CHECK(season_revision >= 0),
  changes_json TEXT NOT NULL CHECK(json_valid(changes_json)),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY(location_id,season_id) REFERENCES location_seasons(location_id,season_id) ON DELETE RESTRICT
);
CREATE INDEX idx_location_settings_events_scope ON location_settings_events(location_id,season_id,received_at,event_id);
CREATE TRIGGER location_settings_events_no_update BEFORE UPDATE ON location_settings_events
BEGIN SELECT RAISE(ABORT,'settings_events_immutable'); END;
CREATE TRIGGER location_settings_events_no_delete BEFORE DELETE ON location_settings_events
BEGIN SELECT RAISE(ABORT,'settings_events_immutable'); END;
CREATE TRIGGER location_settings_events_scope BEFORE INSERT ON location_settings_events
WHEN EXISTS(SELECT 1 FROM location_settings_events WHERE event_id = NEW.event_id)
  OR NOT EXISTS(SELECT 1 FROM business_locations WHERE id = NEW.location_id AND business_id = NEW.business_id)
BEGIN SELECT RAISE(ABORT,'settings_event_scope_or_duplicate'); END;
