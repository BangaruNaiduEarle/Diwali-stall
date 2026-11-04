import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture, season, A, B } from './helpers/mockAdminTransactionDb.js'
import { attachAdminRequestContext } from '../src/middleware/requireAdmin.js'
import { handleAdminCustomerRequestRoutes } from '../src/routes/adminCustomerRequests.js'
import { handleAdminQuickBillRoutes } from '../src/routes/adminQuickBill.js'
import { handleAdminQuotationRoutes } from '../src/routes/adminQuotations.js'
import { handleAdminUsersRoutes } from '../src/routes/adminUsersRoutes.js'
import { LIST_SEASON_ASSIGNEES_SQL } from '../src/services/adminUsersManagement.js'
import { locationMembersDb, lmKey, smKey } from './helpers/mockLocationMembersDb.js'
import { addProductToCart, removeCartLine, setCartLineQuantity, cartToCheckoutItems } from '../../src/admin/lib/quickBillCart.js'

async function api(db, path, method, payload, mode, handler = handleAdminCustomerRequestRoutes) {
  const request = new Request('https://example.test/api/admin/' + path, {
    method, headers: { 'X-Admin-Season-Id': season, 'X-Admin-Location-Id': 'loc-a', 'Content-Type': 'application/json', 'If-Match': '0' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  })
  const identity = { userId: 'u-1', email: 'owner@test.com', role: 'owner' }
  const attached = await attachAdminRequestContext(request, db, identity, { ADMIN_LOCATION_MODE: mode })
  assert.equal(attached.ok, true)
  if (handler === handleAdminQuickBillRoutes) return handler(request, { DB: db }, identity)
  if (handler === handleAdminUsersRoutes) return handler(request, { DB: db }, { identity })
  return handler(request, { DB: db }, new URL(request.url), identity)
}

for (const mode of [false, true]) {
  test(`Admin cannot close or finalize by direct API; reviewing remains allowed (location mode ${mode})`, async () => {
    const db = fixture()
    db.state.seasonRole = mode ? 'owner' : 'admin'; db.state.locationRole = 'admin'
    const before = structuredClone(db.state)
    for (const [action, payload] of [['status', { status: 'closed' }], ['finalize', {}], ['status', { status: 'finalized' }]]) {
      const response = await api(db, `customer-requests/${A}/${action}`, 'PATCH', payload, mode)
      assert.ok([400, 403].includes(response.status))
      assert.deepEqual(db.state, before)
    }
    assert.equal((await api(db, `customer-requests/${A}/status`, 'PATCH', { status: 'reviewing' }, mode)).status, 200)
  })

  for (const role of ['owner', 'super_admin']) {
    test(`${role} retains dedicated finalization and agreed-amount validation (location mode ${mode})`, async () => {
      const db = fixture()
      db.state.seasonRole = role; db.state.locationRole = role
      db.state.quotations[0].accepted_amount_paise = null
      assert.equal((await api(db, `customer-requests/${A}/finalize`, 'PATCH', {}, mode)).status, 400)
      db.state.quotations[0].accepted_amount_paise = 10000
      assert.equal((await api(db, `customer-requests/${A}/finalize`, 'PATCH', {}, mode)).status, 200)
      assert.equal(db.state.customer_requests[0].finalization_status, 'finalized')
    })
  }

  for (const recipientRole of ['admin', 'owner', 'super_admin']) {
    test(`direct assignment to ${recipientRole} recipient (location mode ${mode})`, async () => {
      const db = fixture()
      db.state.seasonRole = 'admin'; db.state.locationRole = 'admin'
      db.state.assigneeSeason.role = recipientRole; db.state.assigneeLocation.role = recipientRole
      const response = await api(db, `customer-requests/${A}/assign`, 'PATCH', { assigneeUserId: 'assignee' }, mode)
      assert.equal(response.status, recipientRole === 'admin' ? 400 : 200)
      assert.equal(db.state.customer_requests[0].assigned_to_email ?? null, recipientRole === 'admin' ? null : 'staff@test.com')
    })
  }

  test(`Admin cart editing and safe preview work; bargain/agreed amount and private audit remain restricted (location mode ${mode})`, async () => {
    const db = fixture()
    db.state.seasonRole = 'admin'; db.state.locationRole = 'admin'
    if (!mode) db.state.products[0].season_id = season
    let cart = addProductToCart([], { productId: 'P001', name: 'Product' })
    cart = addProductToCart(cart, { productId: 'P002', name: 'Other' })
    cart = removeCartLine(cart, 'P002')
    cart = setCartLineQuantity(cart, 'P001', 3)
    const payload = { items: cartToCheckoutItems(cart) }
    assert.equal(payload.items[0].quantity, 3)
    const response = await api(db, 'quick-bill/preview', 'POST', payload, mode, handleAdminQuickBillRoutes)
    assert.equal(response.status, 200)
    const preview = (await response.json()).preview
    assert.equal(preview.totalPaise, 30000)
    for (const key of ['finalSubtotalPaise', 'bargainFloorPaise', 'acceptedAmountPaise', 'purchaseRatePaise', 'profitPaise', 'marginPaise']) assert.equal(Object.hasOwn(preview, key), false, key)
    assert.equal((await api(db, 'quick-bill/preview', 'POST', { ...payload, pricingMode: 'bargain' }, mode, handleAdminQuickBillRoutes)).status, 403)
    assert.equal((await api(db, `customer-requests/${A}/quotation/customer-agreed-amount`, 'PATCH', { acceptedAmountInr: 1 }, mode, handleAdminQuotationRoutes)).status, 403)
    const detail = await api(db, `customer-requests/${A}`, 'GET', undefined, mode)
    assert.equal(detail.status, 200)
    const json = await detail.json()
    assert.equal(Object.hasOwn(json.request, 'internalPricingView'), false)
    for (const key of ['internalPricingPreview', 'finalSubtotalPaise', 'bargainFloorPaise']) assert.equal(Object.hasOwn(json.quotation ?? {}, key), false, key)
  })
}

test('location assignment rejects a recipient with Admin authority in either membership', async () => {
  for (const [seasonRole, locationRole] of [['owner', 'admin'], ['admin', 'owner']]) {
    const db = fixture()
    db.state.assigneeSeason.role = seasonRole; db.state.assigneeLocation.role = locationRole
    assert.equal((await api(db, `customer-requests/${A}/assign`, 'PATCH', { assigneeUserId: 'assignee' }, true)).status, 400)
    assert.equal(db.state.customer_requests[0].assigned_to_email ?? null, null)
  }
})

test('privileged assignment/finalization cannot target another location', async () => {
  const db = fixture()
  db.state.assigneeSeason.role = 'owner'; db.state.assigneeLocation.role = 'owner'
  for (const [action, payload] of [['assign', { assigneeUserId: 'assignee' }], ['finalize', {}]]) {
    assert.equal((await api(db, `customer-requests/${B}/${action}`, 'PATCH', payload, true)).status, 404)
  }
})

test('Admin assignee picker lists only Owner/Super Admin season recipients', async () => {
  const db = fixture(), prepare = db.prepare
  db.state.seasonRole = 'admin'
  db.prepare = sql => sql === LIST_SEASON_ASSIGNEES_SQL
    ? { bind: () => ({ all: async () => ({ results: ['admin', 'owner', 'super_admin'].map(role => ({ id: role, email: role + '@test.com', role })) }) }) }
    : prepare(sql)
  const response = await api(db, 'users/assignees', 'GET', undefined, false, handleAdminUsersRoutes)
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).users.map(user => user.role), ['owner', 'super_admin'])
})

test('location assignee picker requires privileged season AND location authority', async () => {
  for (const [seasonRole, locationRole] of [['owner', 'admin'], ['admin', 'owner'], ['super_admin', 'owner']]) {
    const db = locationMembersDb()
    db.state.seasonMembers.get(smKey('super')).role = seasonRole
    db.state.locationMembers.get(lmKey('super')).role = locationRole
    const request = new Request('https://example.test/api/admin/users/assignees', {
      headers: { 'X-Admin-Season-Id': season, 'X-Admin-Location-Id': 'loc-a' },
    })
    const identity = { userId: 'staff', email: 'staff@test.com' }
    assert.equal((await attachAdminRequestContext(request, db, identity, { ADMIN_LOCATION_MODE: true })).ok, true)
    const response = await handleAdminUsersRoutes(request, { DB: db }, { identity })
    assert.equal(response.status, 200)
    const users = (await response.json()).users
    assert.equal(users.some(user => user.id === 'super'), seasonRole !== 'admin' && locationRole !== 'admin')
    assert.ok(users.every(user => ['owner', 'super_admin'].includes(user.role)))
    assert.ok(!users.some(user => user.id === 'other'))
  }
})
