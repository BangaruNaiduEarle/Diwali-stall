import {
  canAssignQuickBillCustomerRequests,
  canChangeSeasonMemberRoles,
  canGrantLocationMemberRole,
  canDeleteAdminProducts,
  canFinalizeQuickBillCustomerRequests,
  canManageSeasonUsers,
  canViewSensitiveProductPricing,
  strictParseAdminRole,
} from '../lib/adminRoles.js'

// One read snapshot binds both memberships to the same user and operating season.
// LEFT JOINs keep missing location/association records visible as denials.
export const ADMIN_LOCATION_CONTEXT_SQL = `
  SELECT lm.*, sm.admin_user_id AS season_user_id, sm.season_id AS member_season_id,
         sm.role AS season_role, sm.disabled_at AS season_disabled_at,
         s.id AS season_id, s.code AS season_code, s.label AS season_label,
         s.status AS season_status,
         lm.admin_user_id AS location_user_id, lm.location_id AS member_location_id,
         lm.season_id AS location_member_season_id, lm.role AS location_role,
         lm.disabled_at AS location_disabled_at,
         l.id AS location_id, l.business_id AS location_business_id,
         l.slug AS location_slug, l.name AS location_name, l.status AS location_status,
         b.id AS business_id, b.slug AS business_slug, b.name AS business_name,
         b.business_type, b.status AS business_status,
         ls.location_id AS association_location_id, ls.season_id AS association_season_id,
         ls.operating_year, ls.status AS association_status
  FROM season_members sm
  INNER JOIN business_seasons s ON s.id = sm.season_id
  LEFT JOIN location_members lm
    ON lm.admin_user_id = sm.admin_user_id AND lm.season_id = sm.season_id
  LEFT JOIN business_locations l ON l.id = lm.location_id
  LEFT JOIN businesses b ON b.id = l.business_id
  LEFT JOIN location_seasons ls
    ON ls.location_id = lm.location_id AND ls.season_id = lm.season_id
  WHERE sm.admin_user_id = ? AND sm.season_id = ?
  ORDER BY lm.location_id
`.trim()

const validStatus = (status) => status === 'active' || status === 'archived'
const enabled = (disabledAt) => disabledAt == null || disabledAt === ''
const forbidden = (message) => ({ ok: false, status: 403, code: 'forbidden', message })

function capabilities(seasonRole, locationRole, writable, finalRateGrant) {
  const both = (allows) => allows(seasonRole) && allows(locationRole)
  return {
    read: true,
    write: writable,
    viewSensitiveProductPricing: both(canViewSensitiveProductPricing),
    viewFinalRate: both(canViewSensitiveProductPricing) || finalRateGrant === 1,
    assignQuickBillCustomerRequests: writable && both(canAssignQuickBillCustomerRequests),
    finalizeQuickBillCustomerRequests: writable && both(canFinalizeQuickBillCustomerRequests),
    deleteAdminProducts: writable && both(canDeleteAdminProducts),
    manageSeasonUsers: writable && both(canManageSeasonUsers),
    changeSeasonMemberRoles: writable && both(canChangeSeasonMemberRoles),
    createSeasonMemberWithRole: Object.fromEntries(
      ['owner', 'super_admin', 'admin'].map((target) => [
        target,
        writable && both((role) => canGrantLocationMemberRole(role, target)),
      ]),
    ),
  }
}

/**
 * Read-only resolver; request middleware may attach its result for authorization.
 * The caller must supply an authenticated user ID and resolved operating season.
 * Request headers are selection hints, never grants. Business identity comes from D1.
 * No platform/global-role bypass. Database errors propagate; no legacy fallback.
 * Capabilities describe this location scope, not authority over other season locations.
 *
 * @param {D1Database} db
 * @param {{ userId: string, activeSeasonId: string, request?: Request,
 *           access?: 'read' | 'write' }} input
 */
export async function resolveAdminLocationContext(db, input) {
  const userId = String(input.userId ?? '').trim()
  const seasonId = String(input.activeSeasonId ?? '').trim()
  const access = input.access ?? 'read'
  if (!userId || !seasonId || !['read', 'write'].includes(access)) {
    return forbidden('Authenticated user and active operating season are required.')
  }

  const header = input.request?.headers.get('X-Admin-Location-Id') ?? null
  const explicit = header !== null
  const selectedId = header?.trim()
  if (explicit && !selectedId) return forbidden('Explicit location selection is empty.')

  const result = await db.prepare(ADMIN_LOCATION_CONTEXT_SQL).bind(userId, seasonId).all()
  const rows = result.results ?? []
  const first = rows[0]
  if (!first || rows.some((row) =>
    row.season_user_id !== userId || row.member_season_id !== seasonId ||
    row.season_id !== seasonId || !enabled(row.season_disabled_at) ||
    !strictParseAdminRole(row.season_role) || !validStatus(row.season_status) ||
    row.season_role !== first.season_role || row.season_status !== first.season_status
  )) {
    return forbidden('Enabled season membership is required.')
  }

  const locations = rows.filter((row) => row.member_location_id != null)
  let matches
  if (explicit) {
    matches = locations.filter((row) => row.member_location_id === selectedId)
  } else {
    // Never auto-select 2099 or another season, even if it has a single membership.
    // Count all memberships before validation; disabled/invalid alternatives must
    // not cause a silent substitution of the historical Diwali location.
    if (seasonId !== 'season-2026' || locations.length !== 1) {
      return forbidden('An explicit, unambiguous location selection is required.')
    }
    matches = locations.filter((row) =>
      row.member_location_id === 'location-diwali-2026' &&
      row.business_id === 'business-diwali' && row.operating_year === 2026
    )
  }
  if (matches.length !== 1) {
    return forbidden('Selected location membership is missing or ambiguous.')
  }

  const row = matches[0]
  const locationRole = strictParseAdminRole(row.location_role)
  if (!locationRole || !enabled(row.location_disabled_at) ||
      row.location_user_id !== userId || row.location_member_season_id !== seasonId ||
      row.location_id !== row.member_location_id || !row.business_id ||
      row.location_business_id !== row.business_id ||
      row.association_location_id !== row.location_id || row.association_season_id !== seasonId ||
      !Number.isInteger(row.operating_year) || row.operating_year < 1 || row.operating_year > 9999 ||
      !['permanent', 'seasonal'].includes(row.business_type) ||
      ![row.business_status, row.location_status, row.association_status].every(validStatus)) {
    return forbidden('Enabled location membership and matching business/location/season association are required.')
  }

  const writable = [row.business_status, row.location_status, row.season_status, row.association_status]
    .every((status) => status === 'active')
  if (access === 'write' && !writable) {
    return forbidden('Archived business, location, season or association cannot be modified.')
  }

  const seasonRole = strictParseAdminRole(row.season_role)
  return {
    ok: true,
    userId,
    activeSeasonId: seasonId,
    businessId: row.business_id,
    activeLocationId: row.location_id,
    selection: explicit ? 'explicit' : 'legacy-2026',
    business: {
      id: row.business_id, slug: row.business_slug, name: row.business_name,
      type: row.business_type, status: row.business_status,
    },
    location: {
      id: row.location_id, businessId: row.business_id, slug: row.location_slug,
      name: row.location_name, status: row.location_status,
    },
    operatingSeason: {
      id: seasonId, code: row.season_code, label: row.season_label, status: row.season_status,
    },
    association: {
      locationId: row.location_id, seasonId, operatingYear: row.operating_year,
      status: row.association_status,
    },
    seasonMembership: { userId, seasonId, role: seasonRole, disabledAt: row.season_disabled_at ?? null },
    locationMembership: {
      userId, seasonId, locationId: row.location_id, role: locationRole,
      disabledAt: row.location_disabled_at ?? null,
    },
    // lm.* keeps pre-0027 reads compatible; an absent grant always denies Admin access.
    capabilities: capabilities(seasonRole, locationRole, writable, row.can_view_final_rate),
  }
}
