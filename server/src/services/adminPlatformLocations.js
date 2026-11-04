import { randomBytesHex } from '../lib/passwordHash.js'

const failure = (status, code, message) => ({ ok: false, status, code, message })
const conflict = () => failure(409, 'provisioning_conflict', 'Provisioning requirements changed or this location already exists; no location was created.')

// This predicate is repeated inside the atomic batch, not trusted from a request snapshot.
const ELIGIBLE_BUSINESS_SQL = `SELECT b.id FROM businesses b
  JOIN business_seasons s ON s.id = 'season-2026' AND s.status = 'active' AND s.code = '2026'
  JOIN admin_users target ON target.id = ? AND (target.disabled_at IS NULL OR target.disabled_at = '')
  WHERE b.id = ? AND b.business_type = 'seasonal' AND b.status = 'active'
    AND EXISTS (SELECT 1 FROM platform_admins pa JOIN admin_users actor ON actor.id = pa.admin_user_id
      WHERE pa.admin_user_id = ? AND (actor.disabled_at IS NULL OR actor.disabled_at = ''))
    AND NOT EXISTS (SELECT 1 FROM season_members sm WHERE sm.season_id = s.id AND sm.admin_user_id = target.id
      AND (sm.role != 'owner' OR (sm.disabled_at IS NOT NULL AND sm.disabled_at != '')))`

/** Release-only provisioning. Reuses a business and identity; never updates either. */
export async function provisionPlatformSeasonalLocation(db, actorUserId, input) {
  const allowed = ['businessId', 'seasonId', 'operatingYear', 'ownerUserId', 'slug', 'name', 'address', 'stallLabel']
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))) {
    return failure(400, 'validation_error', 'Only seasonal location provisioning fields are accepted.')
  }
  if (input.seasonId !== 'season-2026' || input.operatingYear !== 2026) {
    return failure(400, 'validation_error', 'Only season-2026 and operatingYear 2026 are supported.')
  }
  const values = {}
  for (const [key, max, optional] of [['businessId', 128], ['ownerUserId', 128], ['slug', 64], ['name', 200], ['address', 1000, true], ['stallLabel', 100, true]]) {
    const value = input[key]
    if ((value == null && optional) || (typeof value === 'string' && value.trim().length <= max && (optional || value.trim()))) {
      values[key] = value == null ? null : value.trim() || null
    } else return failure(400, 'validation_error', `Invalid ${key}.`)
  }
  values.slug = values.slug.toLowerCase()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug)) return failure(400, 'validation_error', 'Slug must contain letters, digits and single hyphens.')

  const actor = await db.prepare(`SELECT pa.admin_user_id FROM platform_admins pa
    JOIN admin_users actor ON actor.id = pa.admin_user_id
    WHERE pa.admin_user_id = ? AND (actor.disabled_at IS NULL OR actor.disabled_at = '')`).bind(actorUserId).first()
  if (!actor) return failure(403, 'forbidden', 'Enabled Platform Admin access required.')
  const guardValues = [values.ownerUserId, values.businessId, actorUserId]
  if (!await db.prepare(ELIGIBLE_BUSINESS_SQL).bind(...guardValues).first()) return conflict()

  // No caller-supplied location ID or update/upsert path: every physical site gets a fresh identity.
  const locationId = `location-${randomBytesHex(16)}`
  const guardedLocation = `SELECT l.id FROM business_locations l WHERE l.id = ?
    AND l.business_id = (${ELIGIBLE_BUSINESS_SQL}) AND l.status = 'active'`
  const statements = [
    db.prepare(`INSERT INTO business_locations (id, business_id, slug, name, address, stall_label)
      VALUES (?, (${ELIGIBLE_BUSINESS_SQL}), ?, ?, ?, ?)`)
      .bind(locationId, ...guardValues, values.slug, values.name, values.address, values.stallLabel),
    db.prepare(`INSERT INTO location_seasons (location_id, season_id, operating_year)
      VALUES ((${guardedLocation}), 'season-2026', 2026)`)
      .bind(locationId, ...guardValues),
    db.prepare(`INSERT INTO season_members (season_id, admin_user_id, role, disabled_at)
      SELECT 'season-2026', ?, 'owner', NULL WHERE EXISTS (${guardedLocation})
      AND NOT EXISTS (SELECT 1 FROM season_members WHERE season_id = 'season-2026' AND admin_user_id = ?)`)
      .bind(values.ownerUserId, locationId, ...guardValues, values.ownerUserId),
    // A scalar subquery returning NULL violates location_members.location_id NOT NULL.
    // This makes any failed write-time guard abort and roll back the ENTIRE D1 batch.
    db.prepare(`INSERT INTO location_members (location_id, season_id, admin_user_id, role, disabled_at)
      VALUES ((SELECT ls.location_id FROM location_seasons ls WHERE ls.location_id = (${guardedLocation})
        AND ls.season_id = 'season-2026' AND ls.operating_year = 2026 AND ls.status = 'active'
        AND EXISTS (SELECT 1 FROM season_members sm WHERE sm.season_id = ls.season_id AND sm.admin_user_id = ?
          AND sm.role = 'owner' AND (sm.disabled_at IS NULL OR sm.disabled_at = ''))), 'season-2026', ?, 'owner', NULL)`)
      .bind(locationId, ...guardValues, values.ownerUserId, values.ownerUserId),
  ]
  try {
    await db.batch(statements)
  } catch (error) {
    if (/constraint|SQLITE_CONSTRAINT|identity already exists/i.test(String(error?.message ?? error))) return conflict()
    return failure(503, 'provisioning_unavailable', 'Location provisioning is unavailable.')
  }
  return { ok: true, location: { id: locationId, businessId: values.businessId, slug: values.slug, name: values.name,
    address: values.address, stallLabel: values.stallLabel, status: 'active' },
  association: { locationId, seasonId: 'season-2026', operatingYear: 2026, status: 'active' },
  owner: { userId: values.ownerUserId, seasonRole: 'owner', locationRole: 'owner' } }
}
