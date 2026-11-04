import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture, attach, A, season } from './helpers/mockAdminTransactionDb.js'
import { catalogueSellingUnitRates, presentCustomerFacingQuotation, computeCustomerFacingQuotationTotalPaise } from '../src/lib/customerFacingQuotationTotal.js'
import { shouldRedactNonSellingUnitRateForAdmin, filterQuotationForRole, filterQuotationForCustomerRequestDetail, filterCustomerRequestDetailForRole } from '../src/lib/adminQuotationResponse.js'
import { getQuotationById, getQuotationWhatsAppPayload, getOrderConfirmationWhatsAppPayload } from '../src/services/adminQuotations.js'

const HISTORICAL = 17347
const mismatch = error => error.code === 'request_ownership_mismatch'
async function setup({ mode = true, price = null, source = 'manual' } = {}) {
  const db = fixture(), { context } = await attach(db, { mode })
  db.state.products[0].selling_price_paise = price
  db.state.customer_requests[0].source = source
  db.state.customer_request_items[0].unit_price_paise = HISTORICAL
  Object.assign(db.state.quotations[0], { total_paise: HISTORICAL, subtotal_paise: HISTORICAL,
    final_subtotal_paise: HISTORICAL, accepted_amount_paise: HISTORICAL, selling_subtotal_paise: HISTORICAL,
    wa_message_text: 'Grand total: historical secret 17347' })
  Object.assign(db.state.quotation_items[0], { unit_rate_paise: HISTORICAL, line_total_paise: HISTORICAL })
  const quotation = await getQuotationById(db, 'q-a', season, context)
  return { db, context, quotation }
}
function assertUnavailable(quotation) {
  assert.equal(quotation.pricingUnavailable, true)
  assert.equal(quotation.items[0].unitRatePaise, null)
  assert.equal(quotation.items[0].lineTotalPaise, null)
  assert.equal(quotation.subtotalPaise, null)
  assert.equal(quotation.totalPaise, null)
  assert.match(quotation.whatsAppMessage, /Grand total: unavailable/)
  assert.doesNotMatch(quotation.whatsAppMessage, /17347|173\.47|historical secret/)
}

for (const price of [null, undefined, 0, -1, 1.5, '10000', 'invalid', true, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
  test(`missing or invalid catalogue price (${String(price)}) redacts historical rates and total`, async () => {
    const { db, context, quotation } = await setup()
    db.state.products[0].selling_price_paise = price
    const before = structuredClone(db.state), input = structuredClone(quotation)
    assert.equal(await shouldRedactNonSellingUnitRateForAdmin(db, 'P001', HISTORICAL, season, context), true)
    assert.equal(await catalogueSellingUnitRates(db, 'P001', season, context), null)
    const presented = await filterQuotationForRole(db, quotation, 'admin', season, context)
    assertUnavailable(presented)
    for (const key of ['finalSubtotalPaise', 'sellingSubtotalPaise', 'acceptedAmountPaise', 'bargainFloorPaise']) assert.equal(presented[key], undefined)
    assert.equal(await computeCustomerFacingQuotationTotalPaise(db, quotation, 'manual', A, season, context), null)
    assert.deepEqual(db.state, before)
    assert.deepEqual(quotation, input)
    assert.ok(db.calls.every(call => call.mode !== 'run' && !/FROM private_rates|FROM product_purchase_rates/.test(call.sql)))
  })
}

test('gate OFF retains the original historical-rate and audit-total fallback, without location queries', async () => {
  const { db, context, quotation } = await setup({ mode: false })
  db.calls.length = 0
  assert.equal(await shouldRedactNonSellingUnitRateForAdmin(db, 'P001', HISTORICAL, season, context), false)
  const response = await filterQuotationForRole(db, quotation, 'admin', season, context)
  assert.equal(response.items[0].unitRatePaise, HISTORICAL)
  assert.equal(response.totalPaise, HISTORICAL)
  assert.equal(response.pricingUnavailable, undefined)
  assert.equal(await computeCustomerFacingQuotationTotalPaise(db, quotation, 'manual', A, season, context), HISTORICAL)
  assert.ok(db.calls.every(c => !/location_id|location_members|business_locations/.test(c.sql)))
})

test('current box/loose selling prices remain visible and historical non-selling rates are replaced safely', async () => {
  const { db, context, quotation } = await setup({ price: 10000 })
  for (const rate of [10000, 1000]) assert.equal(await shouldRedactNonSellingUnitRateForAdmin(db, 'P001', rate, season, context), false)
  assert.equal(await shouldRedactNonSellingUnitRateForAdmin(db, 'P001', HISTORICAL, season, context), true)
  const response = await filterQuotationForRole(db, quotation, 'admin', season, context)
  assert.equal(response.items[0].unitRatePaise, 10000)
  assert.equal(response.items[0].lineTotalPaise, 10000)
  assert.equal(response.totalPaise, 10000)
  assert.equal(response.pricingUnavailable, undefined)
  assert.doesNotMatch(response.whatsAppMessage, /17347|historical secret/)
  assert.equal(await computeCustomerFacingQuotationTotalPaise(db, quotation, 'manual', A, season, context), 10000)
  quotation.items[0].productName = 'Product (loose pc)'
  db.state.customer_request_items[0].product_name = 'Product (loose pc)'
  assert.equal((await presentCustomerFacingQuotation(db, quotation, A, season, context)).items[0].unitRatePaise, 1000)
})

test('restricted request detail redacts unverifiable historical unit prices as well as quotation responses', async () => {
  const { db, context, quotation } = await setup()
  const request = { id: A, source: 'manual', items: [{ productId: 'P001', quantity: 1, unitPricePaise: HISTORICAL }] }
  const filtered = await filterCustomerRequestDetailForRole(db, request, 'admin', season, context)
  assert.equal(filtered.items[0].unitPricePaise, null)
  assertUnavailable(await filterQuotationForCustomerRequestDetail(db, quotation, 'admin', request, season, context))
})

test('foreign product ownership is rejected for direct redaction and all quotation presentations', async () => {
  const { db, context, quotation } = await setup({ price: 10000 })
  db.state.products[0].location_id = 'loc-b'
  await assert.rejects(shouldRedactNonSellingUnitRateForAdmin(db, 'P001', HISTORICAL, season, context), mismatch)
  await assert.rejects(presentCustomerFacingQuotation(db, quotation, A, season, context), mismatch)
  await assert.rejects(getQuotationWhatsAppPayload(db, 'q-a', season, context), mismatch)
})

test('a missing product cannot fall back to a historical snapshot', async () => {
  const { db, context, quotation } = await setup()
  db.state.products = db.state.products.filter(p => p.id !== 'P001')
  await assert.rejects(filterQuotationForRole(db, quotation, 'admin', season, context), mismatch)
})

for (const source of ['manual', 'web']) test(`WhatsApp and confirmation (${source}) omit unverifiable amounts without claiming zero or free delivery`, async () => {
  const { db, context } = await setup({ source })
  const before = structuredClone(db.state)
  const wa = await getQuotationWhatsAppPayload(db, 'q-a', season, context)
  const confirmation = await getOrderConfirmationWhatsAppPayload(db, A, season, context)
  assert.equal(wa.ok, true); assert.equal(confirmation.ok, true)
  assert.match(wa.message, /Grand total: unavailable/)
  assert.match(confirmation.message, /Order Total: unavailable/)
  assert.doesNotMatch(wa.message + confirmation.message, /17347|173\.47|₹0|FREE DOOR DELIVERY/)
  assert.deepEqual(db.state, before)
})

test('finalized financial snapshots and privileged audit fields remain unchanged by response redaction', async () => {
  const { db, context, quotation } = await setup()
  Object.assign(db.state.customer_requests[0], { status: 'closed', finalization_status: 'finalized' })
  const before = structuredClone(db.state), original = structuredClone(quotation)
  const owner = await filterQuotationForRole(db, quotation, 'owner', season, context)
  assertUnavailable(owner)
  assert.equal(owner.acceptedAmountPaise, HISTORICAL)
  assert.equal(owner.finalSubtotalPaise, HISTORICAL)
  assert.deepEqual(quotation, original)
  assert.deepEqual(db.state, before)
})

test('pack prices fail closed and remain location-owned across older catalogue provenance', async () => {
  const { db, context, quotation } = await setup()
  db.state.customer_request_items[0].product_id = null
  db.state.customer_request_items[0].family_pack_id = 'FP001'
  db.state.quotation_items[0].product_id = null
  quotation.items[0].productId = null
  db.state.family_packs[0].selling_price_paise = null
  assertUnavailable(await presentCustomerFacingQuotation(db, quotation, A, season, context))
  const request = { id: A, items: [{ productId: null, familyPackId: 'FP001', unitPricePaise: HISTORICAL, quantity: 1 }] }
  assert.equal((await filterCustomerRequestDetailForRole(db, request, 'admin', season, context)).items[0].unitPricePaise, null)
  db.state.family_packs[0].selling_price_paise = 5000
  assert.equal((await presentCustomerFacingQuotation(db, quotation, A, season, context)).items[0].unitRatePaise, 5000)
  request.items[0].unitPricePaise = 5000
  assert.equal((await filterCustomerRequestDetailForRole(db, request, 'admin', season, context)).items[0].unitPricePaise, 5000)
  db.state.family_packs[0].location_id = 'loc-b'
  await assert.rejects(presentCustomerFacingQuotation(db, quotation, A, season, context), mismatch)
})

test('catalogue query errors reject the response instead of falling back to historical pricing', async () => {
  const { db, context, quotation } = await setup()
  const prepare = db.prepare.bind(db)
  db.prepare = sql => sql.includes('SELECT selling_price_paise, pieces_per_pack')
    ? { bind: () => ({ first: async () => { throw new Error('Catalogue unavailable') } }) } : prepare(sql)
  await assert.rejects(filterQuotationForRole(db, quotation, 'admin', season, context), /Catalogue unavailable/)
  await assert.rejects(getQuotationWhatsAppPayload(db, 'q-a', season, context), /Catalogue unavailable/)
})

test('unrecognized/invalid lines and monetary aliases cannot expose historical snapshots', async () => {
  const { db, context, quotation } = await setup()
  Object.assign(quotation, { total_paise: HISTORICAL, subtotal_paise: HISTORICAL, wa_message_text: 'secret 17347' })
  Object.assign(quotation.items[0], { unit_rate_paise: HISTORICAL, line_total_paise: HISTORICAL, unitPricePaise: HISTORICAL })
  const result = await presentCustomerFacingQuotation(db, quotation, A, season, context)
  assert.equal(result.total_paise, null)
  assert.equal(result.subtotal_paise, null)
  assert.equal(result.items[0].unit_rate_paise, null)
  assert.equal(result.items[0].line_total_paise, null)
  assert.equal(result.items[0].unitPricePaise, null)
  assert.doesNotMatch(result.wa_message_text, /17347/)
  quotation.items[0].quantity = 0
  assertUnavailable(await presentCustomerFacingQuotation(db, quotation, A, season, context))
})
