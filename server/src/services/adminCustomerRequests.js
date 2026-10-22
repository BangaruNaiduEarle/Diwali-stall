import { validateCustomerRequestStatusTransition } from '../lib/adminCustomerRequestValidation.js'

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
    created_at,
    updated_at
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
 * @param {{ status?: string, q?: string }} opts
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map(mapAdminCustomerRequestItemRow),
  }
}

/** @param {Record<string, unknown>} row */
function mapAdminCustomerRequestItemRow(row) {
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
 * @param {{ limit: number, offset: number, status?: string, q?: string }} opts
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
