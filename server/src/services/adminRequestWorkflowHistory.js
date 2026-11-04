import { customerRequestDb } from '../lib/adminCustomerRequestScope.js'
import { canViewSensitiveProductPricing } from '../lib/adminRoles.js'
import { presentWorkflowEvent } from '../lib/requestWorkflowAudit.js'
import { getAdminCustomerRequestById } from './adminCustomerRequests.js'
import { adminOperationScope } from '../lib/adminOperationScope.js'

export async function getRequestWorkflowHistory(db, requestId, { seasonId, context, afterRevision = 0, limit = 50 }) {
  db = customerRequestDb(db, seasonId, context)
  const scope = adminOperationScope(db, seasonId, context)
  const permissionRole = scope.locationId ? scope.effectiveRole : context?.seasonRole
  const request = await getAdminCustomerRequestById(db, requestId, seasonId)
  if (!request) return { ok: false, status: 404, code: 'not_found', message: 'Request not found.' }
  const result = await db.prepare(`SELECT * FROM request_workflow_events WHERE request_id = ? AND revision > ?
    ORDER BY revision ASC LIMIT ?`).bind(requestId, afterRevision, limit).all()
  return { ok: true, revision: request.revision,
    events: (result.results ?? []).map(row => presentWorkflowEvent(row, canViewSensitiveProductPricing(permissionRole))) }
}
