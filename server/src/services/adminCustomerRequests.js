import { validateCustomerRequestStatusTransition } from '../lib/adminCustomerRequestValidation.js'

/**
 * Admin customer request queue — never reads private_rates or monetary fields.
 */

/** Audited in tests: list/detail must not reference private_rates. */
export const ADMIN_LIST_CUSTOMER_REQUESTS_SQL = `
  SELECT
    r.id,
    r.status,
    r.source,
    r.customer_name,
    r.customer_phone,
    r.customer_area,
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
    status,
    source,
    customer_name,
    customer_phone,
    customer_area,
    pickup_preference,
    customer_note,
    created_at,
    updated_at
  FROM customer_requests
  WHERE id = ?
`.trim()

export const ADMIN_LIST_CUSTOMER_REQUEST_ITEMS_SQL = `
  SELECT line_number, product_id, product_name, quantity
  FROM customer_request_items
  WHERE request_id = ?
  ORDER BY line_number ASC
`.trim()

export const ADMIN_UPDATE_CUSTOMER_REQUEST_STATUS_SQL = `
  UPDATE customer_requests
  SET status = ?, updated_at = datetime('now')
  WHERE id = ?
`.trim()

/** @param {Record<string, unknown>} row */
export function mapAdminCustomerRequestListRow(row) {
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    customerName: row.customer_name ?? null,
    customerPhone: row.customer_phone ?? null,
    customerArea: row.customer_area ?? null,
    createdAt: row.created_at,
    itemCount: Number(row.item_count ?? 0),
  }
}

/** @param {Record<string, unknown>} row @param {Record<string, unknown>[]} items */
export function mapAdminCustomerRequestDetail(row, items) {
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    customerName: row.customer_name ?? null,
    customerPhone: row.customer_phone ?? null,
    customerArea: row.customer_area ?? null,
    pickupPreference: row.pickup_preference ?? null,
    customerNote: row.customer_note ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map(mapAdminCustomerRequestItemRow),
  }
}

/** @param {Record<string, unknown>} row */
function mapAdminCustomerRequestItemRow(row) {
  return {
    lineNumber: row.line_number,
    productId: row.product_id ?? null,
    productName: row.product_name,
    quantity: row.quantity,
  }
}

/**
 * @param {D1Database} db
 * @param {{ limit: number, offset: number, status?: string }} opts
 */
export async function listAdminCustomerRequests(db, opts) {
  const limit = opts.limit
  const offset = opts.offset
  const status = opts.status

  const whereClause = status ? 'WHERE r.status = ?' : ''
  const listSql = `${ADMIN_LIST_CUSTOMER_REQUESTS_SQL} ${whereClause} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`
  const countSql = status
    ? 'SELECT COUNT(*) AS total FROM customer_requests r WHERE r.status = ?'
    : 'SELECT COUNT(*) AS total FROM customer_requests r'

  const listStmt = db.prepare(listSql)
  const countStmt = db.prepare(countSql)

  let listResult
  let countRow
  if (status) {
    listResult = await listStmt.bind(status, limit, offset).all()
    countRow = await countStmt.bind(status).first()
  } else {
    listResult = await listStmt.bind(limit, offset).all()
    countRow = await countStmt.first()
  }

  const total = Number(countRow?.total ?? 0)
  const requests = (listResult.results ?? []).map(mapAdminCustomerRequestListRow)
  return { requests, total }
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
export async function updateAdminCustomerRequestStatus(db, requestId, nextStatus) {
  const existing = await db
    .prepare('SELECT id, status FROM customer_requests WHERE id = ?')
    .bind(requestId)
    .first()
  if (!existing) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }

  const transition = validateCustomerRequestStatusTransition(
    String(existing.status),
    nextStatus,
  )
  if (!transition.ok) {
    return {
      ok: false,
      status: 400,
      code: transition.code,
      message: transition.message,
      fields: { status: transition.message },
    }
  }

  const run = await db
    .prepare(ADMIN_UPDATE_CUSTOMER_REQUEST_STATUS_SQL)
    .bind(nextStatus, requestId)
    .run()

  if (!run.meta?.changes) {
    return { ok: false, status: 404, code: 'not_found', message: 'Customer request not found.' }
  }

  return { ok: true, request: { id: requestId, status: nextStatus } }
}
