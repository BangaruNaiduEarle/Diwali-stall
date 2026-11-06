// Offline catalogue fields; keep box and piece lines distinct, as in Quick Bill.
export function offlineProductAvailable(product, unitType = 'box') {
  if (!product || Number(product.active) !== 1 || ['soldout', 'sold-out'].includes(product.stock_status) ||
    !Number.isSafeInteger(product.selling_price_paise) || product.selling_price_paise <= 0) return false
  if (unitType === 'box') return true
  return unitType === 'piece' && Number(product.allow_loose_sale) === 1 &&
    Number.isSafeInteger(product.pieces_per_pack) && product.pieces_per_pack > 0 &&
    Math.floor(product.selling_price_paise / product.pieces_per_pack) > 0
}

export function validateOfflineItems(items, catalogue) {
  if (!items.length || items.length > 50) throw Error('Add between 1 and 50 product or Family Pack lines.')
  const seen = new Set()
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) throw Error('Quantities must be whole numbers between 1 and 99.')
    const unit = item.unitType ?? 'box'
    const key = item.familyPackId ? `pack:${item.familyPackId}` : `product:${item.productId}:${unit}`
    if (seen.has(key)) throw Error('This bill has duplicate product/unit lines. Remove the duplicate and update the remaining quantity.')
    seen.add(key)
    if (item.familyPackId) {
      if (unit !== 'box') throw Error('Family Packs must be sold as whole packs.')
    } else if (!offlineProductAvailable(catalogue.find(product => product.id === item.productId), unit)) {
      throw Error('A product or selected unit is unavailable. Check the saved catalogue and loose-sale configuration.')
    }
  }
}

export function addOfflineProduct(items, product, unitType, lineId) {
  if (!offlineProductAvailable(product, unitType)) throw Error('This product or selected unit is unavailable.')
  const index = items.findIndex(item => item.productId === product.id && (item.unitType ?? 'box') === unitType)
  const next = index < 0 ? [...items, { lineId, productId: product.id, quantity: 1, unitType }] :
    items.map((item, i) => i === index ? { ...item, quantity: Number(item.quantity) + 1 } : item)
  if (next.length > 50) throw Error('Maximum 50 bill lines. Review the cart before adding more.')
  if (index >= 0 && (!Number.isInteger(items[index].quantity) || items[index].quantity < 1 || next[index].quantity > 99)) throw Error('Enter a whole quantity between 1 and 99 before adding more.')
  return next
}

export function changeOfflineUnit(items, index, unitType, catalogue) {
  const item = items[index]
  if (!offlineProductAvailable(catalogue.find(product => product.id === item.productId), unitType)) throw Error('This product or selected unit is unavailable.')
  if (items.some((other, i) => i !== index && other.productId === item.productId && (other.unitType ?? 'box') === unitType)) {
    throw Error('That unit is already in the cart. Update its quantity instead, or remove it before changing this line.')
  }
  // Quantity is a count of the selected unit. A per-unit override cannot carry
  // from a box to a piece (or vice versa).
  return items.map((line, i) => i === index ? { ...line, unitType, priceInr: '' } : line)
}
