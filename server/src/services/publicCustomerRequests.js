import {
  generatePublicReference,
  isCustomerRequestIdUniqueConstraintError,
  isPublicReferenceUniqueConstraintError,
  PUBLIC_REFERENCE_MAX_GENERATION_ATTEMPTS,
} from '../lib/customerRequestPublicReference.js'
import { assertFamilyPackAvailableForRequest } from './publicFamilyPacks.js'

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
    id, public_reference, status, customer_name, customer_phone, customer_area,
    pickup_preference, customer_note, delivery_address, delivery_landmark, delivery_maps_url,
    source, updated_at
  ) VALUES (?, ?, 'received', ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
`.trim()

export const INSERT_CUSTOMER_REQUEST_ITEM_SQL = `
  INSERT INTO customer_request_items (
    request_id, line_number, product_id, family_pack_id, product_name, quantity, unit_price_paise
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`.trim()

export const GET_REQUEST_SUMMARY_SQL = `
  SELECT id, public_reference, status, source, created_at
  FROM customer_requests
  WHERE id = ?
`.trim()

export const ASSIGN_PUBLIC_REFERENCE_SQL = `
  UPDATE customer_requests
  SET public_reference = ?, updated_at = datetime('now')
  WHERE id = ? AND public_reference IS NULL
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
  const publicReferenceRaw = row.public_reference
  return {
    id: String(row.id),
    publicReference:
      publicReferenceRaw != null && String(publicReferenceRaw).trim()
        ? String(publicReferenceRaw).trim()
        : null,
    status: String(row.status),
    source: String(row.source),
    createdAt: String(row.created_at),
    itemCount,
  }
}

/**
 * @param {D1Database} db
 * @param {string} requestId
 * @param {() => Promise<string>} [generateReference]
 */
export async function ensurePublicReferenceOnRequest(db, requestId, generateReference = generatePublicReference) {
  const existing = await getPublicRequestSummary(db, requestId)
  if (!existing) return null
  if (existing.publicReference) return existing

  for (let attempt = 0; attempt < PUBLIC_REFERENCE_MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = await generateReference()
    try {
      const result = await db.prepare(ASSIGN_PUBLIC_REFERENCE_SQL).bind(candidate, requestId).run()
      const changes = Number(result.meta?.changes ?? 0)
      if (changes === 1) {
        return getPublicRequestSummary(db, requestId)
      }
      const afterRace = await getPublicRequestSummary(db, requestId)
      if (afterRace?.publicReference) return afterRace
    } catch (err) {
      if (isPublicReferenceUniqueConstraintError(err)) continue
      throw err
    }
  }

  return {
    ok: false,
    status: 500,
    error: 'reference_generation_failed',
    message: 'Could not save your request. Please try again.',
  }
}

/**
 * @param {D1Database} db
 * @param {import('../lib/customerRequestValidation.js').NormalizedCustomerRequest} data
 * @param {{ requestId: string, idempotentReplay?: boolean, generateReference?: () => Promise<string>, resolvedLines?: { productId: string | null, familyPackId: string | null, productName: string, quantity: number, unitPricePaise: number | null }[] }} meta
 */
export async function createPublicCustomerRequest(db, data, meta) {
  return createCustomerRequestWithSource(db, data, { ...meta, source: 'web' })
}

/**
 * Admin walk-in / stall billing — same validation and line resolution as public requests.
 * @param {D1Database} db
 * @param {import('../lib/customerRequestValidation.js').NormalizedCustomerRequest} data
 * @param {{ requestId: string, generateReference?: () => Promise<string>, resolvedLines?: { productId: string | null, familyPackId: string | null, productName: string, quantity: number, unitPricePaise: number | null }[] }} meta
 */
export async function createManualCustomerRequest(db, data, meta) {
  return createCustomerRequestWithSource(db, data, { ...meta, source: 'manual' })
}

/**
 * @param {D1Database} db
 * @param {import('../lib/customerRequestValidation.js').NormalizedCustomerRequest} data
 * @param {{
 *   requestId: string,
 *   source: 'web' | 'manual',
 *   idempotentReplay?: boolean,
 *   generateReference?: () => Promise<string>,
 *   resolvedLines?: { productId: string | null, familyPackId: string | null, productName: string, quantity: number, unitPricePaise: number | null }[],
 * }} meta
 */
async function createCustomerRequestWithSource(db, data, meta) {
  const { requestId, source } = meta
  const generateReference = meta.generateReference ?? generatePublicReference

  const lineRows =
    meta.resolvedLines != null
      ? { ok: true, lines: meta.resolvedLines }
      : await resolveRequestLines(db, data.items)
  if (!lineRows.ok) {
    return lineRows
  }

  const lines = lineRows.lines

  /**
   * @param {string} publicReference
   * @returns {D1PreparedStatement[]}
   */
  function buildBatchStatements(publicReference) {
    /** @type {D1PreparedStatement[]} */
    const statements = [
      db
        .prepare(INSERT_CUSTOMER_REQUEST_SQL)
        .bind(
          requestId,
          publicReference,
          data.customer.name,
          data.customer.mobile,
          data.customer.area || null,
          data.customer.pickupPreference || null,
          data.customer.note || null,
          data.customer.deliveryAddress || null,
          data.customer.deliveryLandmark || null,
          data.customer.deliveryMapsUrl || null,
          source,
        ),
    ]

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      statements.push(
        db
          .prepare(INSERT_CUSTOMER_REQUEST_ITEM_SQL)
          .bind(
            requestId,
            i + 1,
            line.productId,
            line.familyPackId,
            line.productName,
            line.quantity,
            line.unitPricePaise ?? null,
          ),
      )
    }
    return statements
  }

  for (let attempt = 0; attempt < PUBLIC_REFERENCE_MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const publicReference = await generateReference()
    try {
      await db.batch(buildBatchStatements(publicReference))
      const summary = await getPublicRequestSummary(db, requestId)
      if (!summary?.publicReference) {
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
    } catch (err) {
      const message = String(err?.message ?? err)
      if (isPublicReferenceUniqueConstraintError(message)) {
        continue
      }
      if (isCustomerRequestIdUniqueConstraintError(message)) {
        const existing = await getPublicRequestSummary(db, requestId)
        if (existing) {
          const withRef = await ensurePublicReferenceOnRequest(db, requestId, generateReference)
          if (withRef && 'ok' in withRef && withRef.ok === false) return withRef
          return {
            ok: true,
            request: withRef ?? existing,
            idempotentReplay: true,
          }
        }
      }
      return {
        ok: false,
        status: 500,
        error: 'database_error',
        message: 'Could not save your request. Please try again.',
      }
    }
  }

  return {
    ok: false,
    status: 500,
    error: 'reference_generation_failed',
    message: 'Could not save your request. Please try again.',
  }
}

/**
 * @param {D1Database} db
 * @param {({ productId: string, quantity: number } | { familyPackId: string, quantity: number })[]} items
 */
export async function resolveRequestLines(db, items) {
  /** @type {{ productId: string | null, familyPackId: string | null, productName: string, quantity: number, unitPricePaise: number | null }[]} */
  const lines = []
  /** @type {Record<string, string>} */
  const fieldErrors = {}

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    if ('familyPackId' in item && item.familyPackId) {
      const availability = await assertFamilyPackAvailableForRequest(db, item.familyPackId)
      if (!availability.ok) {
        fieldErrors[`items[${i}].familyPackId`] = availability.message
        continue
      }
      lines.push({
        productId: null,
        familyPackId: item.familyPackId,
        productName: availability.name,
        quantity: item.quantity,
        unitPricePaise: Number.isInteger(availability.sellingPricePaise)
          ? availability.sellingPricePaise
          : null,
      })
      continue
    }

    const productId = item.productId
    const row = await db.prepare(RESOLVE_REQUEST_PRODUCTS_SQL).bind(productId).first()
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
      productId,
      familyPackId: null,
      productName: String(row.name),
      quantity: item.quantity,
      unitPricePaise: null,
    })
  }

  if (Object.keys(fieldErrors).length) {
    return { ok: false, status: 400, error: 'validation_error', fields: fieldErrors }
  }

  return { ok: true, lines }
}

/** @deprecated use resolveRequestLines */
export async function resolveRequestProducts(db, items) {
  return resolveRequestLines(db, items)
}
