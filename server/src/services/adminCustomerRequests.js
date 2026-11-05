import {
  buildOwnerCustomerRequestListAuditSummary,
  resolveOwnerListRequestAuditAmounts,
} from '../lib/adminCustomerRequestListAudit.js'
import { hasOfflineFinalization } from '../lib/offlineFinalizationAuthority.js'
import {
  canFinalizeQuickBillCustomerRequests,
  canViewSensitiveProductPricing,
  strictParseAdminRole,
} from '../lib/adminRoles.js'
import { getActiveQuotationForRequest } from './adminQuotations.js'
import { customerRequestDb, customerRequestScope } from '../lib/adminCustomerRequestScope.js'
import { activeQuotationSnapshot } from '../lib/adminTransactionIntegrity.js'
import { validateRequestPaymentPreferences } from '../../../src/shared/requestPaymentPreferences.js'
import { parseAdminCustomerRequestVisibilityCutoff, validateCustomerRequestStatusTransition } from '../lib/adminCustomerRequestValidation.js'
import {
  getAdminUserByEmail,
  getAdminUserById,
  isAdminUserActive,
} from './adminUserStore.js'
import {
  activeQuotationAuditRowFromApi,
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
    r.finalization_status,
    r.assigned_to_email,
    r.assigned_by_email,
    r.assigned_at,
    r.closed_by_email,
    r.closed_at,
    r.created_at,
    r.season_id,
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
    payment_preference_status, payment_preference_mode, payment_preference_received_paise,
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
    revision, creator_user_id, creator_name, creator_role,
    assigned_to_user_id, assigned_to_name, assigned_to_role,
    assigned_by_user_id, assigned_by_name, assigned_by_role,
    created_at,
    updated_at,
    season_id
  FROM customer_requests
  WHERE id = ?
`.trim()

const ADMIN_GET_CUSTOMER_REQUEST_QUEUE_SQL = `
  SELECT id, source, finalization_status, assigned_to_email, status
  FROM customer_requests
  WHERE id = ?
`.trim()

const ADMIN_GET_CUSTOMER_REQUEST_QUEUE_WITH_SEASON_SQL = `
  SELECT id, source, finalization_status, assigned_to_email, assigned_to_user_id, assigned_by_email, status
  FROM customer_requests
  WHERE id = ? AND season_id = ?
`.trim()

export const ADMIN_LIST_CUSTOMER_REQUEST_ITEMS_SQL = `
  SELECT line_id, unit_type, pack_snapshot, product_details_json, line_number, product_id, family_pack_id, product_name, quantity, unit_price_paise
  FROM customer_request_items
  WHERE request_id = ?
  ORDER BY line_number ASC
`.trim()

export const ADMIN_UPDATE_CUSTOMER_REQUEST_STATUS_SQL = `
  UPDATE customer_requests
  SET status = ?, updated_at = datetime('now')
  WHERE id = ? AND season_id = ?
`.trim()

/** @param {unknown} seasonId */
function requireCustomerRequestSeasonId(seasonId) {
  const season = String(seasonId ?? '').trim()
  if (!season) {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Active business season is required for customer request updates.',
    }
  }
  return { ok: true, season }
}

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
 * @param {{ status?: string, q?: string, finalizationStatus?: string, assignedToEmail?: string, visibilityCutoff?: string }} opts
 * @returns {{ whereSql: string, binds: unknown[] }}
 */
export function buildAdminCustomerRequestListFilter(opts) {
  /** @type {string[]} */
  const wheres = []
  wheres.push("NOT EXISTS (SELECT 1 FROM request_workflow_events archived WHERE archived.request_id = r.id AND archived.event_type = 'request_archived')")
  /** @type {unknown[]} */
  const binds = []

  const seasonId = String(opts.seasonId ?? '').trim()
  if (seasonId) {
    wheres.push('r.season_id = ?')
    binds.push(seasonId)
  }

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
    const match = [`r.public_reference LIKE ? ESCAPE '\\'`, `r.customer_name LIKE ? ESCAPE '\\'`]
    const textPattern = `%${escapeSqlLikeFragment(q)}%`
    binds.push(textPattern, textPattern)
    const phoneNeedle = normalizeCustomerRequestPhoneSearch(q)
    if (phoneNeedle) {
      match.push(`${CUSTOMER_PHONE_SEARCH_SQL} LIKE ? ESCAPE '\\'`)
      binds.push(`%${escapeSqlLikeFragment(phoneNeedle)}%`)
    }
    wheres.push(`(${match.join(' OR ')})`)
  }

  if (opts.visibilityCutoff !== undefined) {
    const cutoff = parseAdminCustomerRequestVisibilityCutoff(opts.visibilityCutoff)
    if (!cutoff) throw new Error('A valid customer request visibility cutoff is required.')
    // This exception bypasses only the date restriction, never scope/search/status.
    // julianday accepts both SQLite UTC timestamps and ISO UTC timestamps.
    wheres.push("(r.id IN ('cr-737b1d5a26c757f6588763e787854700', '77ece069-78e3-4fab-8a4d-ad118845dd47') OR julianday(r.created_at) >= julianday(?))")
    binds.push(cutoff)
  }

  return {
    whereSql: wheres.length ? `WHERE ${wheres.join(' AND ')}` : '',
    binds,
  }
}

/** @param {Record<string, unknown>} row */
export function mapCustomerRequestWorkflowAuditFromRow(row) {
  return {
    revision: Number(row.revision ?? 0),
    creatorUserId: row.creator_user_id ?? null, creatorName: row.creator_name ?? null, creatorRole: row.creator_role ?? null,
    assignedToUserId: row.assigned_to_user_id ?? null, assignedToName: row.assigned_to_name ?? null, assignedToRole: row.assigned_to_role ?? null,
    assignedByUserId: row.assigned_by_user_id ?? null, assignedByName: row.assigned_by_name ?? null, assignedByRole: row.assigned_by_role ?? null,
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
    seasonId: row.season_id != null ? String(row.season_id) : null,
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
    paymentPreferences: {
      status: row.payment_preference_status ?? null,
      mode: row.payment_preference_mode ?? null,
      receivedAmountPaise: row.payment_preference_received_paise ?? null,
    },
    customerNote: row.customer_note ?? null,
    deliveryAddress: row.delivery_address ?? null,
    deliveryLandmark: row.delivery_landmark ?? null,
    deliveryMapsUrl: row.delivery_maps_url ?? null,
    finalizationStatus: row.finalization_status != null ? String(row.finalization_status) : null,
    seasonId: row.season_id != null ? String(row.season_id) : null,
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
    lineId: row.line_id ?? null,
    unitType: row.unit_type ?? null,
    packSnapshot: row.pack_snapshot ? JSON.parse(row.pack_snapshot) : null,
    productDetails: row.product_details_json ? JSON.parse(row.product_details_json) : null,
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
 *   visibilityCutoff: string,
 *   status?: string,
 *   q?: string,
 *   finalizationStatus?: string,
 *   assignedToEmail?: string,
 *   seasonId?: string,
 * }} opts
 */
export async function listAdminCustomerRequests(db, opts) {
  if (!parseAdminCustomerRequestVisibilityCutoff(opts.visibilityCutoff)) {
    throw new Error('A valid customer request visibility cutoff is required.')
  }
  db = customerRequestDb(db, opts.seasonId, opts.context)
  const limit = opts.limit
  const offset = opts.offset
  const { whereSql, binds } = buildAdminCustomerRequestListFilter(opts)
  const listSql = `${ADMIN_LIST_CUSTOMER_REQUESTS_SQL} ${whereSql} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`
  const countSql = `SELECT COUNT(*) AS total FROM customer_requests r ${whereSql}`

  const measure = opts.measure ?? ((_name, work) => work())
  const [listResult, countRow] = await Promise.all([
    db.prepare(listSql).bind(...binds, limit, offset).all(),
    measure('count', () => db.prepare(countSql).bind(...binds).first()),
  ])

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
 * @param {string} seasonId
 */
export async function enrichAdminCustomerRequestListForRole(db, requests, role, seasonId, context) {
  db = customerRequestDb(db, seasonId, context)
  if (!canViewSensitiveProductPricing(role)) return requests

  const season = String(seasonId ?? '').trim()

  const eligible = requests.filter(req => req.id && (!season || String(req.seasonId ?? '') === season))
  const quotations = new Map()
  // Only saved list totals. Never hydrate quotation items or reconstruct pricing.
  // Leave room for the operating-season and stall predicates added by the DB boundary.
  for (let start = 0; start < eligible.length; start += 90) {
    const ids = eligible.slice(start, start + 90).map(req => String(req.id))
    const result = await db.prepare(`SELECT customer_request_id, selling_subtotal_paise,
      final_subtotal_paise, accepted_amount_paise, total_paise
      FROM quotations WHERE customer_request_id IN (${ids.map(() => '?').join(',')})
      AND status != 'void'${season ? ' AND season_id = ?' : ''}
      ORDER BY created_at DESC`).bind(...ids, ...(season ? [season] : [])).all()
    for (const row of result.results ?? []) {
      if (!quotations.has(String(row.customer_request_id))) quotations.set(String(row.customer_request_id), row)
    }
  }
  return requests.map(req => {
    const row = quotations.get(String(req.id))
    if (!row) return req
    const amounts = resolveOwnerListRequestAuditAmounts({
      sellingSubtotalPaise: row.selling_subtotal_paise,
      finalSubtotalPaise: row.final_subtotal_paise,
      acceptedAmountPaise: row.accepted_amount_paise,
      totalPaise: row.total_paise,
    }, null)
    const auditSummary = buildOwnerCustomerRequestListAuditSummary(amounts)
    return auditSummary ? { ...req, auditSummary } : req
  })
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 * @param {string} [seasonId]
 */
export async function getAdminCustomerRequestById(db, requestId, seasonId, context) {
  db = customerRequestDb(db, seasonId, context)
  const season = String(seasonId ?? '').trim()
  const row = season
    ? await db
        .prepare(`${ADMIN_GET_CUSTOMER_REQUEST_SQL} AND season_id = ?`)
        .bind(requestId, season)
        .first()
    : await db.prepare(ADMIN_GET_CUSTOMER_REQUEST_SQL).bind(requestId).first()
  if (!row) return null
  const itemsResult = await db
    .prepare(ADMIN_LIST_CUSTOMER_REQUEST_ITEMS_SQL)
    .bind(requestId)
    .all()
  const items = itemsResult.results ?? []
  return mapAdminCustomerRequestDetail(row, items)
}

/** Online-only informational metadata, deliberately separate from payment operations. */
export async function updateRequestPaymentPreferences(db, requestId, body, opts = {}) {
  db = customerRequestDb(db, opts.seasonId, opts.context, true)
  const scope = customerRequestScope(db)
  if (!canFinalizeQuickBillCustomerRequests(scope?.effectiveRole ?? opts.actorRole)) {
    return { ok: false, status: 403, code: 'forbidden', message: 'Only Owner or Super Admin can edit payment preferences.' }
  }
  const gate = requireCustomerRequestSeasonId(opts.seasonId)
  if (!gate.ok) return gate
  if (scope && opts.context?.workflowTransport?.expectedRevision == null) {
    return { ok: false, status: 428, code: 'revision_required', message: 'Refresh the request before saving payment preferences.' }
  }
  const row = await db.prepare(`SELECT id, status, finalization_status,
    payment_preference_status, payment_preference_mode, payment_preference_received_paise
    FROM customer_requests WHERE id = ? AND season_id = ?`).bind(requestId, gate.season).first()
  if (!row) return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  if (['closed', 'void'].includes(row.status) || row.finalization_status === 'finalized') {
    return { ok: false, status: 409, code: 'request_locked', message: 'Payment preferences can only be edited before finalization on an open request.' }
  }
  const quotation = await getActiveQuotationForRequest(db, requestId, gate.season)
  const parsed = validateRequestPaymentPreferences(body, quotation?.acceptedAmountPaise)
  if (!parsed.ok) return { ...parsed, status: 400, code: 'invalid_payment_preferences' }
  const snapshot = scope ? activeQuotationSnapshot(quotation) : null
  const result = await db.prepare(`UPDATE customer_requests SET
    payment_preference_status = ?, payment_preference_mode = ?, payment_preference_received_paise = ?,
    updated_at = datetime('now') WHERE id = ? AND season_id = ?
    AND status NOT IN ('closed','void') AND finalization_status IS NOT 'finalized'
    AND payment_preference_status IS ? AND payment_preference_mode IS ? AND payment_preference_received_paise IS ?
    ${snapshot ? `AND ${snapshot.sql}` : ''}`)
    .bind(parsed.data.status, parsed.data.mode, parsed.data.receivedAmountPaise, requestId, gate.season,
      row.payment_preference_status, row.payment_preference_mode, row.payment_preference_received_paise,
      ...(snapshot?.values ?? [])).run()
  if (!result.meta?.changes) return { ok: false, status: 409, code: 'request_changed', message: 'The request changed. Refresh before retrying.' }
  return { ok: true, request: await getAdminCustomerRequestById(db, requestId, gate.season) }
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
 * @param {{ actorEmail?: string | null, seasonId?: string }} [opts]
 */
export async function updateAdminCustomerRequestStatus(db, requestId, nextStatus, opts = {}) {
  db = customerRequestDb(db, opts.seasonId, opts.context, true)
  const seasonGate = requireCustomerRequestSeasonId(opts.seasonId)
  if (!seasonGate.ok) return seasonGate
  const { season } = seasonGate

  const existing = await db
    .prepare('SELECT id, status FROM customer_requests WHERE id = ? AND season_id = ?')
    .bind(requestId, season)
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
           WHERE id = ? AND season_id = ?`,
        )
        .bind(nextStatus, actorEmail, requestId, season)
        .run()
    : await db
        .prepare(ADMIN_UPDATE_CUSTOMER_REQUEST_STATUS_SQL)
        .bind(nextStatus, requestId, season)
        .run()

  if (!run.meta?.changes) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }

  const request = await getAdminCustomerRequestById(db, requestId, season)
  return { ok: true, request }
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 * @param {string} [seasonId]
 */
export async function markCustomerRequestPendingFinalization(db, requestId, seasonId, context) {
  db = customerRequestDb(db, seasonId, context, true)
  const seasonGate = requireCustomerRequestSeasonId(seasonId)
  if (!seasonGate.ok) return seasonGate
  const { season } = seasonGate

  if (context?.locationModeEnabled && !await getAdminCustomerRequestById(db, requestId, season)) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }

  const updated = await db
    .prepare(
      `UPDATE customer_requests
       SET finalization_status = 'pending', updated_at = datetime('now')
       WHERE id = ? AND source = 'manual' AND season_id = ?`,
    )
    .bind(requestId, season)
    .run()
  if (context?.locationModeEnabled && !updated.meta?.changes) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }
  return { ok: true }
}

/** @param {Record<string, unknown>} row */
function isPendingFinalization(row) {
  const fs = row.finalization_status == null ? null : String(row.finalization_status)
  return fs === 'pending'
}

/** @param {Record<string, unknown>} row */
function isManualQuickBillPendingFinalization(row) {
  return ['manual', 'web'].includes(String(row.source ?? '')) && isPendingFinalization(row)
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

export const SEASON_ASSIGNEE_MEMBERSHIP_SQL = `
  SELECT sm.role, sm.disabled_at, bs.status
  FROM season_members sm
  INNER JOIN business_seasons bs ON bs.id = sm.season_id
  WHERE sm.season_id = ? AND sm.admin_user_id = ?
`.trim()

/**
 * @param {D1Database} db
 * @param {{ assigneeUserId?: string, assigneeEmail?: string }} assigneeRef
 * @param {string} seasonId
 */
export async function resolveQuickBillAssignee(db, assigneeRef, seasonId, context) {
  db = customerRequestDb(db, seasonId, context)
  const season = String(seasonId ?? '').trim()
  if (!season) {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Active business season is required.',
    }
  }

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

  const membership = await db.prepare(SEASON_ASSIGNEE_MEMBERSHIP_SQL).bind(season, user.id).first()
  if (!membership) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_assignee',
      message: 'Assignee must be a member of the active business season.',
      fields: { assigneeUserId: 'User is not a member of this season.' },
    }
  }
  if (membership.disabled_at != null && String(membership.disabled_at).trim() !== '') {
    return {
      ok: false,
      status: 400,
      code: 'invalid_assignee',
      message: 'Assignee season membership is disabled.',
      fields: { assigneeUserId: 'Season membership is disabled for this user.' },
    }
  }
  if (String(membership.status ?? '') !== 'active') {
    return {
      ok: false,
      status: 400,
      code: 'invalid_assignee',
      message: 'Assignee must belong to an active business season.',
      fields: { assigneeUserId: 'Business season is not active for this assignee.' },
    }
  }

  const seasonRole = strictParseAdminRole(membership.role)
  if (!seasonRole || !canFinalizeQuickBillCustomerRequests(seasonRole)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_assignee',
      message: 'Assignee is not eligible for stall bill assignment in this season.',
      fields: { assigneeUserId: 'Season role is not eligible for assignment.' },
    }
  }

  return { ok: true, email: user.email }
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 * @param {{ assigneeUserId?: string, assigneeEmail?: string }} assigneeRef
 * @param {{ assignedByEmail?: string | null, seasonId?: string }} [opts]
 */
export async function assignAdminCustomerRequest(db, requestId, assigneeRef, opts = {}) {
  db = customerRequestDb(db, opts.seasonId, opts.context, true)
  const seasonGate = requireCustomerRequestSeasonId(opts.seasonId)
  if (!seasonGate.ok) return seasonGate
  const { season } = seasonGate

  const row = await db
    .prepare(ADMIN_GET_CUSTOMER_REQUEST_QUEUE_WITH_SEASON_SQL)
    .bind(requestId, season)
    .first()
  if (!row) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }
  const sameRecipient = assigneeRef.assigneeUserId ? row.assigned_to_user_id === assigneeRef.assigneeUserId : row.assigned_to_email === String(assigneeRef.assigneeEmail ?? '').trim().toLowerCase()
  if (sameRecipient && row.assigned_by_email === String(opts.assignedByEmail ?? '').trim().toLowerCase()) return { ok: true, alreadyAssigned: true, request: await getAdminCustomerRequestById(db, requestId, season) }
  if (!isManualQuickBillPendingFinalization(row)) {
    return {
      ok: false,
      status: 400,
      code: 'not_assignable',
      message: 'Only pending manual stall bills can be assigned.',
      fields: { requestId: 'Request is not a pending manual bill.' },
    }
  }

  const assignee = await resolveQuickBillAssignee(db, assigneeRef, season)
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

  if (opts.requireRevision && opts.context?.workflowTransport?.expectedRevision == null) return { ok: false, status: 428, code: 'revision_required', message: 'Refresh the request and send its current revision before handover.' }
  const results = await db.batch([
    assignmentMembershipGuard(db, requestId, assignee.email, season),
    requestAssignmentStatement(db, requestId, assignee.email, assignedByEmail, season),
  ])
  const run = results.at(-1)

  if (!run.meta?.changes) {
    return {
      ok: false,
      status: 409,
      code: 'assign_failed',
      message: 'Could not assign request. It may no longer be pending.',
    }
  }

  const request = await getAdminCustomerRequestById(db, requestId, season)
  return { ok: true, request }
}

export function requestAssignmentStatement(db, requestId, assigneeEmail, actorEmail, season) {
  return db.prepare(`UPDATE customer_requests
    SET assigned_to_email = ?, assigned_by_email = ?, assigned_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND source IN ('manual','web') AND finalization_status = 'pending' AND season_id = ?`)
    .bind(assigneeEmail, actorEmail, requestId, season)
}

/** The recipient's authority is checked again inside the business transaction. */
export function assignmentMembershipGuard(db, requestId, assigneeEmail, season) {
  const scope = customerRequestScope(db)
  return db.prepare(`UPDATE customer_requests SET status = CASE WHEN EXISTS (
    SELECT 1 FROM admin_users recipient JOIN season_members recipient_sm ON recipient_sm.admin_user_id = recipient.id
    JOIN business_seasons recipient_season ON recipient_season.id = recipient_sm.season_id
    WHERE lower(recipient.email) = lower(?) AND (recipient.disabled_at IS NULL OR recipient.disabled_at = '')
      AND recipient_sm.season_id = ? AND (recipient_sm.disabled_at IS NULL OR recipient_sm.disabled_at = '')
      AND recipient_sm.role IN ('owner','super_admin') AND recipient_season.status = 'active'
      ${scope ? `AND EXISTS (SELECT 1 FROM location_members recipient_lm WHERE recipient_lm.admin_user_id = recipient.id
        AND recipient_lm.location_id = customer_requests.location_id AND recipient_lm.season_id = customer_requests.season_id
        AND (recipient_lm.disabled_at IS NULL OR recipient_lm.disabled_at = '') AND recipient_lm.role IN ('owner','super_admin'))` : ''}
    ) THEN status ELSE NULL END WHERE id = ? AND season_id = ?`).bind(assigneeEmail, season, requestId, season)
}

/**
 * Owner/Super Admin — customer agreed on a public web quotation request.
 * @param {D1Database} db
 * @param {string} requestId
 * @param {string} [seasonId] Required for admin-triggered calls (omit only for legacy internal use).
 */
export async function recordPublicCustomerAgreementPendingFinalization(db, requestId, seasonId, context) {
  db = customerRequestDb(db, seasonId, context, true)
  const seasonGate = requireCustomerRequestSeasonId(seasonId)
  if (!seasonGate.ok) return seasonGate
  const { season } = seasonGate

  const row = await db
    .prepare(ADMIN_GET_CUSTOMER_REQUEST_QUEUE_WITH_SEASON_SQL)
    .bind(requestId, season)
    .first()
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
       WHERE id = ? AND source = 'web' AND finalization_status IS NULL AND season_id = ?`,
    )
    .bind(requestId, season)
    .run()

  if (!run.meta?.changes) {
    return {
      ok: false,
      status: 409,
      code: 'agreement_failed',
      message: 'Could not record customer agreement. The request may have changed.',
    }
  }

  const request = await getAdminCustomerRequestById(db, requestId, season)
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
 * @param {{ actorEmail?: string | null, seasonId?: string }} [opts]
 */
export async function finalizeAdminCustomerRequest(db, requestId, opts = {}) {
  db = customerRequestDb(db, opts.seasonId, opts.context, true)
  const scope = customerRequestScope(db)
  if (scope && !canFinalizeQuickBillCustomerRequests(scope.effectiveRole) && !hasOfflineFinalization(opts.context,scope)) {
    return { ok: false, status: 403, code: 'forbidden', message: 'Only Owner or Super Admin can finalize requests.' }
  }
  const seasonGate = requireCustomerRequestSeasonId(opts.seasonId)
  if (!seasonGate.ok) return seasonGate
  const { season } = seasonGate

  const row = await db
    .prepare(
      `SELECT id, source, finalization_status, assigned_to_email, status
       FROM customer_requests WHERE id = ? AND season_id = ?`,
    )
    .bind(requestId, season)
    .first()
  if (!row) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }

  const finalizationStatus = row.finalization_status == null ? null : String(row.finalization_status)
  if (finalizationStatus === 'finalized') {
    const request = await getAdminCustomerRequestById(db, requestId, season)
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

  const activeQuotation = await getActiveQuotationForRequest(db, requestId, season)
  const activeQuotationAuditRow = activeQuotationAuditRowFromApi(activeQuotation)
  if (dbRowBlocksFinalizeMissingAgreedAmount(activeQuotationAuditRow)) {
    return {
      ok: false,
      status: 400,
      code: 'agreed_amount_required',
      message:
        'Record the customer-agreed amount before finalizing. Finalize cannot close the request without a saved positive amount.',
    }
  }

  const snapshot = customerRequestScope(db) ? activeQuotationSnapshot(activeQuotation) : null
  const run = await db
    .prepare(
      `UPDATE customer_requests
       SET finalization_status = 'finalized',
           status = 'closed',
           closed_by_email = ?,
           closed_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ? AND finalization_status = 'pending' AND season_id = ?${snapshot ? ` AND status IS ? AND status NOT IN ('closed', 'void') AND ${snapshot.sql}` : ''}`,
    )
    .bind(actorEmail, requestId, season, ...(snapshot ? [currentStatus, ...snapshot.values] : []))
    .run()

  if (!run.meta?.changes) {
    const after = await db
      .prepare(`SELECT finalization_status FROM customer_requests WHERE id = ? AND season_id = ?`)
      .bind(requestId, season)
      .first()
    if (after && String(after.finalization_status) === 'finalized') {
      const request = await getAdminCustomerRequestById(db, requestId, season)
      return { ok: true, request, alreadyFinalized: true }
    }
    return {
      ok: false,
      status: 409,
      code: 'finalize_failed',
      message: 'Could not finalize request. It may already be finalized.',
    }
  }

  const request = await getAdminCustomerRequestById(db, requestId, season)
  return { ok: true, request }
}
