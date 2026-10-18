/**
 * Public customer quotation requests — never reads private_rates.
 */

/** Audited in tests: must not reference private_rates or rate columns. */
export const RESOLVE_REQUEST_PRODUCTS_SQL = `
  SELECT id, name, stock_status, active
  FROM products
  WHERE id = ?
`.trim()

export const INSERT_CUSTOMER_REQUEST_SQL = `
  INSERT INTO customer_requests (
    id, status, customer_name, customer_phone, customer_area,
    pickup_preference, customer_note, source, updated_at
  ) VALUES (?, 'received', ?, ?, ?, ?, ?, ?, datetime('now'))
`.trim()

export const INSERT_CUSTOMER_REQUEST_ITEM_SQL = `
  INSERT INTO customer_request_items (
    request_id, line_number, product_id, product_name, quantity
  ) VALUES (?, ?, ?, ?, ?)
`.trim()

export const GET_REQUEST_SUMMARY_SQL = `
  SELECT id, status, source, created_at
  FROM customer_requests
  WHERE id = ?
`.trim()

/**
 * @param {string} idempotencyKey
 */
export async function deriveRequestIdFromIdempotencyKey(idempotencyKey) {
  const data = new TextEncoder().encode(idempotencyKey)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `cr-${hex.slice(0, 32)}`
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 */
export async function getPublicRequestSummary(db, requestId) {
  const row = await db.prepare(GET_REQUEST_SUMMARY_SQL).bind(requestId).first()
  if (!row) return null
  const countRow = await db
    .prepare('SELECT COUNT(*) AS n FROM customer_request_items WHERE request_id = ?')
    .bind(requestId)
    .first()
  return mapPublicRequestSummary(row, Number(countRow?.n ?? 0))
}

/** @param {Record<string, unknown>} row @param {number} itemCount */
export function mapPublicRequestSummary(row, itemCount) {
  return {
    id: String(row.id),
    status: String(row.status),
    source: String(row.source),
    createdAt: String(row.created_at),
    itemCount,
  }
}

/**
 * @param {D1Database} db
 * @param {import('../lib/customerRequestValidation.js').NormalizedCustomerRequest} data
 * @param {{ requestId: string, idempotentReplay?: boolean }} meta
 */
export async function createPublicCustomerRequest(db, data, meta) {
  return createCustomerRequestWithSource(db, data, { ...meta, source: 'web' })
}

/**
 * Admin walk-in / stall billing — same validation and line resolution as public requests.
 * @param {D1Database} db
 * @param {import('../lib/customerRequestValidation.js').NormalizedCustomerRequest} data
 * @param {{ requestId: string }} meta
 */
export async function createManualCustomerRequest(db, data, meta) {
  return createCustomerRequestWithSource(db, data, { ...meta, source: 'manual' })
}

/**
 * @param {D1Database} db
 * @param {import('../lib/customerRequestValidation.js').NormalizedCustomerRequest} data
 * @param {{ requestId: string, source: 'web' | 'manual', idempotentReplay?: boolean }} meta
 */
async function createCustomerRequestWithSource(db, data, meta) {
  const { requestId, source } = meta
  const productRows = await resolveRequestProducts(db, data.items)
  if (!productRows.ok) {
    return productRows
  }

  const lines = productRows.lines

  /** @type {D1PreparedStatement[]} */
  const statements = [
    db
      .prepare(INSERT_CUSTOMER_REQUEST_SQL)
      .bind(
        requestId,
        data.customer.name,
        data.customer.mobile,
        data.customer.area || null,
        data.customer.pickupPreference || null,
        data.customer.note || null,
        source,
      ),
  ]

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    statements.push(
      db.prepare(INSERT_CUSTOMER_REQUEST_ITEM_SQL).bind(requestId, i + 1, line.productId, line.productName, line.quantity),
    )
  }

  try {
    await db.batch(statements)
  } catch (err) {
    const message = String(err?.message ?? err)
    if (message.includes('UNIQUE constraint failed') && message.includes('customer_requests')) {
      const existing = await getPublicRequestSummary(db, requestId)
      if (existing) {
        return { ok: true, request: existing, idempotentReplay: true }
      }
    }
    return {
      ok: false,
      status: 500,
      error: 'database_error',
      message: 'Could not save your request. Please try again.',
    }
  }

  const summary = await getPublicRequestSummary(db, requestId)
  if (!summary) {
    return {
      ok: false,
      status: 500,
      error: 'database_error',
      message: 'Could not save your request. Please try again.',
    }
  }

  return {
    ok: true,
    request: summary,
    idempotentReplay: Boolean(meta.idempotentReplay),
  }
}

/**
 * @param {D1Database} db
 * @param {{ productId: string, quantity: number }[]} items
 */
export async function resolveRequestProducts(db, items) {
  /** @type {{ productId: string, productName: string, quantity: number }[]} */
  const lines = []
  /** @type {Record<string, string>} */
  const fieldErrors = {}

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    const row = await db.prepare(RESOLVE_REQUEST_PRODUCTS_SQL).bind(item.productId).first()
    if (!row) {
      fieldErrors[`items[${i}].productId`] = 'Product not found.'
      continue
    }
    if (Number(row.active) !== 1) {
      fieldErrors[`items[${i}].productId`] = 'Product is not available.'
      continue
    }
    const stock = String(row.stock_status ?? '')
    if (stock === 'soldout' || stock === 'sold-out') {
      fieldErrors[`items[${i}].productId`] = 'Product is sold out.'
      continue
    }
    lines.push({
      productId: item.productId,
      productName: String(row.name),
      quantity: item.quantity,
    })
  }

  if (Object.keys(fieldErrors).length) {
    return { ok: false, status: 400, error: 'validation_error', fields: fieldErrors }
  }

  return { ok: true, lines }
}
