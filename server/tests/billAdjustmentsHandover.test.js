import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workflowDb } from './helpers/workflowSqlite.js'
import { attachAdminRequestContext } from '../src/middleware/requireAdmin.js'
import { handleAdminQuickBillRoutes } from '../src/routes/adminQuickBill.js'
import { handleAdminCustomerRequestRoutes } from '../src/routes/adminCustomerRequests.js'
import { handleAdminQuotationRoutes } from '../src/routes/adminQuotations.js'

const customer = { name: 'Guest', mobile: '9876543210' }, items = [{ productId: 'P001', quantity: 2 }]
async function api(db, path, { actor = 'admin', method = 'GET', body, revision, key = 'step4-checkout', location = 'loc-a' } = {}) {
  const request = new Request('https://example.test/api/admin/' + path, { method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Season-Id': 'season-2026', 'X-Admin-Location-Id': location, 'Idempotency-Key': key, ...(revision == null ? {} : { 'If-Match': String(revision) }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const identity = { userId: actor, email: actor + '@test.com' }
  const attached = await attachAdminRequestContext(request, db, identity, { ADMIN_LOCATION_MODE: true })
  if (!attached.ok) return Response.json(attached, { status: attached.status })
  if (path.startsWith('quick-bill')) return handleAdminQuickBillRoutes(request, { DB: db }, identity)
  if (/\/quotation(?:\/|$)/.test(path)) return handleAdminQuotationRoutes(request, { DB: db }, new URL(request.url), identity)
  return handleAdminCustomerRequestRoutes(request, { DB: db }, new URL(request.url), identity)
}
const revision = async (db, id) => (await db.prepare('SELECT revision FROM customer_requests WHERE id = ?').bind(id).first()).revision
async function create(db, body = {}, options = {}) {
  const response = await api(db, 'quick-bill/checkout', { method: 'POST', body: { customer, items, ...body }, ...options })
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  return (await response.json()).request.id
}
async function adjust(db, id, body, actor = 'admin', rev) {
  return api(db, `customer-requests/${id}/adjust-bill`, { method: 'PATCH', body, actor, revision: rev ?? await revision(db, id) })
}
const quote = async (db, id, actor = 'admin') => (await (await api(db, `customer-requests/${id}/quotation`, { actor })).json()).quotation

test('Admin changes saved request products/quantities while prices, discounts and privileged operations stay protected', async t => {
  const db = await workflowDb(t), id = await create(db)
  await db.script(`INSERT INTO products(id,category_slug,name,selling_price_paise,final_price_paise,season_id,location_id) VALUES('P003','cat-a','New product',5000,4000,'season-2026','loc-a');`)
  assert.equal((await adjust(db, id, { items: [...items, { productId: 'P003', quantity: 1 }] })).status, 200)
  assert.equal((await adjust(db, id, { items: [{ productId: 'P003', quantity: 3 }] })).status, 200)
  assert.equal((await quote(db, id)).totalPaise, 15000)
  for (const body of [{ items, discountPaise: 100 }, { items: [{ ...items[0], unitRatePaise: 1 }] }, { items, acceptedAmountInr: '1' }]) {
    assert.equal((await adjust(db, id, body)).status, 403)
  }
  assert.equal((await api(db, `customer-requests/${id}/finalize`, { method: 'PATCH' })).status, 403)
  assert.equal((await api(db, `customer-requests/${id}/adjust-bill`, { method: 'PATCH', body: { items } })).status, 428)
})

for (const actor of ['owner', 'super']) test(`${actor} adjusts customer selling prices and discounts without changing catalogue snapshots`, async t => {
  const db = await workflowDb(t), id = await create(db)
  let response = await adjust(db, id, { items: [{ productId: 'P001', quantity: 2, unitRatePaise: 12000 }], discountPaise: 1500 }, actor)
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
  const adjusted = await quote(db, id)
  assert.equal(adjusted.items[0].unitRatePaise, 12000); assert.equal(adjusted.subtotalPaise, 24000)
  assert.equal(adjusted.adjustmentPaise, -1500); assert.equal(adjusted.totalPaise, 22500)
  const line = await db.prepare('SELECT * FROM customer_request_items WHERE request_id = ?').bind(id).first()
  assert.equal(line.unit_price_paise, 10000)
  assert.equal(JSON.parse(line.product_details_json).billing.catalogueUnitPaise, 10000)
  await db.prepare('UPDATE products SET selling_price_paise = ? WHERE id = ?').bind(99000, 'P001').run()
  response = await adjust(db, id, { items: [{ productId: 'P001', quantity: 3 }] })
  assert.equal(response.status, 200)
  const after = await quote(db, id)
  assert.equal(after.items[0].unitRatePaise, 12000); assert.equal(after.totalPaise, 34500)
  assert.equal((await db.prepare('SELECT unit_price_paise FROM customer_request_items WHERE request_id = ?').bind(id).first()).unit_price_paise, 10000)
  const history = await (await api(db, `customer-requests/${id}/history`, { actor: 'owner' })).json()
  assert.ok(history.events.some(event => event.changes.after?.productDetails?.billing?.sellingUnitPaise === 12000))
})

test('financial validation rejects unsafe prices, negative/excess discounts and aliases', async t => {
  const db = await workflowDb(t), id = await create(db)
  for (const body of [{ items, discountPaise: -1 }, { items, discountPaise: 20001 }, { items, discountPaise: 0.5 }, { items: [{ ...items[0], unitRatePaise: 0 }] }, { items: [{ ...items[0], unitRatePaise: Number.MAX_SAFE_INTEGER }] }, { items, sellingPriceInr: 1 }]) assert.equal((await adjust(db, id, body, 'owner')).status, 400)
  assert.equal((await adjust(db, id, { items: { some: 1 } }, 'owner')).status, 400)
})

test('purchase subtotal estimate is returned only for privileged authority; reference never changes the bill', async t => {
  const db = await workflowDb(t), id = await create(db, { pricingMode: 'bargain', acceptedAmountPaise: 17000 }, { actor: 'owner' })
  await db.script(`INSERT INTO product_purchase_rates(product_id,unit_rate_paise,effective_from,season_id,location_id) VALUES('P001',5000,'2026-01-01','season-2026','loc-a');`)
  assert.equal((await adjust(db, id, { items, discountPaise: 1000 }, 'owner')).status, 200)
  const privileged = await quote(db, id, 'owner'), restricted = await quote(db, id)
  assert.equal(privileged.totalPaise, 19000)
  assert.equal(privileged.internalFinancialSummary.purchaseSubtotalPaise, 10000)
  assert.equal(privileged.internalFinancialSummary.profitPaise, undefined)
  assert.equal(privileged.internalFinancialSummary.lines, undefined)
  assert.equal(restricted.internalFinancialSummary, undefined)
  assert.ok(!/purchase|profit|margin/.test(JSON.stringify(restricted)))
  const preview = await api(db, `customer-requests/${id}/adjust-bill/preview`, { method: 'POST', actor: 'owner', body: { items } })
  const json = await preview.json()
  assert.equal(json.preview.bargainFloorPaise, 66000)
  assert.equal(json.preview.totalPaise, 19000)
})

test('checkout and online handover commit atomically and duplicate retries preserve recipient edits', async t => {
  const db = await workflowDb(t), id = await create(db, { assigneeUserId: 'super' })
  const request = await db.prepare('SELECT * FROM customer_requests WHERE id = ?').bind(id).first()
  assert.equal(request.creator_user_id, 'admin'); assert.equal(request.assigned_to_user_id, 'super'); assert.equal(request.assigned_by_user_id, 'admin')
  assert.equal((await adjust(db, id, { items: [{ productId: 'P001', quantity: 2, unitRatePaise: 9000 }] }, 'super')).status, 200)
  const before = await revision(db, id)
  const retry = await api(db, 'quick-bill/checkout', { method: 'POST', body: { customer, items, assigneeUserId: 'super' } })
  assert.equal(retry.status, 201); assert.equal((await retry.json()).request.id, id)
  assert.equal(await revision(db, id), before)
  assert.equal((await quote(db, id)).totalPaise, 18000)
  assert.equal((await api(db, 'quick-bill/checkout', { method: 'POST', body: { customer, items, assigneeUserId: 'owner' } })).status, 409)
})

test('invalid or concurrently revoked handover recipients leave no partial checkout', async t => {
  const db = await workflowDb(t)
  assert.equal((await api(db, 'quick-bill/checkout', { method: 'POST', body: { customer, items, assigneeUserId: 'admin' } })).status, 400)
  const batch = db.batch
  let revoked = false
  db.batch = async statements => {
    if (!revoked) { revoked = true; await db.prepare('UPDATE location_members SET disabled_at = ? WHERE admin_user_id = ?').bind('revoked', 'super').run() }
    return batch(statements)
  }
  assert.equal((await api(db, 'quick-bill/checkout', { method: 'POST', body: { customer, items, assigneeUserId: 'super' } })).status, 503)
  assert.equal((await db.prepare('SELECT count(*) AS count FROM customer_requests').bind().first()).count, 0)
  assert.equal((await db.prepare('SELECT count(*) AS count FROM request_workflow_events').bind().first()).count, 0)
})

test('handover retry is a no-op and stale Admin edits cannot overwrite recipient changes', async t => {
  const db = await workflowDb(t), id = await create(db), oldRevision = await revision(db, id)
  const options = { method: 'PATCH', body: { assigneeUserId: 'super' }, revision: oldRevision }
  assert.equal((await api(db, `customer-requests/${id}/assign`, options)).status, 200)
  assert.equal((await adjust(db, id, { items: [{ productId: 'P001', quantity: 4 }] }, 'super')).status, 200)
  const latest = await revision(db, id)
  assert.equal((await api(db, `customer-requests/${id}/assign`, options)).status, 200)
  assert.equal(await revision(db, id), latest)
  assert.equal((await adjust(db, id, { items }, 'admin', oldRevision)).status, 409)
  const progress = await quote(db, id)
  assert.equal(progress.totalPaise, 40000)
  assert.equal((await api(db, `customer-requests/${id}`, { location: 'loc-b' })).status, 403)
})

test('new handover requires a revision and catalogue edits do not reprice a saved bill', async t => {
  const db = await workflowDb(t), id = await create(db)
  assert.equal((await api(db, `customer-requests/${id}/assign`, { method: 'PATCH', body: { assigneeUserId: 'super' } })).status, 428)
  await db.prepare('UPDATE products SET selling_price_paise = ? WHERE id = ?').bind(99000, 'P001').run()
  assert.equal((await quote(db, id)).totalPaise, 20000)
})

test('Admin adjusts public request items and hands over after agreement without inventing a creator', async t => {
  const db = await workflowDb(t), id = '33333333-3333-4333-8333-333333333333'
  await db.script(`INSERT INTO customer_requests(id,source,status,customer_name,customer_phone,season_id,location_id)
    VALUES('${id}','web','received','Guest','9876543210','season-2026','loc-a');
    INSERT INTO customer_request_items(request_id,line_number,product_id,product_name,quantity,unit_price_paise) VALUES('${id}',1,'P001','Product A',1,10000);`)
  assert.equal((await api(db, `customer-requests/${id}/quotation`, { method: 'POST', body: {} })).status, 201)
  assert.equal((await adjust(db, id, { items: [{ productId: 'P001', quantity: 3 }] })).status, 200)
  assert.equal((await api(db, `customer-requests/${id}/customer-agreed`, { method: 'PATCH', actor: 'owner' })).status, 200)
  assert.equal((await api(db, `customer-requests/${id}/assign`, { method: 'PATCH', body: { assigneeUserId: 'super' }, revision: await revision(db, id) })).status, 200)
  const record = await db.prepare('SELECT creator_user_id, assigned_to_user_id FROM customer_requests WHERE id = ?').bind(id).first()
  assert.equal(record.creator_user_id, null); assert.equal(record.assigned_to_user_id, 'super')
})

test('financial responses honor lesser location authority and exclude foreign purchase-rate rows', async t => {
  const db = await workflowDb(t), id = await create(db)
  await db.script(`INSERT INTO product_purchase_rates(product_id,unit_rate_paise,effective_from,season_id,location_id) VALUES('P001',999,'2026-01-01','season-2026','loc-b');`)
  assert.equal((await quote(db, id, 'owner')).internalFinancialSummary.purchaseSubtotalPaise, null)
  await db.prepare("UPDATE location_members SET role = 'admin' WHERE admin_user_id = ?").bind('owner').run()
  assert.equal((await quote(db, id, 'owner')).internalFinancialSummary, undefined)
  assert.equal((await adjust(db, id, { items: [{ ...items[0], unitRatePaise: 1 }] }, 'owner')).status, 403)
})

test('an unverifiable historical locked rate cannot become an Admin-visible selling price through an item edit', async t => {
  const db = await workflowDb(t), id = await create(db)
  await db.prepare('UPDATE customer_request_items SET unit_type = NULL, unit_price_paise = ? WHERE request_id = ?').bind(123, id).run()
  assert.equal((await adjust(db, id, { items })).status, 200)
  const saved = await quote(db, id)
  assert.equal(saved.items[0].unitRatePaise, 10000)
  const original = await db.prepare('SELECT unit_price_paise FROM customer_request_items WHERE request_id = ?').bind(id).first()
  assert.equal(original.unit_price_paise, 123)
})
