import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bindAdminServiceMode } from '../src/lib/adminServiceMode.js'
import { adminCatalogueScope } from '../src/lib/adminCatalogueScope.js'
import { customerRequestDb, validateTransactionCatalogueReferences, validateScopedQuotation, validateScopedRequest } from '../src/lib/adminCustomerRequestScope.js'
import { listAdminCategories, createCategory, updateCategory } from '../src/services/adminCategories.js'
import * as products from '../src/services/adminProducts.js'
import * as packs from '../src/services/adminFamilyPacks.js'
import * as privateRates from '../src/services/adminPrivateRates.js'
import * as purchaseRates from '../src/services/adminPurchaseRates.js'
import * as requests from '../src/services/adminCustomerRequests.js'
import * as quotations from '../src/services/adminQuotations.js'
import { adjustPendingCustomerRequestBill } from '../src/services/adminCustomerRequestBillAdjust.js'
import { checkoutQuickBill, previewQuickBill } from '../src/services/adminQuickBill.js'
import { createManualCustomerRequest } from '../src/services/publicCustomerRequests.js'
import { fixture, attach, A, season, previous } from './helpers/mockAdminTransactionDb.js'

const denied = error => error.code === 'forbidden' || error.code === 'location_context_unavailable'
const customer = { name: 'Guest', mobile: '9876543210' }
const items = [{ productId: 'P001', quantity: 1 }]
function bomb() {
  return { calls: 0, prepare() { this.calls++; throw Error('Unscoped SQL must not execute') } }
}

// Exercise direct exports, not just HTTP middleware. All fail before preparing SQL.
const operations = (db, context) => {
  const opts = { seasonId: season, context }
  return [
    () => listAdminCategories(db, season, context),
    () => createCategory(db, season, { slug: 'test', label: 'Test' }, context),
    () => updateCategory(db, season, 'test', { label: 'Changed' }, context),
    () => products.listAdminProducts(db, opts),
    () => products.listAdminProductsPage(db, opts),
    () => products.getAdminProductById(db, season, 'P001', context),
    () => products.createAdminProduct(db, season, {}, context),
    () => products.updateAdminProduct(db, season, 'P001', {}, context),
    () => products.archiveAdminProduct(db, season, 'P001', context),
    () => products.restoreAdminProduct(db, season, 'P001', context),
    () => products.setAdminProductActive(db, season, 'P001', 1, context),
    () => products.deleteAdminProduct(db, season, 'P001', context),
    () => packs.listAdminFamilyPacks(db, season, { context }),
    () => packs.getAdminFamilyPackById(db, 'FP001', season, context),
    () => packs.createAdminFamilyPack(db, season, {}, context),
    () => packs.updateAdminFamilyPack(db, 'FP001', season, {}, context),
    () => packs.setAdminFamilyPackActive(db, 'FP001', true, season, context),
    () => packs.setAdminFamilyPackArchived(db, 'FP001', true, season, context),
    () => packs.countFamilyPackCustomerRequestReferences(db, 'FP001', season, context),
    () => packs.deleteAdminFamilyPack(db, 'FP001', season, context),
    ...[privateRates, purchaseRates].flatMap((service, index) => {
      const [get, list, upsert] = index === 0 ? ['getCurrentPrivateRate', 'listPrivateRates', 'upsertCurrentPrivateRate'] : ['getCurrentPurchaseRate', 'listPurchaseRates', 'upsertCurrentPurchaseRate']
      return [() => service[get](db, season, 'P001', context), () => service[list](db, season, 'P001', context),
        () => service[upsert](db, season, 'P001', 100, {}, context)]
    }),
    () => requests.listAdminCustomerRequests(db, opts),
    () => requests.getAdminCustomerRequestById(db, A, season, context),
    () => requests.enrichAdminCustomerRequestListForRole(db, [], 'owner', season, context),
    () => requests.updateAdminCustomerRequestStatus(db, A, 'closed', opts),
    () => requests.markCustomerRequestPendingFinalization(db, A, season, context),
    () => requests.resolveQuickBillAssignee(db, 'staff@test.com', season, context),
    () => requests.assignAdminCustomerRequest(db, A, 'staff@test.com', opts),
    () => requests.recordPublicCustomerAgreementPendingFinalization(db, A, season, context),
    () => requests.finalizeAdminCustomerRequest(db, A, opts),
    () => quotations.getActiveQuotationForRequest(db, A, season, context),
    () => quotations.getQuotationById(db, 'q-a', season, context),
    () => quotations.createOrGetQuotationForRequest(db, A, opts),
    () => quotations.patchActiveQuotationCustomerAgreedAmount(db, A, 100, season, context),
    () => quotations.getQuotationWhatsAppPayload(db, 'q-a', season, context),
    () => quotations.getOrderConfirmationWhatsAppPayload(db, A, season, context),
    () => adjustPendingCustomerRequestBill(db, A, items, opts),
    () => checkoutQuickBill(db, { customer, items }, opts),
    () => previewQuickBill(db, items, opts),
    () => createManualCustomerRequest(db, { customer, items }, { ...opts, requestId: 'manual' }),
  ]
}

for (const context of [undefined, null, {}, { locationModeEnabled: false }, { locationModeEnabled: true },
  { locationModeEnabled: true, locationContext: { ok: false } }, { locationModeEnabled: 'false' }]) {
  test(`enabled direct service calls reject missing/invalid context: ${JSON.stringify(context)}`, async () => {
    const db = bindAdminServiceMode(bomb(), { ADMIN_LOCATION_MODE: true })
    for (const operation of operations(db, context)) await assert.rejects(operation(), denied)
    assert.equal(db.calls, 0)
  })
}

test('unknown or invalid binding mode is never implicitly legacy, even with a false context flag', async () => {
  for (const db of [bomb(), bindAdminServiceMode(bomb(), { ADMIN_LOCATION_MODE: 'invalid' })]) {
    for (const operation of operations(db, { locationModeEnabled: false })) await assert.rejects(operation(), denied)
    assert.equal(db.calls, 0)
  }
})

test('an enabled binding cannot be downgraded, copied or hidden behind a new raw proxy', async () => {
  const db = bindAdminServiceMode(bomb(), { ADMIN_LOCATION_MODE: true })
  assert.throws(() => bindAdminServiceMode(db, { ADMIN_LOCATION_MODE: false }), denied)
  for (const other of [{ ...db }, Object.create(db)]) {
    await assert.rejects(requests.getAdminCustomerRequestById(other, A, season), denied)
    await assert.rejects(products.getAdminProductById(other, season, 'P001'), denied)
  }
  assert.equal(db.calls, 0)
})

test('raw enabled ownership-validation helpers cannot silently no-op', async () => {
  const db = bindAdminServiceMode(bomb(), { ADMIN_LOCATION_MODE: true })
  await assert.rejects(validateTransactionCatalogueReferences(db, items), denied)
  await assert.rejects(validateScopedQuotation(db, { id: 'q-a' }, A), denied)
  await assert.rejects(validateScopedRequest(db, { id: A }), denied)
  assert.equal(db.calls, 0)
})

test('scoped nested helpers retain validated authority but reject explicit downgrade or tenant/season switches', async () => {
  const db = fixture(), { context } = await attach(db)
  const scoped = customerRequestDb(db, season, context)
  assert.equal(customerRequestDb(scoped), scoped)
  assert.ok(await quotations.getQuotationById(scoped, 'q-a'))
  for (const bad of [null, {}, { locationModeEnabled: false }, { locationModeEnabled: true }]) assert.throws(() => customerRequestDb(scoped, season, bad), denied)
  const other = structuredClone(context), loc = other.locationContext
  loc.activeLocationId = 'loc-b'; loc.location.id = 'loc-b'; loc.locationMembership.locationId = 'loc-b'; loc.association.locationId = 'loc-b'
  assert.throws(() => customerRequestDb(scoped, season, other), denied)
  const old = await attach(db, { operatingSeason: previous })
  assert.throws(() => customerRequestDb(scoped, previous, old.context), denied)
  assert.throws(() => scoped.prepare('UPDATE customer_requests SET status = ? WHERE id = ?').bind('closed', A), /read-only/)
})

test('same-location catalogue pricing retains historical provenance across authorized seasons', async () => {
  const db = fixture()
  for (const operatingSeason of [season, previous]) {
    const { context } = await attach(db, { operatingSeason })
    assert.deepEqual(adminCatalogueScope(db, operatingSeason, context), {
      column: 'location_id', value: 'loc-a', locationId: 'loc-a', seasonId: operatingSeason,
    })
    assert.equal((await previewQuickBill(db, items, { seasonId: operatingSeason, context })).preview.totalPaise, 10000)
  }
  assert.equal(db.state.products[0].season_id, previous)
})

test('explicit OFF returns the same DB and preserves original season SQL and optional legacy lookups', async () => {
  const db = bindAdminServiceMode(fixture(), {})
  assert.equal(customerRequestDb(db), db)
  assert.deepEqual(adminCatalogueScope(db, season), { column: 'season_id', value: season, locationId: null, seasonId: season })
  assert.ok(await requests.getAdminCustomerRequestById(db, A))
  assert.ok(await quotations.getQuotationById(db, 'q-b'))
  assert.ok(db.calls.every(c => !/location_id|location_members|business_locations/.test(c.sql)))
  assert.ok(db.calls.some(c => /FROM customer_requests WHERE id = \?$/.test(c.sql)))
  assert.throws(() => adminCatalogueScope(db, season, { locationModeEnabled: true }), denied)
})

test('the product reference counter cannot be called as an exported unscoped operational service', () => {
  assert.equal(Object.hasOwn(products, 'countProductReferenceRows'), false)
})
