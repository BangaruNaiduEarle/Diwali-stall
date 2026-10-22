import { getCataloguePublicPriceInr } from '../data/cataloguePublicPrices.js'
import { formatINR } from './currency.js'
import { getEstimateProducts, getFamilyPackEstimateRows } from './estimateHelpers.js'

export const FREE_DOOR_DELIVERY_MIN_INR = 1000

/**
 * Qualifying total for the free-delivery offer: family-pack selling prices plus
 * catalogue list prices where available (same public price map as stall listings).
 * @param {{ productId?: string, familyPackId?: string, quantity: number }[]} estimateItems
 */
export function computeQualifyingOrderTotalInr(estimateItems) {
  const productRows = getEstimateProducts(estimateItems)
  let total = 0
  for (const row of productRows) {
    const listPrice = getCataloguePublicPriceInr(row.productId)
    const unit = listPrice ?? (typeof row.product?.price === 'number' ? row.product.price : 0)
    total += unit * row.quantity
  }
  for (const row of getFamilyPackEstimateRows(estimateItems)) {
    total += row.lineTotal || 0
  }
  return total
}

/** @param {number} qualifyingTotalInr */
export function isFreeDoorDeliveryEligibleInr(qualifyingTotalInr) {
  const n = Number(qualifyingTotalInr)
  return Number.isFinite(n) && n >= FREE_DOOR_DELIVERY_MIN_INR
}

/**
 * @param {number} qualifyingTotalInr
 * @returns {{ qualified: boolean, message: string, amountRemainingInr: number }}
 */
export function getFreeDoorDeliveryUiMessage(qualifyingTotalInr) {
  const total = Math.max(0, Number(qualifyingTotalInr) || 0)
  if (isFreeDoorDeliveryEligibleInr(total)) {
    return {
      qualified: true,
      amountRemainingInr: 0,
      message:
        '🎉 Congratulations! Your order qualifies for FREE door delivery (subject to delivery coverage in your area).',
    }
  }
  const remaining = Math.max(0, FREE_DOOR_DELIVERY_MIN_INR - total)
  return {
    qualified: false,
    amountRemainingInr: remaining,
    message: `Add ${formatINR(remaining)} more to unlock FREE door delivery!`,
  }
}
