/**
 * @typedef {{ productId: string, name: string, quantity: number, productImageUrl?: string }} QuickBillCartLine
 */

/** @param {QuickBillCartLine[]} cart @param {string} productId */
export function findCartLineIndex(cart, productId) {
  return cart.findIndex((line) => line.productId === productId)
}

/**
 * @param {QuickBillCartLine[]} cart
 * @param {{ productId: string, name: string, productImageUrl?: string }} product
 * @param {number} [addQty]
 */
export function addProductToCart(cart, product, addQty = 1) {
  const qty = Math.max(1, Math.min(99, Math.trunc(addQty)))
  const next = [...cart]
  const index = findCartLineIndex(next, product.productId)
  const imagePatch =
    product.productImageUrl && product.productImageUrl.startsWith('https://')
      ? { productImageUrl: product.productImageUrl }
      : {}
  if (index >= 0) {
    const merged = Math.min(99, next[index].quantity + qty)
    next[index] = { ...next[index], quantity: merged, ...imagePatch }
    return next
  }
  return [
    ...next,
    {
      productId: product.productId,
      name: product.name,
      quantity: qty,
      ...imagePatch,
    },
  ]
}

/**
 * @param {QuickBillCartLine[]} cart
 * @param {string} productId
 * @param {number} quantity
 */
export function setCartLineQuantity(cart, productId, quantity) {
  const qty = Math.trunc(quantity)
  if (qty < 1) {
    return cart.filter((line) => line.productId !== productId)
  }
  return cart.map((line) =>
    line.productId === productId ? { ...line, quantity: Math.min(99, qty) } : line,
  )
}

/** @param {QuickBillCartLine[]} cart @param {string} productId */
export function removeCartLine(cart, productId) {
  return cart.filter((line) => line.productId !== productId)
}

/** @param {QuickBillCartLine[]} cart */
export function cartToCheckoutItems(cart) {
  return cart.map((line) => ({ productId: line.productId, quantity: line.quantity }))
}

/** @param {QuickBillCartLine[]} cart */
export function cartItemCount(cart) {
  return cart.reduce((sum, line) => sum + line.quantity, 0)
}
