import { siteConfig } from '../../../src/data/siteConfig.js'
import { adminOperationScope } from '../lib/adminOperationScope.js'
import { canViewSensitiveProductPricing } from '../lib/adminRoles.js'
import { validateStallSettingsUpdate } from '../lib/stallSettingsValidation.js'

const fail = (status, code, message) => { throw Object.assign(Error(message), { status, code }) }
const AUTH_FROM = `FROM admin_users u
  JOIN season_members sm ON sm.admin_user_id = u.id
  JOIN business_seasons s ON s.id = sm.season_id
  JOIN location_members lm ON lm.admin_user_id = u.id AND lm.season_id = s.id
  JOIN business_locations l ON l.id = lm.location_id
  JOIN businesses b ON b.id = l.business_id
  JOIN location_seasons ls ON ls.location_id = l.id AND ls.season_id = s.id
  WHERE b.id = ? AND l.id = ? AND s.id = ? AND u.id = ?
    AND (u.disabled_at IS NULL OR u.disabled_at = '')
    AND (sm.disabled_at IS NULL OR sm.disabled_at = '') AND (lm.disabled_at IS NULL OR lm.disabled_at = '')
    AND sm.role IN ('admin','super_admin','owner') AND lm.role IN ('admin','super_admin','owner')
    AND b.status IN ('active','archived') AND l.status IN ('active','archived')
    AND s.status IN ('active','archived') AND ls.status IN ('active','archived')`
const WRITE = ` AND sm.role IN ('owner','super_admin') AND lm.role IN ('owner','super_admin')
  AND b.status = 'active' AND l.status = 'active' AND s.status = 'active' AND ls.status = 'active'`
const ROLE = "CASE WHEN sm.role = 'admin' OR lm.role = 'admin' THEN 'admin' WHEN sm.role = 'super_admin' OR lm.role = 'super_admin' THEN 'super_admin' ELSE 'owner' END"
const args = scope => [scope.businessId, scope.locationId, scope.seasonId, scope.userId]
const profileColumns = { brandName:'brand_name', whatsappNumber:'whatsapp_number', phone:'phone', locationName:'location_name',
  locationDetailLines:'location_detail_lines_json', locationMapUrl:'location_map_url' }
const canonicalColumns = { stallName:'name', stallLabel:'stall_label', locationAddress:'address' }
const seasonColumns = { stallDates:'stall_dates_json', stallTimings:'stall_timings' }
const encoded = (key, value) => ['locationDetailLines','stallDates'].includes(key) ? JSON.stringify(value) : value
const different = (a,b) => JSON.stringify(a) !== JSON.stringify(b)

function operationScope(db, options, write = false) {
  const scope = adminOperationScope(db, options.seasonId, options.context, write)
  if (!scope.locationId) fail(503,'location_required','Stall settings require the authorized location-mode foundation.')
  if (write && !canViewSensitiveProductPricing(scope.effectiveRole)) fail(403,'forbidden','Only Owner or Super Admin can update stall settings.')
  return scope
}
async function load(db, scope) {
  const live = await db.prepare(`SELECT l.name,l.address,l.stall_label,b.name AS business_name,
    ${ROLE} AS effective_role,
    (b.status = 'active' AND l.status = 'active' AND s.status = 'active' AND ls.status = 'active') AS writable ${AUTH_FROM}`).bind(...args(scope)).first()
  if (!live) fail(403,'forbidden','Current stall and season membership is required.')
  const rows = await db.batch([
    db.prepare('SELECT * FROM location_settings WHERE location_id = ?').bind(scope.locationId),
    db.prepare('SELECT * FROM location_season_settings WHERE location_id = ? AND season_id = ?').bind(scope.locationId,scope.seasonId),
  ])
  const profile = rows[0].results?.[0], season = rows[1].results?.[0]
  const legacyProfile = scope.businessId === 'business-diwali' && scope.locationId === 'location-diwali-2026'
  const legacySeason = legacyProfile && scope.seasonId === 'season-2026'
  const defaults = legacyProfile ? siteConfig : { brandName: live.business_name, whatsappNumber:'',phone:'',locationName:live.name,locationDetailLines:[],locationMapUrl:'' }
  const result = {
    scope:{businessId:scope.businessId,locationId:scope.locationId,seasonId:scope.seasonId},
    profile: { stallName:live.name, stallLabel:live.stall_label ?? '', locationAddress:live.address ?? (legacyProfile ? siteConfig.locationAddress : '') },
    season: { stallDates:season?.stall_dates_json == null ? legacySeason ? [...siteConfig.stallDates] : [] : JSON.parse(season.stall_dates_json),
      stallTimings:season?.stall_timings ?? (legacySeason ? siteConfig.stallTimings : '') },
    revisions: {profile:profile?.revision ?? 0,season:season?.revision ?? 0},
    permissions:{canUpdate:Boolean(live.writable) && canViewSensitiveProductPricing(live.effective_role)},
    sources:{profile:profile?.revision ? 'saved' : legacyProfile ? 'legacy_defaults' : 'location_defaults',season:season?.revision ? 'saved' : legacySeason ? 'legacy_defaults' : 'empty_defaults'},
  }
  for (const [key,column] of Object.entries(profileColumns)) result.profile[key] = profile?.[column] == null ? Array.isArray(defaults[key]) ? [...defaults[key]] : defaults[key] : key === 'locationDetailLines' ? JSON.parse(profile[column]) : profile[column]
  // A read-only Admin sees only public display values/revisions, never management actor metadata.
  if (canViewSensitiveProductPricing(live.effective_role)) result.updated = {
    profile:{at:profile?.updated_at ?? null,byUserId:profile?.updated_by_user_id ?? null},
    season:{at:season?.updated_at ?? null,byUserId:season?.updated_by_user_id ?? null},
  }
  return result
}
export async function getStallSettings(db, options) {
  return load(db, operationScope(db,options))
}
export async function updateStallSettings(db, body, options) {
  const scope = operationScope(db, options, true)
  const validated = validateStallSettingsUpdate(body)
  if (!validated.ok) fail(validated.status,validated.code,validated.message)
  const input = validated.data, current = await load(db,scope)
  if (!current.permissions.canUpdate) fail(403,'forbidden','Only current Owner or Super Admin in an active context can update settings.')
  for (const section of ['profile','season']) if (input[section] && input[section === 'profile' ? 'expectedProfileRevision' : 'expectedSeasonRevision'] !== current.revisions[section]) fail(409,'revision_conflict','Settings changed. Reload before saving.')
  const changes = {}, next = {profile:{...current.profile},season:{...current.season}}
  for (const section of ['profile','season']) for (const [key,value] of Object.entries(input[section] ?? {})) {
    if (different(current[section][key],value)) {
      changes[section] ??= {}; changes[section][key] = {before:current[section][key],after:value}; next[section][key] = value
    }
  }
  if (!Object.keys(changes).length) return {...current,changed:false}
  const profileChanged = Boolean(changes.profile), seasonChanged = Boolean(changes.season)
  const batch = [
    db.prepare('INSERT INTO location_settings(location_id) VALUES(?) ON CONFLICT DO NOTHING').bind(scope.locationId),
    db.prepare('INSERT INTO location_season_settings(location_id,season_id) VALUES(?,?) ON CONFLICT DO NOTHING').bind(scope.locationId,scope.seasonId),
  ]
  const revisions = [], revisionArgs = []
  for (const section of ['profile','season']) if (input[section]) {
    revisions.push(section === 'profile' ? '(SELECT revision FROM location_settings WHERE location_id = ?) = ?' : '(SELECT revision FROM location_season_settings WHERE location_id = ? AND season_id = ?) = ?')
    revisionArgs.push(scope.locationId,...(section === 'season' ? [scope.seasonId] : []),current.revisions[section])
  }
  // NOT NULL assertions make a stale revision or revoked authority abort the
  // entire batch, including lazy row initialization and its audit event.
  batch.push(db.prepare(`INSERT INTO location_settings_events(event_id,business_id,location_id,season_id,actor_user_id,actor_role,profile_revision,season_revision,changes_json)
    VALUES(?,?,?,?,CASE WHEN EXISTS(SELECT 1 ${AUTH_FROM}${WRITE}) THEN ? END,
      (SELECT ${ROLE} ${AUTH_FROM}${WRITE}),?,?,CASE WHEN ${revisions.join(' AND ')} THEN ? END)`)
    .bind(crypto.randomUUID(),scope.businessId,scope.locationId,scope.seasonId,...args(scope),scope.userId,...args(scope),
      current.revisions.profile + Number(profileChanged),current.revisions.season + Number(seasonChanged),...revisionArgs,JSON.stringify(changes)))
  if (profileChanged) {
    const selected = Object.keys(changes.profile).filter(key => profileColumns[key])
    batch.push(db.prepare(`UPDATE location_settings SET revision = revision + 1,updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_by_user_id = ?${selected.map(key => ','+profileColumns[key]+' = ?').join('')} WHERE location_id = ?`)
      .bind(scope.userId,...selected.map(key => encoded(key,next.profile[key])),scope.locationId))
    const canonical = Object.keys(changes.profile).filter(key => canonicalColumns[key])
    if (canonical.length) batch.push(db.prepare(`UPDATE business_locations SET ${canonical.map(key => canonicalColumns[key]+' = ?').join(',')},updated_at = datetime('now') WHERE id = ? AND business_id = ?`)
      .bind(...canonical.map(key => next.profile[key]),scope.locationId,scope.businessId))
  }
  if (seasonChanged) {
    const selected = Object.keys(changes.season)
    batch.push(db.prepare(`UPDATE location_season_settings SET revision = revision + 1,updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_by_user_id = ?,${selected.map(key => seasonColumns[key]+' = ?').join(',')} WHERE location_id = ? AND season_id = ?`)
      .bind(scope.userId,...selected.map(key => encoded(key,next.season[key])),scope.locationId,scope.seasonId))
  }
  try { await db.batch(batch) }
  catch (error) {
    if (String(error.message).includes('NOT NULL constraint failed: location_settings_events.actor')) fail(403,'forbidden','Settings authority changed before commit.')
    if (String(error.message).includes('NOT NULL constraint failed: location_settings_events.changes_json')) fail(409,'revision_conflict','Settings changed before commit. Reload before saving.')
    throw error
  }
  return {...await load(db,scope),changed:true}
}
