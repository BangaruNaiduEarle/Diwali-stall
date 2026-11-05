import { adminOperationScope } from '../lib/adminOperationScope.js'
import { resolveSeasonScopedAuthorizationFromContext } from '../lib/adminSeasonAuthorization.js'
import { canManageSeasonUsers } from '../lib/adminRoles.js'
import { isValidCustomerRequestId } from '../lib/adminCustomerRequestValidation.js'

// Existing absolute exclusions remain in force; this is not a cleanup allowlist.
const protectedIds = new Set(['cr-737b1d5a26c757f6588763e787854700', '77ece069-78e3-4fab-8a4d-ad118845dd47'])

export function validateCustomerRequestBulkDelete(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'requestIds') ||
      !Array.isArray(body.requestIds) || body.requestIds.length < 1 || body.requestIds.length > 100 ||
      body.requestIds.some(id => typeof id !== 'string' || !isValidCustomerRequestId(id) || id !== id.trim()) ||
      new Set(body.requestIds).size !== body.requestIds.length) {
    return { ok: false, errors: { requestIds: 'Provide 1–100 unique, valid request IDs.' } }
  }
  return { ok: true, ids: body.requestIds }
}

function actorGuard(scope, userId, context) {
  const sql = `EXISTS (SELECT 1 FROM season_members sm JOIN admin_users au ON au.id=sm.admin_user_id
    JOIN business_seasons bs ON bs.id=sm.season_id
    WHERE sm.season_id=? AND sm.admin_user_id=? AND sm.role IN ('owner','super_admin')
      AND (sm.disabled_at IS NULL OR sm.disabled_at='') AND (au.disabled_at IS NULL OR au.disabled_at='') AND bs.status='active'`
  if (!scope.locationId) return { sql: sql + ' AND sm.role=?)', values: [scope.seasonId, userId, context.seasonRole] }
  return { sql: sql + ` AND EXISTS (SELECT 1 FROM location_members lm
    JOIN location_seasons ls ON ls.location_id=lm.location_id AND ls.season_id=lm.season_id
    JOIN business_locations l ON l.id=ls.location_id JOIN businesses b ON b.id=l.business_id
    WHERE lm.admin_user_id=sm.admin_user_id AND lm.season_id=sm.season_id AND lm.location_id=?
      AND lm.role IN ('owner','super_admin') AND (lm.disabled_at IS NULL OR lm.disabled_at='')
      AND ls.status='active' AND l.status='active' AND b.status='active' AND b.id=?
      AND sm.role=? AND lm.role=?))`,
  values: [scope.seasonId, userId, scope.locationId, scope.businessId, context.locationContext.seasonMembership.role, context.locationContext.locationMembership.role] }
}

// Archival uses the existing append-only event stream, not a billing status or
// customer-data field. Billing/detail/report/payment queries retain the parent.
// Both revision advancement and the marker roll back if either assertion fails.
const assertion = predicate => `SELECT json(CASE WHEN (${predicate}) THEN 'true' ELSE 'bulk_delete_assertion_failed' END) AS verified`

export async function bulkDeleteAdminCustomerRequests(db, ids, { seasonId, context }) {
  const auth = resolveSeasonScopedAuthorizationFromContext(context)
  if (!auth.ok || auth.activeSeasonId !== seasonId || !canManageSeasonUsers(auth.seasonRole)) {
    throw Object.assign(new Error('Owner or Super Admin access is required.'), { status: 403, code: 'forbidden' })
  }
  const scope = adminOperationScope(db, seasonId, context, true)
  const actor = actorGuard(scope, auth.userId, context)
  const scoped = 'r.id=? AND r.season_id=?' + (scope.locationId ? ' AND r.location_id=? AND EXISTS (SELECT 1 FROM business_locations l WHERE l.id=r.location_id AND l.business_id=?)' : '')
  const archivedIds = [], failed = []
  for (const id of ids) {
    if (protectedIds.has(id)) { failed.push({ id, code: 'protected_request', message: 'This request is protected and cannot be removed.' }); continue }
    const binds = [id, seasonId, ...(scope.locationId ? [scope.locationId, scope.businessId] : [])]
    try {
      const row = await db.prepare(`SELECT r.revision,
        EXISTS (SELECT 1 FROM request_workflow_events e WHERE e.request_id=r.id AND e.event_type='request_archived') AS archived
        FROM customer_requests r WHERE ${scoped}`).bind(...binds).first()
      if (!row) { failed.push({ id, code: 'not_found', message: 'Request not found in the selected scope.' }); continue }
      if (row.archived) { archivedIds.push(id); continue }
      await db.batch([
        db.prepare(`UPDATE customer_requests SET revision=revision+1 WHERE id=? AND season_id=? AND revision=?
          ${scope.locationId ? 'AND location_id=? AND EXISTS (SELECT 1 FROM business_locations l WHERE l.id=customer_requests.location_id AND l.business_id=?)' : ''}
          AND NOT EXISTS (SELECT 1 FROM request_workflow_events e WHERE e.request_id=customer_requests.id AND e.event_type='request_archived')
          AND ${actor.sql}`)
          .bind(id, seasonId, row.revision, ...(scope.locationId ? [scope.locationId, scope.businessId] : []), ...actor.values),
        db.prepare(assertion('changes()=1')),
        db.prepare(`INSERT INTO request_workflow_events(event_id,request_id,business_id,location_id,season_id,
          actor_user_id,actor_name,actor_role,device_id,event_type,occurred_at,revision,metadata_json)
          SELECT 'event-'||lower(hex(randomblob(16))),r.id,(SELECT business_id FROM business_locations WHERE id=r.location_id),r.location_id,r.season_id,
            ?,(SELECT display_name FROM admin_users WHERE id=?),?,?,'request_archived',strftime('%Y-%m-%dT%H:%M:%fZ','now'),r.revision,'{"archived":true}'
          FROM customer_requests r WHERE ${scoped} AND r.revision=?`)
          .bind(auth.userId, auth.userId, auth.seasonRole, context.workflowTransport?.deviceId ?? null, ...binds, row.revision+1),
        db.prepare(assertion(`changes()=1 AND EXISTS (SELECT 1 FROM request_workflow_events e
          JOIN customer_requests r ON r.id=e.request_id WHERE e.request_id=? AND e.event_type='request_archived' AND e.revision=? AND r.revision=e.revision)`))
          .bind(id, row.revision+1),
      ])
      archivedIds.push(id)
    } catch {
      failed.push({ id, code: 'archive_failed', message: 'Removal could not be confirmed. Refresh before retrying; billing records remain retained.' })
    }
  }
  // Keep the existing endpoint/result compatible: deletedIds means removed from
  // the active list. No request, quotation, item or financial row is deleted.
  return { deletedIds: archivedIds, archivedIds, failed, deletedCount: archivedIds.length, archivedCount: archivedIds.length, failedCount: failed.length }
}
