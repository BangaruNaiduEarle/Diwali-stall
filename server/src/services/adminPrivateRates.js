import { formatEffectiveFromUtc } from '../lib/x4PrivateRatesImport.js'
import { inrToPaise, paiseToInr } from './money.js'

export const CURRENT_PRIVATE_RATE_SQL = `
  SELECT id, product_id, unit_rate_paise, effective_from, effective_to, notes
  FROM private_rates
  WHERE product_id = ? AND effective_to IS NULL
`.trim()

/**
 * @param {D1Database} db
 * @param {string} productId
 */
export async function getCurrentPrivateRate(db, productId) {
  const row = await db.prepare(CURRENT_PRIVATE_RATE_SQL).bind(productId).first()
  if (!row) return null
  return mapPrivateRateRow(row)
}

/** @param {Record<string, unknown>} row */
export function mapPrivateRateRow(row) {
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
 * Current X4 public selling prices (Excel column X4). Imported into private_rates; used for quotations.
 * Not supplier purchase/cost — see product_purchase_rates.
 */

/**
 * Supersede current rate and insert a new current row (preserves history).
 * @param {D1Database} db
 * @param {string} productId
 * @param {number} unitRatePaise
 * @param {string} [notes]
 */
export async function upsertCurrentPrivateRate(db, productId, unitRatePaise, notes = 'admin_rate_update') {
  if (!Number.isInteger(unitRatePaise) || unitRatePaise < 0) {
    return { ok: false, errors: { unitRateInr: 'Invalid rate.' } }
  }

  const product = await db.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first()
  if (!product) {
    return { ok: false, status: 404, code: 'not_found', message: 'Product not found.' }
  }

  const current = await getCurrentPrivateRate(db, productId)
  if (current && Number(current.unitRatePaise) === unitRatePaise) {
    return { ok: true, rate: current, unchanged: true }
  }

  const effectiveFrom = formatEffectiveFromUtc()
  const statements = [
    db
      .prepare(
        `UPDATE private_rates
         SET effective_to = datetime('now'), updated_at = datetime('now')
         WHERE product_id = ? AND effective_to IS NULL`,
      )
      .bind(productId),
    db
      .prepare(
        `INSERT INTO private_rates (product_id, unit_rate_paise, effective_from, notes)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(productId, unitRatePaise, effectiveFrom, notes),
  ]

  await db.batch(statements)
  const rate = await getCurrentPrivateRate(db, productId)
  return { ok: true, rate }
}

/**
 * @param {number} inr
 */
export function validatePrivateRateInr(inr) {
  const n = Number(inr)
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
    return { ok: false, error: 'X4 selling price must be between 0 and 1,000,000 INR.' }
  }
  return { ok: true, paise: inrToPaise(n) }
}
