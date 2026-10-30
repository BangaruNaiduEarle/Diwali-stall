/**
 * @typedef {'box' | 'piece'} QuickBillUnitType
 * @typedef {{ productId: string, name: string, company?: string | null, quantity: number, unitType: QuickBillUnitType, productImageUrl?: string, allowLooseSale?: boolean }} QuickBillCartLine
 */

/** @param {QuickBillCartLine[]} cart @param {string} productId @param {QuickBillUnitType} [unitType] */
export function findCartLineIndex(cart, productId, unitType = 'box') {
  return cart.findIndex((line) => line.productId === productId && line.unitType === unitType)
}

/** @param {QuickBillCartLine[]} cart @param {string} productId @param {QuickBillUnitType} [unitType] */
export function getCartLineQuantity(cart, productId, unitType = 'box') {
  const index = findCartLineIndex(cart, productId, unitType)
  if (index < 0) return null
  return cart[index].quantity
}

/**
 * @param {QuickBillCartLine[]} cart
 * @param {{ productId: string, name: string, company?: string | null, productImageUrl?: string, allowLooseSale?: boolean }} product
 * @param {number} [addQty]
 * @param {QuickBillUnitType} [unitType]
 */
export function addProductToCart(cart, product, addQty = 1, unitType = 'box') {
  const saleUnit = unitType === 'piece' ? 'piece' : 'box'
  const qty = Math.max(1, Math.min(99, Math.trunc(addQty)))
  const next = [...cart]
  const index = findCartLineIndex(next, product.productId, saleUnit)
  const imagePatch =
    product.productImageUrl && product.productImageUrl.startsWith('https://')
      ? { productImageUrl: product.productImageUrl }
      : {}
  const loosePatch =
    product.allowLooseSale === true ? { allowLooseSale: true } : {}
  const companyPatch =
    product.company != null && String(product.company).trim()
      ? { company: String(product.company).trim() }
      : {}
  if (index >= 0) {
    const merged = Math.min(99, next[index].quantity + qty)
    next[index] = { ...next[index], quantity: merged, ...imagePatch, ...loosePatch, ...companyPatch }
    return next
  }
  return [
    ...next,
    {
      productId: product.productId,
      name: product.name,
      quantity: qty,
      unitType: saleUnit,
      ...imagePatch,
      ...loosePatch,
      ...companyPatch,
    },
  ]
}

/**
 * @param {QuickBillCartLine[]} cart
 * @param {string} productId
 * @param {number} quantity
 * @param {QuickBillUnitType} [unitType]
 */
export function setCartLineQuantity(cart, productId, quantity, unitType = 'box') {
  const saleUnit = unitType === 'piece' ? 'piece' : 'box'
  const qty = Math.trunc(quantity)
  if (qty < 1) {
    return cart.filter((line) => !(line.productId === productId && line.unitType === saleUnit))
  }
  return cart.map((line) =>
    line.productId === productId && line.unitType === saleUnit
      ? { ...line, quantity: Math.min(99, qty) }
      : line,
  )
}

/** @param {QuickBillCartLine[]} cart @param {string} productId @param {QuickBillUnitType} [unitType] */
export function removeCartLine(cart, productId, unitType = 'box') {
  const saleUnit = unitType === 'piece' ? 'piece' : 'box'
  return cart.filter((line) => !(line.productId === productId && line.unitType === saleUnit))
}

/** @param {QuickBillCartLine[]} cart */
export function cartToCheckoutItems(cart) {
  return cart.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    unitType: line.unitType === 'piece' ? 'piece' : 'box',
  }))
}

/** @param {QuickBillCartLine[]} cart */
export function cartItemCount(cart) {
  return cart.reduce((sum, line) => sum + line.quantity, 0)
}
