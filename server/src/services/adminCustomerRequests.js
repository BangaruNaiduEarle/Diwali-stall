import {
  buildOwnerCustomerRequestListAuditSummary,
  resolveOwnerListRequestAuditAmounts,
} from '../lib/adminCustomerRequestListAudit.js'
import { buildRequestInternalPricingView } from '../lib/adminInternalPricingPreview.js'
import { canViewSensitiveProductPricing } from '../lib/adminRoles.js'
import { getActiveQuotationForRequest } from './adminQuotations.js'
import { validateCustomerRequestStatusTransition } from '../lib/adminCustomerRequestValidation.js'
import {
  getAdminUserByEmail,
  getAdminUserById,
  isAdminUserActive,
} from './adminUserStore.js'
import {
  bargainFinalizeBlockedForActiveQuotation,
  dbRowBlocksFinalizeMissingAgreedAmount,
  finalizeBlockedForMissingSavedAgreedAmount,
} from '../../../src/lib/quotationBargainMode.js'

/**
 * Admin customer request queue — never reads private_rates or monetary fields.
 */

/** Audited in tests: list/detail must not reference private_rates. */
export const ADMIN_LIST_CUSTOMER_REQUESTS_SQL = `
  SELECT
    r.id,
    r.public_reference,
    r.status,
    r.source,
    r.customer_name,
    r.customer_phone,
    r.customer_area,
    r.finalization_status,
    r.assigned_to_email,
    r.assigned_by_email,
    r.assigned_at,
    r.closed_by_email,
    r.closed_at,
    r.created_at,
    (
      SELECT COUNT(*)
      FROM customer_request_items i
      WHERE i.request_id = r.id
    ) AS item_count
  FROM customer_requests r
`.trim()

export const ADMIN_GET_CUSTOMER_REQUEST_SQL = `
  SELECT
    id,
    public_reference,
    status,
    source,
    customer_name,
    customer_phone,
    customer_area,
    pickup_preference,
    customer_note,
    delivery_address,
    delivery_landmark,
    delivery_maps_url,
    finalization_status,
    assigned_to_email,
    assigned_by_email,
    assigned_at,
    closed_by_email,
    closed_at,
    created_at,
    updated_at
  FROM customer_requests
  WHERE id = ?
`.trim()

const ADMIN_GET_CUSTOMER_REQUEST_QUEUE_SQL = `
  SELECT id, source, finalization_status, assigned_to_email, status
  FROM customer_requests
  WHERE id = ?
`.trim()

export const ADMIN_LIST_CUSTOMER_REQUEST_ITEMS_SQL = `
  SELECT line_number, product_id, family_pack_id, product_name, quantity, unit_price_paise
  FROM customer_request_items
  WHERE request_id = ?
  ORDER BY line_number ASC
`.trim()

export const ADMIN_UPDATE_CUSTOMER_REQUEST_STATUS_SQL = `
  UPDATE customer_requests
  SET status = ?, updated_at = datetime('now')
  WHERE id = ?
`.trim()

/**
 * Phone match key. Must stay aligned with CUSTOMER_PHONE_SEARCH_SQL:
 * spaces, hyphens, parentheses, and plus signs are ignored.
 * @param {unknown} value
 */
export function normalizeCustomerRequestPhoneSearch(value) {
  return String(value ?? '').replace(/[\s()+-]/g, '')
}

/** @param {string} value */
export function escapeSqlLikeFragment(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/** Stored phones normalized the same way as normalizeCustomerRequestPhoneSearch. */
const CUSTOMER_PHONE_SEARCH_SQL =
  "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(r.customer_phone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '')"

/**
 * @param {{ status?: string, q?: string, finalizationStatus?: string, assignedToEmail?: string }} opts
 * @returns {{ whereSql: string, binds: unknown[] }}
 */
export function buildAdminCustomerRequestListFilter(opts) {
  /** @type {string[]} */
  const wheres = []
  /** @type {unknown[]} */
  const binds = []

  if (opts.status) {
    wheres.push('r.status = ?')
    binds.push(opts.status)
  }

  if (opts.finalizationStatus) {
    wheres.push('r.finalization_status = ?')
    binds.push(opts.finalizationStatus)
  }

  const assigneeEmail = String(opts.assignedToEmail ?? '').trim().toLowerCase()
  if (assigneeEmail) {
    wheres.push('lower(r.assigned_to_email) = ?')
    binds.push(assigneeEmail)
  }

  const q = String(opts.q ?? '').trim()
  if (q) {
    /** @type {string[]} */
    const match = [`r.customer_name LIKE ? ESCAPE '\\'`]
    binds.push(`%${escapeSqlLikeFragment(q)}%`)
    const phoneNeedle = normalizeCustomerRequestPhoneSearch(q)
    if (phoneNeedle) {
      match.push(`${CUSTOMER_PHONE_SEARCH_SQL} LIKE ? ESCAPE '\\'`)
      binds.push(`%${escapeSqlLikeFragment(phoneNeedle)}%`)
    }
    wheres.push(`(${match.join(' OR ')})`)
  }

  return {
    whereSql: wheres.length ? `WHERE ${wheres.join(' AND ')}` : '',
    binds,
  }
}

/** @param {Record<string, unknown>} row */
export function mapCustomerRequestWorkflowAuditFromRow(row) {
  return {
    assignedToEmail: row.assigned_to_email != null ? String(row.assigned_to_email) : null,
    assignedByEmail: row.assigned_by_email != null ? String(row.assigned_by_email) : null,
    assignedAt: row.assigned_at != null ? String(row.assigned_at) : null,
    closedByEmail: row.closed_by_email != null ? String(row.closed_by_email) : null,
    closedAt: row.closed_at != null ? String(row.closed_at) : null,
  }
}

/** @param {Record<string, unknown>} row */
export function mapAdminCustomerRequestListRow(row) {
  const publicReferenceRaw = row.public_reference
  return {
    id: row.id,
    publicReference:
      publicReferenceRaw != null && String(publicReferenceRaw).trim()
        ? String(publicReferenceRaw).trim()
        : null,
    status: row.status,
    source: row.source,
    customerName: row.customer_name ?? null,
    customerPhone: row.customer_phone ?? null,
    customerArea: row.customer_area ?? null,
    finalizationStatus: row.finalization_status != null ? String(row.finalization_status) : null,
    ...mapCustomerRequestWorkflowAuditFromRow(row),
    createdAt: row.created_at,
    itemCount: Number(row.item_count ?? 0),
  }
}

/** @param {Record<string, unknown>} row @param {Record<string, unknown>[]} items */
export function mapAdminCustomerRequestDetail(row, items) {
  const publicReferenceRaw = row.public_reference
  return {
    id: row.id,
    publicReference:
      publicReferenceRaw != null && String(publicReferenceRaw).trim()
        ? String(publicReferenceRaw).trim()
        : null,
    status: row.status,
    source: row.source,
    customerName: row.customer_name ?? null,
    customerPhone: row.customer_phone ?? null,
    customerArea: row.customer_area ?? null,
    pickupPreference: row.pickup_preference ?? null,
    customerNote: row.customer_note ?? null,
    deliveryAddress: row.delivery_address ?? null,
    deliveryLandmark: row.delivery_landmark ?? null,
    deliveryMapsUrl: row.delivery_maps_url ?? null,
    finalizationStatus: row.finalization_status != null ? String(row.finalization_status) : null,
    ...mapCustomerRequestWorkflowAuditFromRow(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map(mapAdminCustomerRequestItemRow),
  }
}

/** @param {Record<string, unknown>} row */
export function mapAdminCustomerRequestItemRow(row) {
  const familyPackId = row.family_pack_id ? String(row.family_pack_id) : null
  const productId = row.product_id ? String(row.product_id) : null
  return {
    lineNumber: row.line_number,
    lineType: familyPackId ? 'family_pack' : 'product',
    productId,
    familyPackId,
    productName: row.product_name,
    quantity: row.quantity,
    unitPricePaise: row.unit_price_paise != null ? Number(row.unit_price_paise) : null,
  }
}

/**
 * @param {D1Database} db
 * @param {{
 *   limit: number,
 *   offset: number,
 *   status?: string,
 *   q?: string,
 *   finalizationStatus?: string,
 *   assignedToEmail?: string,
 * }} opts
 */
export async function listAdminCustomerRequests(db, opts) {
  const limit = opts.limit
  const offset = opts.offset
  const { whereSql, binds } = buildAdminCustomerRequestListFilter(opts)
  const listSql = `${ADMIN_LIST_CUSTOMER_REQUESTS_SQL} ${whereSql} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`
  const countSql = `SELECT COUNT(*) AS total FROM customer_requests r ${whereSql}`

  const listResult = await db.prepare(listSql).bind(...binds, limit, offset).all()
  const countRow = await db.prepare(countSql).bind(...binds).first()

  const total = Number(countRow?.total ?? 0)
  const requests = (listResult.results ?? []).map(mapAdminCustomerRequestListRow)
  return { requests, total }
}

/**
 * Owner/Super Admin list audit (Selling subtotal, agreed amount, optional below-Final warning).
 *
 * @param {D1Database} db
 * @param {Record<string, unknown>[]} requests
 * @param {unknown} role
 */
export async function enrichAdminCustomerRequestListForRole(db, requests, role) {
  if (!canViewSensitiveProductPricing(role)) return requests

  return Promise.all(
    requests.map(async (req) => {
      const requestId = String(req.id ?? '')
      if (!requestId) return req

      const quotation = await getActiveQuotationForRequest(db, requestId)
      if (!quotation) return req

      let internalPricingView = null
      if (quotation.sellingSubtotalPaise == null || quotation.finalSubtotalPaise == null) {
        const itemsResult = await db
          .prepare(ADMIN_LIST_CUSTOMER_REQUEST_ITEMS_SQL)
          .bind(requestId)
          .all()
        const items = (itemsResult.results ?? []).map(mapAdminCustomerRequestItemRow)
        internalPricingView = await buildRequestInternalPricingView(db, items)
      }

      const amounts = resolveOwnerListRequestAuditAmounts(quotation, internalPricingView)

      const auditSummary = buildOwnerCustomerRequestListAuditSummary({
        sellingSubtotalPaise: amounts.sellingSubtotalPaise,
        acceptedAmountPaise: amounts.acceptedAmountPaise,
        finalSubtotalPaise: amounts.finalSubtotalPaise,
        finalSubtotalIsSaved: amounts.finalSubtotalIsSaved,
      })

      if (!auditSummary) return req
      return { ...req, auditSummary }
    }),
  )
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 */
export async function getAdminCustomerRequestById(db, requestId) {
  const row = await db.prepare(ADMIN_GET_CUSTOMER_REQUEST_SQL).bind(requestId).first()
  if (!row) return null
  const itemsResult = await db
    .prepare(ADMIN_LIST_CUSTOMER_REQUEST_ITEMS_SQL)
    .bind(requestId)
    .all()
  const items = itemsResult.results ?? []
  return mapAdminCustomerRequestDetail(row, items)
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 * @param {string} nextStatus
 */
/**
 * @param {D1Database} db
 * @param {string} requestId
 * @param {string} nextStatus
 * @param {{ actorEmail?: string | null }} [opts]
 */
export async function updateAdminCustomerRequestStatus(db, requestId, nextStatus, opts = {}) {
  const existing = await db
    .prepare('SELECT id, status FROM customer_requests WHERE id = ?')
    .bind(requestId)
    .first()
  if (!existing) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }

  const currentStatus = String(existing.status)
  const transition = validateCustomerRequestStatusTransition(currentStatus, nextStatus)
  if (!transition.ok) {
    return {
      ok: false,
      status: 400,
      code: transition.code,
      message: transition.message,
      fields: { status: transition.message },
    }
  }

  const actorEmail = String(opts.actorEmail ?? '').trim().toLowerCase()
  const recordClosure = nextStatus === 'closed' && currentStatus !== 'closed' && actorEmail.length > 0

  const run = recordClosure
    ? await db
        .prepare(
          `UPDATE customer_requests
           SET status = ?, updated_at = datetime('now'),
               closed_by_email = ?, closed_at = datetime('now')
           WHERE id = ?`,
        )
        .bind(nextStatus, actorEmail, requestId)
        .run()
    : await db.prepare(ADMIN_UPDATE_CUSTOMER_REQUEST_STATUS_SQL).bind(nextStatus, requestId).run()

  if (!run.meta?.changes) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }

  const request = await getAdminCustomerRequestById(db, requestId)
  return { ok: true, request }
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 */
export async function markCustomerRequestPendingFinalization(db, requestId) {
  await db
    .prepare(
      `UPDATE customer_requests
       SET finalization_status = 'pending', updated_at = datetime('now')
       WHERE id = ? AND source = 'manual'`,
    )
    .bind(requestId)
    .run()
}

/** @param {Record<string, unknown>} row */
function isPendingFinalization(row) {
  const fs = row.finalization_status == null ? null : String(row.finalization_status)
  return fs === 'pending'
}

/** @param {Record<string, unknown>} row */
function isManualQuickBillPendingFinalization(row) {
  return String(row.source ?? '') === 'manual' && isPendingFinalization(row)
}

/** @param {Record<string, unknown>} row */
function isPublicWebRequestEligibleForCustomerAgreement(row) {
  if (String(row.source ?? '') !== 'web') return false
  if (row.finalization_status != null && String(row.finalization_status).trim() !== '') {
    return false
  }
  const status = String(row.status ?? '')
  return status !== 'void' && status !== 'closed'
}

/**
 * @param {D1Database} db
 * @param {{ assigneeUserId?: string, assigneeEmail?: string }} assigneeRef
 */
async function resolveQuickBillAssignee(db, assigneeRef) {
  const user = assigneeRef.assigneeUserId
    ? await getAdminUserById(db, assigneeRef.assigneeUserId)
    : await getAdminUserByEmail(db, assigneeRef.assigneeEmail ?? '')
  if (!user || !isAdminUserActive(user)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_assignee',
      message: 'Assignee must be an active admin user.',
      fields: { assigneeUserId: 'User not found or disabled.' },
    }
  }
  if (!canViewSensitiveProductPricing(user.role)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_assignee',
      message: 'Assignee must be an Owner or Super Admin.',
      fields: { assigneeUserId: 'Only Owner or Super Admin can be assigned.' },
    }
  }
  return { ok: true, email: user.email }
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 * @param {{ assigneeUserId?: string, assigneeEmail?: string }} assigneeRef
 * @param {{ assignedByEmail?: string | null }} [opts]
 */
export async function assignAdminCustomerRequest(db, requestId, assigneeRef, opts = {}) {
  const row = await db.prepare(ADMIN_GET_CUSTOMER_REQUEST_QUEUE_SQL).bind(requestId).first()
  if (!row) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }
  if (!isManualQuickBillPendingFinalization(row)) {
    return {
      ok: false,
      status: 400,
      code: 'not_assignable',
      message: 'Only pending manual stall bills can be assigned.',
      fields: { requestId: 'Request is not a pending manual bill.' },
    }
  }

  const assignee = await resolveQuickBillAssignee(db, assigneeRef)
  if (!assignee.ok) return assignee

  const assignedByEmail = String(opts.assignedByEmail ?? '').trim().toLowerCase()
  if (!assignedByEmail) {
    return {
      ok: false,
      status: 400,
      code: 'missing_actor',
      message: 'Assigning admin identity is required.',
    }
  }

  const run = await db
    .prepare(
      `UPDATE customer_requests
       SET assigned_to_email = ?, assigned_by_email = ?, assigned_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ? AND source = 'manual' AND finalization_status = 'pending'`,
    )
    .bind(assignee.email, assignedByEmail, requestId)
    .run()

  if (!run.meta?.changes) {
    return {
      ok: false,
      status: 409,
      code: 'assign_failed',
      message: 'Could not assign request. It may no longer be pending.',
    }
  }

  const request = await getAdminCustomerRequestById(db, requestId)
  return { ok: true, request }
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 */
/**
 * Owner/Super Admin — customer agreed on a public web quotation request.
 * @param {D1Database} db
 * @param {string} requestId
 */
export async function recordPublicCustomerAgreementPendingFinalization(db, requestId) {
  const row = await db.prepare(ADMIN_GET_CUSTOMER_REQUEST_QUEUE_SQL).bind(requestId).first()
  if (!row) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }
  if (!isPublicWebRequestEligibleForCustomerAgreement(row)) {
    return {
      ok: false,
      status: 400,
      code: 'not_eligible',
      message: 'Only open public web requests without finalization can be marked as customer agreed.',
      fields: { requestId: 'Request is not eligible for customer agreement.' },
    }
  }

  const run = await db
    .prepare(
      `UPDATE customer_requests
       SET finalization_status = 'pending', updated_at = datetime('now')
       WHERE id = ? AND source = 'web' AND finalization_status IS NULL`,
    )
    .bind(requestId)
    .run()

  if (!run.meta?.changes) {
    return {
      ok: false,
      status: 409,
      code: 'agreement_failed',
      message: 'Could not record customer agreement. The request may have changed.',
    }
  }

  const request = await getAdminCustomerRequestById(db, requestId)
  return { ok: true, request }
}

/** @param {Parameters<typeof finalizeBlockedForMissingSavedAgreedAmount>[0]} quotation */
export function isFinalizeBlockedMissingAgreedAmount(quotation) {
  return finalizeBlockedForMissingSavedAgreedAmount(quotation)
}

/** @param {Parameters<typeof bargainFinalizeBlockedForActiveQuotation>[0]} quotation */
export function isBargainFinalizeBlockedMissingAgreedAmount(quotation) {
  return bargainFinalizeBlockedForActiveQuotation(quotation)
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 * @param {{ actorEmail?: string | null }} [opts]
 */
export async function finalizeAdminCustomerRequest(db, requestId, opts = {}) {
  const row = await db
    .prepare(
      `SELECT id, source, finalization_status, assigned_to_email, status
       FROM customer_requests WHERE id = ?`,
    )
    .bind(requestId)
    .first()
  if (!row) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }

  const finalizationStatus = row.finalization_status == null ? null : String(row.finalization_status)
  if (finalizationStatus === 'finalized') {
    const request = await getAdminCustomerRequestById(db, requestId)
    return { ok: true, request, alreadyFinalized: true }
  }

  if (!isPendingFinalization(row)) {
    return {
      ok: false,
      status: 400,
      code: 'not_finalizable',
      message: 'Only requests pending finalization can be finalized.',
      fields: { requestId: 'Request is not pending finalization.' },
    }
  }

  const currentStatus = String(row.status ?? '')
  if (currentStatus === 'void') {
    return {
      ok: false,
      status: 400,
      code: 'not_finalizable',
      message: 'Void requests cannot be finalized.',
      fields: { requestId: 'Request is void.' },
    }
  }

  const transition = validateCustomerRequestStatusTransition(currentStatus, 'closed')
  if (!transition.ok) {
    return {
      ok: false,
      status: 400,
      code: transition.code,
      message: transition.message,
      fields: { requestId: transition.message },
    }
  }

  const actorEmail = String(opts.actorEmail ?? '').trim().toLowerCase()
  if (!actorEmail) {
    return {
      ok: false,
      status: 400,
      code: 'missing_actor',
      message: 'Finalizing admin identity is required.',
    }
  }

  const activeQuotationAuditRow = await db
    .prepare(
      `SELECT pricing_mode, accepted_amount_paise, bargain_floor_paise
       FROM quotations
       WHERE customer_request_id = ? AND status != 'void'
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(requestId)
    .first()
  if (dbRowBlocksFinalizeMissingAgreedAmount(activeQuotationAuditRow)) {
    return {
      ok: false,
      status: 400,
      code: 'agreed_amount_required',
      message:
        'Record the customer-agreed amount before finalizing. Finalize cannot close the request without a saved positive amount.',
    }
  }

  const run = await db
    .prepare(
      `UPDATE customer_requests
       SET finalization_status = 'finalized',
           status = 'closed',
           closed_by_email = ?,
           closed_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ? AND finalization_status = 'pending'`,
    )
    .bind(actorEmail, requestId)
    .run()

  if (!run.meta?.changes) {
    const after = await db
      .prepare(`SELECT finalization_status FROM customer_requests WHERE id = ?`)
      .bind(requestId)
      .first()
    if (after && String(after.finalization_status) === 'finalized') {
      const request = await getAdminCustomerRequestById(db, requestId)
      return { ok: true, request, alreadyFinalized: true }
    }
    return {
      ok: false,
      status: 409,
      code: 'finalize_failed',
      message: 'Could not finalize request. It may already be finalized.',
    }
  }

  const request = await getAdminCustomerRequestById(db, requestId)
  return { ok: true, request }
}
