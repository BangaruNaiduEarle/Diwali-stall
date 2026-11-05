import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workflowDb } from './helpers/workflowSqlite.js'
import { attachAdminRequestContext } from '../src/middleware/requireAdmin.js'
import { handleAdminCustomerRequestRoutes } from '../src/routes/adminCustomerRequests.js'
import { handleAdminQuickBillRoutes } from '../src/routes/adminQuickBill.js'
import { handleAdminPaymentRoutes } from '../src/routes/adminPayments.js'
import { preferenceAmountToPaise, validateRequestPaymentPreferences } from '../../src/shared/requestPaymentPreferences.js'

async function api(db, path, { method = 'GET', body, actor = 'owner', revision = 0, location = 'loc-a' } = {}) {
  const request = new Request('https://test/api/admin/' + path, { method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Season-Id': 'season-2026',
      'X-Admin-Location-Id': location, 'If-Match': String(revision), 'Idempotency-Key': 'preferences-fixture' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const identity = { userId: actor, email: actor + '@test.com' }
  const attached = await attachAdminRequestContext(request, db, identity, { ADMIN_LOCATION_MODE: true })
  if (!attached.ok) return Response.json(attached, { status: attached.status })
  if (path.startsWith('quick-bill')) return handleAdminQuickBillRoutes(request, { DB: db }, identity)
  if (path.endsWith('/payments')) return handleAdminPaymentRoutes(request, { DB: db })
  return handleAdminCustomerRequestRoutes(request, { DB: db }, new URL(request.url), identity)
}
async function fixture(t) {
  const db = await workflowDb(t)
  const result = await api(db, 'quick-bill/checkout', { method: 'POST', body: {
    customer: { name: 'Guest', mobile: '9876543210' }, items: [{ productId: 'P001', quantity: 2 }],
    pricingMode: 'bargain', acceptedAmountPaise: 10000,
  } })
  assert.equal(result.status, 201, JSON.stringify(await result.clone().json()))
  return { db, id: (await result.json()).request.id }
}
const row = (db, id) => db.prepare('SELECT * FROM customer_requests WHERE id = ?').bind(id).first()
const save = async (db, id, body, options = {}) => api(db, `customer-requests/${id}/payment-preferences`, {
  method: 'PATCH', body, revision: (await row(db, id)).revision, ...options,
})
const preferences = (status = 'partial_paid', mode = 'online', receivedAmountPaise = 2500) => ({ status, mode, receivedAmountPaise })

test('preferences persist separately, clear hidden amounts, and never affect ledger, finalization or actual payment duplicates', async t => {
  const { db, id } = await fixture(t)
  const before = await row(db, id)
  const summary = async () => (await (await api(db, `customer-requests/${id}/payments`)).json())
  const originalPayments = await summary()
  for (const body of [preferences(), preferences('paid', 'offline', null), preferences('unpaid', 'online', null)]) {
    const response = await save(db, id, body, { actor: body.status === 'paid' ? 'super' : 'owner' })
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
    assert.deepEqual((await response.json()).request.paymentPreferences, body)
    const fetched = await api(db, `customer-requests/${id}`)
    assert.equal(fetched.status, 200)
    assert.deepEqual((await fetched.json()).request.paymentPreferences, body)
    assert.deepEqual(await summary(), originalPayments)
    const after = await row(db, id)
    assert.equal(after.revision, before.revision)
    assert.equal(after.finalization_status, before.finalization_status)
    assert.equal(after.status, before.status)
  }
  await save(db, id, preferences('paid', 'offline', null))
  const adminDetail = await api(db, `customer-requests/${id}`, { actor: 'admin' })
  assert.equal(adminDetail.status, 200)
  assert.equal((await adminDetail.json()).request.paymentPreferences, undefined)
  const finalized = await api(db, `customer-requests/${id}/finalize`, { method: 'PATCH', body: {}, revision: (await row(db, id)).revision })
  assert.equal(finalized.status, 200, JSON.stringify(await finalized.clone().json()))
  let payments = await summary()
  assert.equal(payments.summary.paymentStatus, 'UNPAID')
  assert.equal(payments.summary.receivedPaise, 0)
  assert.equal(payments.summary.outstandingPaise, 10000)
  assert.equal(payments.entries.length, 0)
  const payment = { operationId: 'actual-payment', entryType: 'PAYMENT', amountPaise: 2500, recordingMode: 'ONLINE', paymentMethod: 'CASH' }
  const first = await api(db, `customer-requests/${id}/payments`, { method: 'POST', body: payment, revision: (await row(db, id)).revision })
  assert.equal(first.status, 201)
  const replay = await api(db, `customer-requests/${id}/payments`, { method: 'POST', body: payment, revision: (await row(db, id)).revision })
  assert.ok([200, 201].includes(replay.status))
  payments = await summary()
  assert.equal(payments.entries.length, 1)
  assert.equal(payments.summary.receivedPaise, 2500)
  assert.equal(payments.summary.outstandingPaise, 7500)
  assert.equal((await save(db, id, preferences())).status, 409)
})

test('server rejects invalid partial amounts, unknown fields, Admins, stale revisions and other stalls without writes', async t => {
  const { db, id } = await fixture(t)
  const before = await row(db, id)
  for (const body of [0, -1, 10000, 10001, 1.5, null, '100'].map(value => preferences('partial_paid', 'online', value))) {
    assert.equal((await save(db, id, body)).status, 400)
  }
  for (const body of [preferences('paid'), preferences('bad'), preferences('unpaid', 'bad', null), { ...preferences(), amountPaise: 2500 }]) {
    assert.equal((await save(db, id, body)).status, 400)
  }
  assert.equal((await save(db, id, preferences(), { actor: 'admin' })).status, 403)
  assert.equal((await save(db, id, preferences(), { revision: before.revision + 1 })).status, 409)
  await db.script("INSERT INTO location_members VALUES('loc-b','season-2026','owner','owner',NULL);")
  assert.equal((await save(db, id, preferences(), { location: 'loc-b' })).status, 404)
  assert.deepEqual(await row(db, id), before)
  await db.prepare('UPDATE quotations SET accepted_amount_paise = NULL WHERE customer_request_id = ?').bind(id).run()
  assert.equal((await save(db, id, preferences())).status, 400)
  await db.script("UPDATE business_seasons SET status = 'archived' WHERE id = 'season-2026';")
  assert.equal((await save(db, id, preferences('unpaid', 'online', null))).status, 403)
})

test('preference currency and validation preserve exact paise and reject invalid inputs', () => {
  assert.equal(preferenceAmountToPaise('12.34'), 1234)
  assert.equal(preferenceAmountToPaise('0.01'), 1)
  for (const value of ['', '1.001', '-1', '1e3', 'Infinity', '999999999999999999']) assert.ok(Number.isNaN(preferenceAmountToPaise(value)))
  assert.equal(validateRequestPaymentPreferences(preferences('partial_paid', 'offline', 1), 2).ok, true)
  assert.equal(validateRequestPaymentPreferences(preferences(), null).ok, false)
})
