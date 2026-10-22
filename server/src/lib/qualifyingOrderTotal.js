import { getCataloguePublicPriceInr } from './cataloguePublicPrices.js'
import { FREE_DOOR_DELIVERY_MIN_PAISE } from './freeDoorDelivery.js'
import { lineTotalPaise } from '../services/money.js'

export { FREE_DOOR_DELIVERY_MIN_PAISE }

/**
 * @param {D1Database} db
 * @param {{ productId?: string, familyPackId?: string, quantity: number }[]} items
 */
export async function computeQualifyingOrderTotalPaise(db, items) {
  let totalPaise = 0
  for (const item of items) {
    const qty = Number(item.quantity)
    if (!Number.isInteger(qty) || qty < 1) continue
    const familyPackId = String(item.familyPackId ?? '').trim()
    const productId = String(item.productId ?? '').trim()
    if (familyPackId) {
      const pack = await db
        .prepare('SELECT selling_price_paise FROM family_packs WHERE id = ?')
        .bind(familyPackId)
        .first()
      const unit = Number(pack?.selling_price_paise)
      if (Number.isInteger(unit) && unit > 0) {
        totalPaise += lineTotalPaise(unit, qty)
      }
      continue
    }
    if (productId) {
      const inr = getCataloguePublicPriceInr(productId)
      if (inr != null && inr > 0) {
        totalPaise += lineTotalPaise(Math.round(inr * 100), qty)
      }
    }
  }
  return totalPaise
}

/** @param {number} totalPaise */
export function isQualifyingForFreeDoorDeliveryPaise(totalPaise) {
  return Number(totalPaise) >= FREE_DOOR_DELIVERY_MIN_PAISE
}
