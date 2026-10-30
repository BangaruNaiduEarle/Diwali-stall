import { productNameIsLoosePiece } from './adminCustomerRequestQuotationDisplay.js'

/**
 * @param {unknown[]} items
 * @returns {import('../lib/quickBillCart.js').QuickBillCartLine[]}
 */
export function customerRequestItemsToAdjustCart(items) {
  /** @type {import('../lib/quickBillCart.js').QuickBillCartLine[]} */
  const cart = []
  for (const raw of items ?? []) {
    if (!raw || typeof raw !== 'object') continue
    const row = /** @type {Record<string, unknown>} */ (raw)
    if (row.familyPackId || row.lineType === 'family_pack') continue
    const productId = String(row.productId ?? '').trim()
    if (!productId) continue
    const quantity = Number(row.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) continue
    const name = String(row.productName ?? productId)
    const unitType = productNameIsLoosePiece(name) ? 'piece' : 'box'
    cart.push({
      productId,
      name: name.replace(/\s*\(\s*loose\s*pc\s*\)\s*$/i, '').trim() || name,
      quantity,
      unitType,
    })
  }
  return cart
}

/** @param {import('../lib/quickBillCart.js').QuickBillCartLine[]} cart */
export function adjustCartToApiItems(cart) {
  return cart.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    unitType: line.unitType === 'piece' ? 'piece' : 'box',
  }))
}
