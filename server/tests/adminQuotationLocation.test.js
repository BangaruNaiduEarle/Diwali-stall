import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fixture, attach, season, previous, A, B, OLD } from './helpers/mockAdminTransactionDb.js'
import { customerRequestDb } from '../src/lib/adminCustomerRequestScope.js'
import { createOrGetQuotationForRequest, getActiveQuotationForRequest, getQuotationById, getQuotationWhatsAppPayload, getOrderConfirmationWhatsAppPayload, patchActiveQuotationCustomerAgreedAmount, buildQuoteLinesForRequestItems } from '../src/services/adminQuotations.js'
import { checkoutQuickBill, previewQuickBill } from '../src/services/adminQuickBill.js'
import { presentCustomerFacingQuotation, computeCustomerFacingQuotationTotalPaise, catalogueSellingUnitRates } from '../src/lib/customerFacingQuotationTotal.js'
import { filterQuotationForRole, filterQuotationForCustomerRequestDetail, filterCustomerRequestDetailForRole } from '../src/lib/adminQuotationResponse.js'
import { buildRequestInternalPricingView } from '../src/lib/adminInternalPricingPreview.js'
import { handleAdminQuotationRoutes } from '../src/routes/adminQuotations.js'
import { handleAdminQuickBillRoutes } from '../src/routes/adminQuickBill.js'

const items = [{ productId: 'P001', quantity: 2 }]
const customer = { name: 'Guest', mobile: '9876543210', area: 'Town', pickupPreference: 'pickup' }
const mismatch = e => e.code === 'request_ownership_mismatch'

describe('quotation and Quick Bill location transactions (mocked D1 only)', () => {
  it('request quotation GET reuses hydrated request items and retains role redaction', async () => {
    for (const role of ['owner', 'admin']) {
      const db = fixture()
      const prepare = db.prepare.bind(db)
      db.prepare = sql => sql.includes('FROM product_purchase_rates') ? {
        bind: (...v) => ({ first: async () => { db.calls.push({ sql, v }); return { unit_rate_paise: 2500 } } }),
      } : prepare(sql)
      db.state.locationRole = role
      const { req } = await attach(db)
      db.calls.length = 0
      const response = await handleAdminQuotationRoutes(req, { DB: db }, new URL(`https://example.test/api/admin/customer-requests/${A}/quotation`), { email: 'owner@test.com' })
      assert.equal(response.status, 200)
      const { quotation } = await response.json()
      assert.equal(quotation.customerRequestId, A)
      const fullItemReads = db.calls.filter(call => call.sql.includes(' FROM customer_request_items WHERE') && call.sql.includes('line_id, unit_type, pack_snapshot, product_details_json, line_number'))
      assert.equal(fullItemReads.length, 1, 'request item hydration must happen once')
      assert.ok(fullItemReads[0].sql.includes('scoped_request.location_id = ?'))
      assert.ok(fullItemReads[0].v.includes('loc-a'))
      if (role === 'admin') assert.equal(quotation.acceptedAmountPaise, undefined)
    }
  })

  it('request quotation GET still rejects foreign requests and foreign child ownership', async () => {
    const db = fixture(), { req } = await attach(db)
    for (const id of [B, OLD]) {
      const response = await handleAdminQuotationRoutes(req, { DB: db }, new URL(`https://example.test/api/admin/customer-requests/${id}/quotation`), { email: 'owner@test.com' })
      assert.equal(response.status, 404)
    }
    db.state.customer_request_items.find(item => item.request_id === A).product_id = 'P002'
    const response = await handleAdminQuotationRoutes(req, { DB: db }, new URL(`https://example.test/api/admin/customer-requests/${A}/quotation`), { email: 'owner@test.com' })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).error, 'request_ownership_mismatch')
  })

  it('preserves disabled ID lookup and original season pricing SQL without 0020 queries', async () => {
    const db = fixture(), { context } = await attach(db, { mode: false })
    assert.ok(await getQuotationById(db, 'q-b', undefined, context))
    db.calls.length = 0
    const result = await previewQuickBill(db, items, { seasonId: previous, context })
    assert.equal(result.ok, true)
    assert.ok(db.calls.every(c => !c.sql.includes('location_id')))
  })

  for (const [quote, request] of [['q-b', B], ['q-old', OLD]]) it(`rejects foreign location/season ${quote} across operational paths`, async () => {
    const db = fixture(), { context } = await attach(db), before = structuredClone(db.state)
    assert.equal(await getQuotationById(db, quote, season, context), null)
    assert.equal(await getActiveQuotationForRequest(db, request, season, context), null)
    for (const result of [
      await createOrGetQuotationForRequest(db, request, { seasonId: season, context, regenerate: true }),
      await patchActiveQuotationCustomerAgreedAmount(db, request, 20000, season, context),
      await getQuotationWhatsAppPayload(db, quote, season, context),
      await getOrderConfirmationWhatsAppPayload(db, request, season, context),
    ]) assert.equal(result.status, 404)
    assert.deepEqual(db.state, before)
  })

  it('accesses older catalogue provenance from either authorized operating season', async () => {
    const db = fixture()
    for (const operatingSeason of [season, previous]) {
      const { context } = await attach(db, { operatingSeason })
      const result = await previewQuickBill(db, items, { seasonId: operatingSeason, context })
      assert.equal(result.preview.totalPaise, 20000)
      assert.equal((await catalogueSellingUnitRates(db, 'P001', operatingSeason, context)).boxPaise, 10000)
    }
    const { context } = await attach(db)
    assert.equal((await previewQuickBill(db, [{ productId: 'P001', quantity: 3, unitType: 'piece' }], { seasonId: season, context })).preview.totalPaise, 3000)
  })

  it('creates and regenerates quotations with owned children, season and location', async () => {
    const db = fixture(), { context } = await attach(db)
    const result = await createOrGetQuotationForRequest(db, A, { seasonId: season, context, regenerate: true })
    assert.equal(result.ok, true)
    assert.equal(db.state.quotations.find(q => q.id === 'q-a').status, 'void')
    const created = db.state.quotations.find(q => q.id === result.quotation.id)
    assert.equal(created.location_id, 'loc-a'); assert.equal(created.season_id, season)
    assert.equal(created.customer_request_id, A)
    assert.equal(result.quotation.totalPaise, 10000)
    assert.equal(db.state.quotations.find(q => q.id === 'q-b').status, 'draft')
    const replay = await createOrGetQuotationForRequest(db, A, { seasonId: season, context })
    assert.equal(replay.created, false)
  })

  it('rejects foreign locked pack and product lines before pricing or mutation', async () => {
    const db = fixture(), { context } = await attach(db)
    for (const line of [
      { family_pack_id: 'FP002', unit_price_paise: 5000 },
      { product_id: 'P002', unit_price_paise: 5000 },
      { product_id: 'P001', family_pack_id: 'FP001', unit_price_paise: 5000 },
    ]) await assert.rejects(buildQuoteLinesForRequestItems(db, [{ ...line, quantity: 1, line_number: 1 }], season, context), mismatch)
    assert.equal((await previewQuickBill(db, [{ productId: 'P002', quantity: 1 }], { seasonId: season, context })).ok, false)
    db.state.customer_request_items.find(i => i.request_id === A).product_id = 'P002'
    await assert.rejects(createOrGetQuotationForRequest(db, A, { seasonId: season, context }), mismatch)
  })

  it('keeps owned family-pack locked prices and location-wide catalogue presentation', async () => {
    const db = fixture(), { context } = await attach(db)
    db.state.customer_request_items[0] = { request_id: A, line_number: 1, family_pack_id: 'FP001', product_id: null, product_name: 'A pack', quantity: 2, unit_price_paise: 5000 }
    const created = await createOrGetQuotationForRequest(db, A, { seasonId: season, context, regenerate: true })
    assert.equal(created.quotation.totalPaise, 10000)
    assert.equal((await presentCustomerFacingQuotation(db, created.quotation, A, season, context)).totalPaise, 10000)
    assert.equal(db.state.family_packs[0].season_id, previous)
  })

  it('rechecks locked pack ownership in the quotation batch and restores regeneration state on failure', async () => {
    const db = fixture(), { context } = await attach(db)
    db.state.customer_request_items[0] = { request_id: A, line_number: 1, family_pack_id: 'FP001', product_id: null, product_name: 'A pack', quantity: 1, unit_price_paise: 5000 }
    const before = structuredClone(db.state.quotations)
    db.beforeBatch = state => { state.family_packs[0].location_id = 'loc-b' }
    await assert.rejects(createOrGetQuotationForRequest(db, A, { seasonId: season, context, regenerate: true }), /NOT NULL/)
    assert.deepEqual(db.state.quotations, before)
    assert.ok(db.calls.some(c => c.mode === 'run' && c.sql.startsWith('INSERT INTO quotations') && c.sql.includes('scoped_pack.location_id = customer_requests.location_id')))
  })

  it('rejects mismatched quotation parents and foreign quotation children', async () => {
    const db = fixture(), { context } = await attach(db)
    db.state.quotations[0].customer_request_id = B
    assert.equal(await getQuotationById(db, 'q-a', season, context), null)
    db.state.quotations[0].customer_request_id = A
    db.state.quotations[0].season_id = previous
    await assert.rejects(createOrGetQuotationForRequest(db, A, { seasonId: season, context }), mismatch)
    db.state.quotations[0].season_id = season
    db.state.quotation_items[0].product_id = 'P002'
    await assert.rejects(getQuotationById(db, 'q-a', season, context), mismatch)
  })

  it('Quick Bill checkout stamps transactions and child parents without changing catalogue provenance', async () => {
    const db = fixture(), { context } = await attach(db)
    const result = await checkoutQuickBill(db, { customer, items }, { seasonId: season, context, idempotencyKey: 'location-checkout', pricingMode: 'bargain', acceptedAmountPaise: 19000 })
    assert.equal(result.ok, true)
    const request = db.state.customer_requests.find(r => r.id === result.request.id)
    const quote = db.state.quotations.find(q => q.id === result.quotation.id)
    assert.equal(request.location_id, 'loc-a'); assert.equal(request.season_id, season)
    assert.equal(request.source, 'manual'); assert.equal(request.finalization_status, 'pending')
    assert.equal(quote.location_id, 'loc-a'); assert.equal(quote.season_id, season)
    assert.equal(quote.customer_request_id, request.id)
    assert.equal(quote.accepted_amount_paise, 19000)
    assert.equal(quote.final_subtotal_paise, 16000)
    assert.equal(db.state.products[0].season_id, previous)
    assert.equal(db.state.customer_request_items.find(i => i.request_id === request.id).product_id, 'P001')
  })

  it('rechecks product ownership at the Quick Bill child-write boundary and rolls back the batch', async () => {
    const db = fixture(), { context } = await attach(db)
    const count = db.state.customer_requests.length
    db.beforeBatch = state => { state.products[0].location_id = 'loc-b' }
    assert.equal((await checkoutQuickBill(db, { customer, items }, { seasonId: season, context, idempotencyKey: 'ownership-race' })).ok, false)
    assert.equal(db.state.customer_requests.length, count)
  })

  it('scopes agreed amount updates and WhatsApp, preserving audit redaction', async () => {
    const db = fixture(), { context } = await attach(db)
    assert.equal((await patchActiveQuotationCustomerAgreedAmount(db, A, 12000, season, context)).ok, true)
    assert.equal(db.state.quotations[0].accepted_amount_paise, 12000)
    const quote = await getQuotationById(db, 'q-a', season, context)
    quote.adjustmentPaise = -1000
    const owner = await filterQuotationForRole(db, quote, 'owner', season, context)
    const admin = await filterQuotationForRole(db, quote, 'admin', season, context)
    assert.equal(owner.totalPaise, 9000); assert.equal(owner.acceptedAmountPaise, 12000)
    assert.equal(admin.acceptedAmountPaise, undefined); assert.equal(admin.finalSubtotalPaise, undefined)
    assert.equal((await getQuotationWhatsAppPayload(db, 'q-a', season, context)).ok, true)
    assert.equal((await getOrderConfirmationWhatsAppPayload(db, A, season, context)).ok, true)
  })

  it('rejects foreign response objects even when audit totals could short-circuit pricing', async () => {
    const db = fixture(), { context } = await attach(db)
    const foreign = { id: 'q-b', customerRequestId: B, sellingSubtotalPaise: 123, items: [] }
    await assert.rejects(presentCustomerFacingQuotation(db, foreign, B, season, context), mismatch)
    await assert.rejects(computeCustomerFacingQuotationTotalPaise(db, foreign, 'manual', B, season, context), mismatch)
    await assert.rejects(filterCustomerRequestDetailForRole(db, { id: B, items: [] }, 'owner', season, context), mismatch)
    const quote = await getQuotationById(db, 'q-a', season, context)
    await assert.rejects(filterQuotationForCustomerRequestDetail(db, quote, 'owner', { id: OLD, items: [] }, season, context), mismatch)
    await assert.rejects(buildRequestInternalPricingView(db, [{ familyPackId: 'FP002', quantity: 1, unitPricePaise: 100 }], season, context), mismatch)
  })

  it('fails closed on missing/mismatched operating season and scopes inherited ID-only reads', async () => {
    const db = fixture(), { context } = await attach(db)
    await assert.rejects(getQuotationById(db, 'q-a', undefined, context), e => e.status === 403)
    await assert.rejects(previewQuickBill(db, items, { context }), e => e.status === 403)
    await assert.rejects(getQuotationById(db, 'q-a', previous, context), e => e.status === 403)
    const scoped = customerRequestDb(db, season, context)
    assert.equal(await getQuotationById(scoped, 'q-b'), null)
    assert.equal(await getQuotationById(scoped, 'q-old'), null)
    const quoteReads = db.calls.filter(c => /FROM quotations WHERE/.test(c.sql))
    assert.ok(quoteReads.every(c => c.sql.includes('quotations.location_id = ?') && c.sql.includes('quotations.season_id = ?') && c.sql.includes('scoped_request')))
  })

  it('rejects archived writes before any query and retains archived read access', async () => {
    const db = fixture(), { context } = await attach(db)
    context.locationContext.business.status = 'archived'
    context.locationContext.capabilities.write = false
    db.calls.length = 0
    await assert.rejects(checkoutQuickBill(db, { customer, items }, { seasonId: season, context }), e => e.status === 403)
    await assert.rejects(createOrGetQuotationForRequest(db, A, { seasonId: season, context }), e => e.status === 403)
    await assert.rejects(patchActiveQuotationCustomerAgreedAmount(db, A, 20000, season, context), e => e.status === 403)
    assert.equal(db.calls.length, 0)
    assert.ok(await getQuotationById(db, 'q-a', season, context))
  })

  it('uses intersected location authority for quotation redaction and agreed-amount routes', async () => {
    const db = fixture(); db.state.locationRole = 'admin'
    const { req } = await attach(db)
    const detail = await handleAdminQuotationRoutes(req, { DB: db }, new URL('https://example.test/api/admin/quotations/q-a'), { email: 'owner@test.com' })
    assert.equal(detail.status, 200)
    const quote = (await detail.json()).quotation
    assert.equal(quote.acceptedAmountPaise, undefined); assert.equal(quote.finalSubtotalPaise, undefined)
    const { req: patch } = await attach(db, { method: 'PATCH', payload: { acceptedAmountInr: 123 } })
    const denied = await handleAdminQuotationRoutes(patch, { DB: db }, new URL(`https://example.test/api/admin/customer-requests/${A}/quotation/customer-agreed-amount`), { email: 'owner@test.com' })
    assert.equal(denied.status, 403)
    const { req: preview } = await attach(db, { method: 'POST', payload: { items, pricingMode: 'bargain' } })
    Object.defineProperty(preview, 'url', { value: 'https://example.test/api/admin/quick-bill/preview' })
    assert.equal((await handleAdminQuickBillRoutes(preview, { DB: db }, {})).status, 403)
  })

  it('wires quotation and Quick Bill routes to validated middleware context', async () => {
    const db = fixture()
    const { req } = await attach(db)
    for (const id of ['q-a', 'q-b', 'q-old']) {
      const url = new URL(`https://example.test/api/admin/quotations/${id}`)
      const response = await handleAdminQuotationRoutes(req, { DB: db }, url, { email: 'owner@test.com' })
      assert.equal(response.status, id === 'q-a' ? 200 : 404)
    }
    const { req: preview } = await attach(db, { method: 'POST', payload: { items } })
    // Preserve the attached request context while selecting the route URL.
    Object.defineProperty(preview, 'url', { value: 'https://example.test/api/admin/quick-bill/preview' })
    const response = await handleAdminQuickBillRoutes(preview, { DB: db }, { email: 'owner@test.com' })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).preview.totalPaise, 20000)
  })
})
