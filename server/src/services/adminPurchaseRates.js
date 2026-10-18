/**
 * Supplier purchase/cost rates (Excel "Rate") — never used for customer quotations.
 */
import { formatEffectiveFromUtc } from '../lib/x4PrivateRatesImport.js'
import { inrToPaise, paiseToInr } from './money.js'

export const CURRENT_PURCHASE_RATE_SQL = `
  SELECT id, product_id, unit_rate_paise, effective_from, effective_to, notes
  FROM product_purchase_rates
  WHERE product_id = ? AND effective_to IS NULL
`.trim()

/**
 * @param {D1Database} db
 * @param {string} productId
 */
export async function getCurrentPurchaseRate(db, productId) {
  const row = await db.prepare(CURRENT_PURCHASE_RATE_SQL).bind(productId).first()
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
 * @param {string} [notes]
 */
export async function upsertCurrentPurchaseRate(db, productId, unitRatePaise, notes = 'admin_purchase_rate_update') {
  if (!Number.isInteger(unitRatePaise) || unitRatePaise < 0) {
    return { ok: false, errors: { purchaseRateInr: 'Invalid rate.' } }
  }

  const product = await db.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first()
  if (!product) {
    return { ok: false, status: 404, code: 'not_found', message: 'Product not found.' }
  }

  const current = await getCurrentPurchaseRate(db, productId)
  if (current && Number(current.unitRatePaise) === unitRatePaise) {
    return { ok: true, rate: current, unchanged: true }
  }

  const effectiveFrom = formatEffectiveFromUtc()
  const statements = [
    db
      .prepare(
        `UPDATE product_purchase_rates
         SET effective_to = datetime('now'), updated_at = datetime('now')
         WHERE product_id = ? AND effective_to IS NULL`,
      )
      .bind(productId),
    db
      .prepare(
        `INSERT INTO product_purchase_rates (product_id, unit_rate_paise, effective_from, notes)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(productId, unitRatePaise, effectiveFrom, notes),
  ]

  await db.batch(statements)
  const rate = await getCurrentPurchaseRate(db, productId)
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
