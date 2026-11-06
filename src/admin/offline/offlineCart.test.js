import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addOfflineProduct, changeOfflineUnit, offlineProductAvailable, validateOfflineItems } from './offlineCart.js'
import { posSummary } from './posPresentation.js'
import { sellingLines } from './handover.js'

const product = { id: 'P001', name: 'Sparklers', active: 1, stock_status: 'available', selling_price_paise: 10001, pieces_per_pack: 6, allow_loose_sale: 1 }

test('mixed offline boxes and pieces retain distinct identities, rounded prices and saved snapshots', () => {
  let items = addOfflineProduct([], product, 'box', 'box-line')
  items = addOfflineProduct(items, product, 'piece', 'piece-line')
  items = addOfflineProduct(items, product, 'box', 'unused')
  items = addOfflineProduct(items, product, 'piece', 'unused')
  validateOfflineItems(items, [product])
  assert.deepEqual(items.map(item => [item.lineId, item.unitType, item.quantity]), [['box-line', 'box', 2], ['piece-line', 'piece', 2]])
  const draft = JSON.parse(JSON.stringify({ draftId: 'draft', body: { items } }))
  const summary = posSummary(draft, [product], [])
  assert.equal(summary.subtotal, 23334)
  assert.deepEqual(summary.lines.map(line => [line.boxQuantity, line.looseQuantity, line.totalPieces]), [[2, 0, 12], [0, 2, 2]])
  assert.deepEqual(sellingLines(draft.body.items, [product], 'draft').map(line => [line.unitType, line.quantity, line.sellingUnitPaise]), [['box', 2, 10001], ['piece', 2, 1666]])
  assert.throws(() => changeOfflineUnit(items, 0, 'piece', [product]), /already in the cart/)
  assert.equal(changeOfflineUnit([{ ...items[0], priceInr: '120' }], 0, 'piece', [product])[0].priceInr, '')
})

test('offline validation rejects invalid units, quantities, unavailable products and duplicate lines', () => {
  const item = { productId: product.id, quantity: 1, unitType: 'piece' }
  for (const patch of [{ active: 0 }, { stock_status: 'soldout' }, { stock_status: 'sold-out' }, { allow_loose_sale: 0 }, { pieces_per_pack: 0 }, { pieces_per_pack: 1.5 }, { selling_price_paise: 1 }]) {
    assert.equal(offlineProductAvailable({ ...product, ...patch }, 'piece'), false)
    assert.throws(() => validateOfflineItems([item], [{ ...product, ...patch }]), /unavailable/)
  }
  for (const quantity of ['', 0, -1, 1.5, 100, NaN]) assert.throws(() => validateOfflineItems([{ ...item, quantity }], [product]), /whole numbers/)
  assert.throws(() => validateOfflineItems([item, { ...item }], [product]), /duplicate/)
  assert.throws(() => validateOfflineItems([{ ...item, unitType: 'invalid' }], [product]), /unavailable/)
  assert.throws(() => addOfflineProduct([{ ...item, quantity: 99 }], product, 'piece', 'unused'), /between 1 and 99/)
  assert.equal(posSummary({ draftId: 'draft', body: { items: [{ ...item, quantity: -1 }] } }, [product], []).subtotal, null)
})
