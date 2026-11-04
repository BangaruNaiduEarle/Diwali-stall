/**
 * Supplier purchase/cost rates (Excel "Rate") — never used for customer quotations.
 */
import { formatEffectiveFromUtc } from '../lib/x4PrivateRatesImport.js'
import { inrToPaise, paiseToInr } from './money.js'
import { adminCatalogueScope } from '../lib/adminCatalogueScope.js'

export const CURRENT_PURCHASE_RATE_SQL = `
  SELECT id, product_id, unit_rate_paise, effective_from, effective_to, notes
  FROM product_purchase_rates
  WHERE product_id = ? AND effective_to IS NULL AND season_id = ?
`.trim()

/**
 * @param {D1Database} db
 * @param {string} productId
 * @param {string} seasonId
 */
export async function getCurrentPurchaseRate(db, productId, seasonId, context) {
  const scope = adminCatalogueScope(db, seasonId, context)
  if (scope.locationId) {
    const owned = await ownedPurchaseRateProduct(db, productId, scope)
    if (!owned.ok) {
      if (owned.status === 404) return null
      throw Object.assign(new Error(owned.message), owned)
    }
    const row = await db.prepare(locationPurchaseRatesSql + ' AND r.effective_to IS NULL')
      .bind(productId, scope.locationId, scope.locationId).first()
    return row ? mapPurchaseRateRow(row) : null
  }
  const season = String(seasonId ?? '').trim()
  const row = await db.prepare(CURRENT_PURCHASE_RATE_SQL).bind(productId, season).first()
  if (!row) return null
  return mapPurchaseRateRow(row)
}

/** @param {Record<string, unknown>} row */
export function mapPurchaseRateRow(row) {
  return {
    id: row.id,
    productId: row.product_id,
    unitRatePaise: row.unit_rate_paise,
    unitRateInr: paiseToInr(Number(row.unit_rate_paise)),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to ?? null,
    notes: row.notes ?? null,
  }
}

/**
 * @param {D1Database} db
 * @param {string} productId
 * @param {number} unitRatePaise
 * @param {string} seasonId
 * @param {string} [notes]
 */
export async function upsertCurrentPurchaseRate(
  db,
  productId,
  unitRatePaise,
  seasonId,
  notes = 'admin_purchase_rate_update',
  context,
) {
  const scope = adminCatalogueScope(db, seasonId, context, true)
  if (!Number.isInteger(unitRatePaise) || unitRatePaise < 0) {
    return { ok: false, errors: { purchaseRateInr: 'Invalid rate.' } }
  }

  if (scope.locationId) return upsertLocationPurchaseRate(db, productId, unitRatePaise, scope, notes, context)

  const season = String(seasonId ?? '').trim()
  const product = await db
    .prepare('SELECT id FROM products WHERE id = ? AND season_id = ?')
    .bind(productId, season)
    .first()
  if (!product) {
    return { ok: false, status: 404, code: 'not_found', message: 'Product not found.' }
  }

  const current = await getCurrentPurchaseRate(db, productId, season)
  if (current && Number(current.unitRatePaise) === unitRatePaise) {
    return { ok: true, rate: current, unchanged: true }
  }

  const effectiveFrom = formatEffectiveFromUtc()
  const statements = [
    db
      .prepare(
        `UPDATE product_purchase_rates
         SET effective_to = datetime('now'), updated_at = datetime('now')
         WHERE product_id = ? AND effective_to IS NULL AND season_id = ?`,
      )
      .bind(productId, season),
    db
      .prepare(
        `INSERT INTO product_purchase_rates (product_id, unit_rate_paise, effective_from, notes, season_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(productId, unitRatePaise, effectiveFrom, notes, season),
  ]

  await db.batch(statements)
  const rate = await getCurrentPurchaseRate(db, productId, season)
  return { ok: true, rate }
}

// Used only with a validated, enabled location context.
async function ownedPurchaseRateProduct(db, productId, scope) {
  const product = await db.prepare('SELECT id, season_id, location_id FROM products WHERE id = ? AND location_id = ?')
    .bind(productId, scope.locationId).first()
  if (!product) return { ok: false, status: 404, code: 'not_found', message: 'Product not found.' }
  const mismatch = await db.prepare(`
    SELECT 1 AS mismatch FROM product_purchase_rates r
    WHERE r.product_id = ? AND r.location_id IS NOT ?
      AND EXISTS (SELECT 1 FROM products p WHERE p.id = r.product_id AND p.location_id = ?)
    LIMIT 1
  `).bind(productId, scope.locationId, scope.locationId).first()
  if (mismatch) {
    return { ok: false, status: 409, code: 'rate_ownership_mismatch', message: 'Rate ownership does not match the product location.' }
  }
  return { ok: true, product }
}

const locationPurchaseRatesSql = `
  SELECT r.id, r.product_id, r.unit_rate_paise, r.effective_from, r.effective_to, r.notes
  FROM product_purchase_rates r
  INNER JOIN products p ON p.id = r.product_id AND p.location_id = r.location_id
  WHERE r.product_id = ? AND r.location_id = ? AND p.location_id = ?
`.trim()

/** List history without treating catalogue provenance as an operating-season filter. */
export async function listPurchaseRates(db, productId, seasonId, context) {
  const scope = adminCatalogueScope(db, seasonId, context)
  if (scope.locationId) {
    const owned = await ownedPurchaseRateProduct(db, productId, scope)
    if (!owned.ok) {
      if (owned.status === 404) return []
      throw Object.assign(new Error(owned.message), owned)
    }
    const result = await db.prepare(locationPurchaseRatesSql + ' ORDER BY r.effective_from DESC, r.id DESC')
      .bind(productId, scope.locationId, scope.locationId).all()
    return (result.results ?? []).map(mapPurchaseRateRow)
  }
  const result = await db.prepare(`
    SELECT id, product_id, unit_rate_paise, effective_from, effective_to, notes
    FROM product_purchase_rates WHERE product_id = ? AND season_id = ?
    ORDER BY effective_from DESC, id DESC
  `).bind(productId, scope.seasonId).all()
  return (result.results ?? []).map(mapPurchaseRateRow)
}

async function upsertLocationPurchaseRate(db, productId, unitRatePaise, scope, notes, context) {
  const owned = await ownedPurchaseRateProduct(db, productId, scope)
  if (!owned.ok) return owned
  const current = await db.prepare(locationPurchaseRatesSql + ' AND r.effective_to IS NULL')
    .bind(productId, scope.locationId, scope.locationId).first()
  if (current && Number(current.unit_rate_paise) === unitRatePaise) {
    return { ok: true, rate: mapPurchaseRateRow(current), unchanged: true }
  }
  const effectiveFrom = formatEffectiveFromUtc()
  try {
    await db.batch([
      db.prepare(`UPDATE product_purchase_rates
        SET effective_to = datetime('now'), updated_at = datetime('now')
        WHERE product_id = ? AND effective_to IS NULL AND location_id = ?
          AND EXISTS (SELECT 1 FROM products p WHERE p.id = product_purchase_rates.product_id AND p.location_id = ?)`)
        .bind(productId, scope.locationId, scope.locationId),
      // NULL product_id fails the batch if ownership changed after validation;
      // do not commit supersession without its replacement. Location is explicit.
      db.prepare(`INSERT INTO product_purchase_rates
        (product_id, unit_rate_paise, effective_from, notes, season_id, location_id)
        VALUES ((SELECT id FROM products WHERE id = ? AND location_id = ?), ?, ?, ?,
                (SELECT season_id FROM products WHERE id = ? AND location_id = ?), ?)`)
        .bind(productId, scope.locationId, unitRatePaise, effectiveFrom, notes,
          productId, scope.locationId, scope.locationId),
    ])
  } catch (error) {
    const message = String(error?.message)
    if (/NOT NULL constraint failed: product_purchase_rates\.product_id/i.test(message)) {
      return { ok: false, status: 404, code: 'not_found', message: 'Product not found.' }
    }
    if (/rate location must match product location/i.test(message)) {
      return { ok: false, status: 409, code: 'rate_ownership_mismatch', message: 'Rate ownership does not match the product location.' }
    }
    if (/UNIQUE constraint failed: product_purchase_rates\.product_id/i.test(message)) {
      return { ok: false, status: 409, code: 'rate_conflict', message: 'The current product rate changed. Retry the operation.' }
    }
    throw error
  }
  const rate = await getCurrentPurchaseRate(db, productId, scope.seasonId, context)
  return { ok: true, rate }
}


/** @param {number} inr */
export function validatePurchaseRateInr(inr) {
  const n = Number(inr)
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
    return { ok: false, error: 'Purchase rate must be between 0 and 1,000,000 INR.' }
  }
  return { ok: true, paise: inrToPaise(n) }
}
