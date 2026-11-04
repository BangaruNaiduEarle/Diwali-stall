import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adjustmentPayload, currentBillRevision, requestRevisionHeaders, draftHasNewerRevision, checkoutHandoverFields } from './billAdjustment.js'
import { customerRequestItemsToAdjustCart } from './adminCustomerRequestAdjustBillCart.js'
import { createQuickBillRetryKeys } from './quickBillCheckoutKey.js'

test('Admin item payload omits every privileged financial field', () => {
  const payload = adjustmentPayload([{ productId: 'P001', quantity: 3, unitType: 'piece', priceInr: '0.01' }], { privileged: false, discountInr: '500', agreedAmountInr: '1' })
  assert.deepEqual(payload, { ok: true, body: { items: [{ productId: 'P001', quantity: 3, unitType: 'piece' }] } })
})

test('privileged edit payload validates integer paise and supports explicitly clearing discounts', () => {
  const cart = [{ productId: 'P001', quantity: 2, unitType: 'box', priceInr: '123.45' }]
  assert.deepEqual(adjustmentPayload(cart, { privileged: true, discountInr: '0' }).body,
    { items: [{ productId: 'P001', quantity: 2, unitType: 'box', unitRatePaise: 12345 }], discountPaise: 0 })
  for (const value of ['-1', '1.001', 'Infinity', '1e5', '90071992547409999']) assert.equal(adjustmentPayload(cart, { privileged: true, discountInr: value }).ok, false)
  assert.equal(adjustmentPayload([{ ...cart[0], priceInr: '0' }], { privileged: true }).ok, false)
  assert.equal(adjustmentPayload([{ ...cart[0], priceInr: '90071992547409.91' }], { privileged: true }).body.items[0].unitRatePaise, Number.MAX_SAFE_INTEGER)
  assert.equal(adjustmentPayload([{ ...cart[0], priceInr: '90071992547409.92' }], { privileged: true }).ok, false)
})

test('cart preserves explicit units, line identity and saved customer prices', () => {
  const cart = customerRequestItemsToAdjustCart([{ productId: 'P001', productName: 'Unlabelled piece', quantity: 2, unitType: 'piece', lineId: 'stable', productDetails: { billing: { sellingUnitPaise: 1250 } } }])
  assert.equal(cart[0].unitType, 'piece'); assert.equal(cart[0].lineId, 'stable'); assert.equal(cart[0].priceInr, '12.50')
})

test('revision selection never advances stale request items using a separately refreshed quotation', () => {
  assert.equal(currentBillRevision({ revision: 4 }, { requestRevision: 9 }), 4)
  assert.equal(currentBillRevision({ revision: 9 }, { requestRevision: 4 }), 4)
  assert.deepEqual(requestRevisionHeaders(4), { 'If-Match': '4' })
  assert.deepEqual(requestRevisionHeaders(null), {})
  assert.equal(draftHasNewerRevision(4, 9, true), true)
  assert.equal(draftHasNewerRevision(4, 4, true), false)
  assert.equal(draftHasNewerRevision(4, 9, false), false)
})

test('checkout handover participates in the retry key and leaves legacy payloads compatible', () => {
  const keys = createQuickBillRetryKeys((() => { let i = 0; return () => String(++i) })())
  const first = { items: [], ...checkoutHandoverFields(true, 'super') }
  assert.equal(keys.forCheckout(first, 'loc-a'), keys.forCheckout(first, 'loc-a'))
  assert.notEqual(keys.forCheckout(first, 'loc-a'), keys.forCheckout({ ...first, assigneeUserId: 'owner' }, 'loc-a'))
  assert.deepEqual(checkoutHandoverFields(false, 'super'), {})
  assert.deepEqual(checkoutHandoverFields(true, ''), {})
})
