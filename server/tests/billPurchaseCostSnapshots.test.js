import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { workflowDb, purchaseCostMigration } from './helpers/workflowSqlite.js'
import { attachAdminRequestContext, getAdminContext } from '../src/middleware/requireAdmin.js'
import { handleAdminQuickBillRoutes } from '../src/routes/adminQuickBill.js'
import { handleAdminCustomerRequestRoutes } from '../src/routes/adminCustomerRequests.js'
import { handleAdminQuotationRoutes } from '../src/routes/adminQuotations.js'
import { handleAdminPaymentRoutes } from '../src/routes/adminPayments.js'
import { handleAdminOfflineRoutes } from '../src/routes/adminOfflineSync.js'
import { customerRequestDb } from '../src/lib/adminCustomerRequestScope.js'

const season = 'season-2026'
const revision = async (db, id) => (await db.prepare('SELECT revision FROM customer_requests WHERE id = ?').bind(id).first()).revision
async function api(db, path, { actor = 'owner', location = 'loc-a', selectedSeason = season, method = 'GET', body, rev, key = 'cost-checkout' } = {}) {
  const request = new Request('https://example.test/api/admin/' + path, { method, headers: {
    'Content-Type': 'application/json', 'X-Admin-Location-Id': location, 'X-Admin-Season-Id': selectedSeason,
    'Idempotency-Key': key, ...(rev == null ? {} : { 'If-Match': String(rev) }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const identity = { userId: actor, email: actor + '@test.com' }
  const access = await attachAdminRequestContext(request, db, identity, { ADMIN_LOCATION_MODE: true })
  if (!access.ok) return Response.json(access, { status: access.status })
  if (path.startsWith('quick-bill/')) return handleAdminQuickBillRoutes(request, { DB: db }, identity)
  if (path.startsWith('offline/')) return handleAdminOfflineRoutes(request, { DB: db }, identity)
  if (path.endsWith('/quotation')) return handleAdminQuotationRoutes(request, { DB: db }, new URL(request.url), identity)
  if (path.endsWith('/payments')) return handleAdminPaymentRoutes(request, { DB: db })
  return handleAdminCustomerRequestRoutes(request, { DB: db }, new URL(request.url), identity)
}
async function checkout(db, items = [{ productId: 'P001', quantity: 2 }], key = 'cost-checkout') {
  const response = await api(db, 'quick-bill/checkout', { method: 'POST', key, body: {
    customer: { name: 'Cost fixture', mobile: '9876543210' }, items, pricingMode: 'bargain', acceptedAmountPaise: 17000,
  } })
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  return (await response.json()).request.id
}
async function close(db, id, options = {}) {
  return api(db, `customer-requests/${id}/finalize`, { method: 'PATCH', rev: await revision(db, id), ...options })
}
async function summary(db, id, options = {}) {
  const response = await api(db, `customer-requests/${id}/quotation`, options)
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
  return (await response.json()).quotation.internalFinancialSummary
}
const snapshots = async (db, id) => (await db.prepare('SELECT * FROM bill_item_purchase_costs WHERE request_id = ? ORDER BY quotation_item_id').bind(id).all()).results
async function rate(db, amount = 5000) {
  await db.prepare(`INSERT INTO product_purchase_rates(product_id,unit_rate_paise,effective_from,season_id,location_id)
    VALUES('P001',?,'2026-01-01',?,'loc-a')`).bind(amount, season).run()
}

test('finalization captures authoritative line costs and freezes profit on the bill due, without changing payments', async t => {
  const db = await workflowDb(t)
  await rate(db)
  const id = await checkout(db)
  assert.equal((await snapshots(db, id)).length, 0)
  await db.prepare('UPDATE product_purchase_rates SET unit_rate_paise = ? WHERE product_id = ?').bind(6001, 'P001').run()
  assert.equal((await close(db, id, { actor: 'super' })).status, 200)
  const [row] = await snapshots(db, id)
  assert.equal(row.business_id, 'shop'); assert.equal(row.location_id, 'loc-a'); assert.equal(row.season_id, season)
  assert.equal(row.purchase_unit_paise, 6001); assert.equal(row.purchase_line_paise, 12002)
  assert.equal(row.quantity, 2); assert.ok(row.request_line_id); assert.ok(row.captured_at); assert.ok(row.source_purchase_rate_id)
  let financial = await summary(db, id)
  assert.equal(financial.basis, 'finalization_purchase_snapshot'); assert.equal(financial.available, true)
  assert.equal(financial.purchaseSubtotalPaise, 12002); assert.equal(financial.profitPaise, 4998, '17000 agreed due, not 20000 quotation or reference')
  const before = await db.prepare('SELECT * FROM request_payment_summaries WHERE request_id = ?').bind(id).first()
  assert.equal(before.amount_due_paise, 17000); assert.equal(before.received_paise, 0); assert.equal(before.outstanding_paise, 17000)
  await db.prepare('UPDATE product_purchase_rates SET unit_rate_paise = ? WHERE product_id = ?').bind(9900, 'P001').run()
  assert.deepEqual(await summary(db, id), financial)
  const paid = await api(db, `customer-requests/${id}/payments`, { method: 'POST', rev: await revision(db, id), body: {
    operationId: 'snapshot-payment-1', entryType: 'PAYMENT', amountPaise: 3000, recordingMode: 'ONLINE', paymentMethod: 'CASH',
  } })
  assert.equal(paid.status, 201)
  assert.equal((await paid.json()).summary.outstandingPaise, 14000)
  financial = await summary(db, id)
  assert.equal(financial.profitPaise, 4998, 'receipts do not alter finalized gross profit')
  assert.deepEqual(await snapshots(db, id), [row])
})

test('loose-unit snapshots use the saved pack divisor and integer-paise floor, including zero purchase cost', async t => {
  const db = await workflowDb(t)
  await rate(db, 10005)
  const id = await checkout(db, [{ productId: 'P001', quantity: 3, unitType: 'piece' }])
  await db.prepare('UPDATE products SET pieces_per_pack = ? WHERE id = ?').bind(20, 'P001').run()
  assert.equal((await close(db, id)).status, 200)
  const [row] = await snapshots(db, id)
  assert.equal(row.pieces_per_pack, 10); assert.equal(row.purchase_unit_paise, 1000); assert.equal(row.purchase_line_paise, 3000)
  await db.prepare('UPDATE product_purchase_rates SET unit_rate_paise = ? WHERE product_id = ?').bind(0, 'P001').run()
  const second = await checkout(db, undefined, 'zero-cost-checkout')
  assert.equal((await close(db, second)).status, 200)
  assert.equal((await summary(db, second)).purchaseSubtotalPaise, 0)
})

test('snapshot UPDATE DELETE and REPLACE are rejected and finalization retries cannot duplicate or refresh costs', async t => {
  const db = await workflowDb(t)
  await rate(db)
  const id = await checkout(db)
  const initialRevision = await revision(db, id)
  assert.equal((await close(db, id)).status, 200)
  const original = await snapshots(db, id)
  await assert.rejects(db.prepare('UPDATE bill_item_purchase_costs SET purchase_unit_paise = 1 WHERE request_id = ?').bind(id).run(), /immutable/)
  await assert.rejects(db.prepare('DELETE FROM bill_item_purchase_costs WHERE request_id = ?').bind(id).run(), /immutable/)
  await assert.rejects(db.prepare('INSERT OR REPLACE INTO bill_item_purchase_costs SELECT * FROM bill_item_purchase_costs WHERE request_id = ?').bind(id).run(), /scope_or_duplicate/)
  await db.prepare('UPDATE product_purchase_rates SET unit_rate_paise = ? WHERE product_id = ?').bind(1, 'P001').run()
  const retries = await Promise.all([close(db, id), close(db, id, { rev: initialRevision }), close(db, id)])
  assert.ok(retries.every(response => response.status === 200))
  assert.deepEqual(await snapshots(db, id), original)
  assert.equal((await db.prepare('SELECT count(*) n FROM request_payment_accounts WHERE request_id = ?').bind(id).first()).n, 1)
})

test('old finalized bills receive no retroactive cost snapshot and return unavailable despite current rates', async t => {
  const db = await workflowDb(t, { purchaseCosts: false })
  await rate(db)
  const id = await checkout(db)
  assert.equal((await close(db, id)).status, 200)
  const before = await db.prepare('SELECT * FROM request_payment_summaries WHERE request_id = ?').bind(id).first()
  await db.script(purchaseCostMigration)
  assert.deepEqual(await snapshots(db, id), [])
  const result = await summary(db, id)
  assert.equal(result.available, false); assert.equal(result.unavailableReason, 'historical_cost_unavailable')
  assert.equal(result.profitPaise, null); assert.equal(result.purchaseSubtotalPaise, null)
  assert.equal((await close(db, id)).status, 200)
  assert.deepEqual(await snapshots(db, id), [])
  assert.deepEqual(await db.prepare('SELECT * FROM request_payment_summaries WHERE request_id = ?').bind(id).first(), before)
})

test('missing purchase costs stay unknown after a later rate import; unsafe costs never break finalization', async t => {
  const db = await workflowDb(t)
  const id = await checkout(db)
  assert.equal((await close(db, id)).status, 200)
  assert.equal((await snapshots(db, id))[0].unavailable_reason, 'missing_purchase_rate')
  await rate(db)
  assert.equal((await summary(db, id)).profitPaise, null)
  await db.prepare('UPDATE product_purchase_rates SET unit_rate_paise = ? WHERE product_id = ?').bind(Number.MAX_SAFE_INTEGER, 'P001').run()
  const second = await checkout(db, undefined, 'unsafe-cost-checkout')
  assert.equal((await close(db, second)).status, 200)
  assert.equal((await snapshots(db, second))[0].unavailable_reason, 'unsafe_cost')
  assert.equal((await summary(db, second)).profitPaise, null)
})

test('mixed known and missing lines capture separately and never report a partial total as historical profit', async t => {
  const db = await workflowDb(t)
  await rate(db)
  await db.script(`INSERT INTO products(id,category_slug,name,selling_price_paise,final_price_paise,season_id,location_id)
    VALUES('P003','cat-a','Unknown cost',8000,7000,'season-2026','loc-a');`)
  const id = await checkout(db, [{ productId: 'P001', quantity: 1 }, { productId: 'P003', quantity: 1 }])
  assert.equal((await close(db, id)).status, 200)
  const rows = await snapshots(db, id)
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.bill_line_count === 2))
  assert.equal(new Set(rows.map(row => row.quotation_item_id)).size, 2)
  assert.equal(new Set(rows.map(row => row.request_line_id)).size, 2)
  assert.equal(rows.find(row => row.product_id === 'P001').purchase_line_paise, 5000)
  assert.equal(rows.find(row => row.product_id === 'P003').unavailable_reason, 'missing_purchase_rate')
  const result = await summary(db, id)
  assert.equal(result.available, false); assert.equal(result.purchaseSubtotalPaise, null); assert.equal(result.profitPaise, null)
})

test('snapshot failure rolls back finalization, payment account and workflow events atomically', async t => {
  const db = await workflowDb(t)
  const id = await checkout(db)
  const before = await db.prepare('SELECT status,finalization_status,revision FROM customer_requests WHERE id = ?').bind(id).first()
  const events = await db.prepare('SELECT count(*) n FROM request_workflow_events WHERE request_id = ?').bind(id).first()
  await db.script("CREATE TRIGGER fail_cost_capture BEFORE INSERT ON bill_item_purchase_costs BEGIN SELECT RAISE(ABORT,'injected_cost_failure'); END;")
  await assert.rejects(close(db, id), /injected_cost_failure/)
  assert.deepEqual(await db.prepare('SELECT status,finalization_status,revision FROM customer_requests WHERE id = ?').bind(id).first(), before)
  assert.deepEqual(await db.prepare('SELECT count(*) n FROM request_workflow_events WHERE request_id = ?').bind(id).first(), events)
  assert.equal((await db.prepare('SELECT count(*) n FROM request_payment_accounts WHERE request_id = ?').bind(id).first()).n, 0)
  assert.deepEqual(await snapshots(db, id), [])
})

test('Admin cannot finalize or read costs; other authorized stalls and seasons cannot read snapshot rows', async t => {
  const db = await workflowDb(t)
  await rate(db)
  const id = await checkout(db)
  assert.equal((await close(db, id, { actor: 'admin' })).status, 403)
  assert.deepEqual(await snapshots(db, id), [])
  assert.equal((await close(db, id)).status, 200)
  assert.equal(await summary(db, id, { actor: 'admin' }), undefined)
  await db.script(`INSERT INTO location_members VALUES('loc-b','season-2026','owner','owner',NULL);
    INSERT INTO business_seasons(id,code,label,status) VALUES('season-other','other','Other','active');
    INSERT INTO season_members(season_id,admin_user_id,role) VALUES('season-other','owner','owner');
    INSERT INTO location_seasons VALUES('loc-a','season-other',2027,'active');
    INSERT INTO location_members VALUES('loc-a','season-other','owner','owner',NULL);`)
  assert.equal((await api(db, `customer-requests/${id}/quotation`, { location: 'loc-b' })).status, 404)
  for (const [location, selectedSeason] of [['loc-b', season], ['loc-a', 'season-other']]) {
    const request = new Request('https://example.test/api/admin/customer-requests', { headers: { 'X-Admin-Location-Id': location, 'X-Admin-Season-Id': selectedSeason } })
    assert.equal((await attachAdminRequestContext(request, db, { userId: 'owner', email: 'owner@test.com' }, { ADMIN_LOCATION_MODE: true })).ok, true)
    const scoped = customerRequestDb(db, selectedSeason, getAdminContext(request))
    const result = await scoped.prepare('SELECT s.* FROM bill_item_purchase_costs s WHERE s.request_id = ?').bind(id).all()
    assert.deepEqual(result.results, [])
  }
})

test('membership demotion immediately before commit rejects snapshot creation and closure', async t => {
  const db = await workflowDb(t), id = await checkout(db)
  const batch = db.batch
  db.batch = async statements => {
    if (statements.some(statement => statement.sql.includes("SET finalization_status = 'finalized'"))) {
      db.batch = batch
      await db.prepare("UPDATE location_members SET role = 'admin' WHERE admin_user_id = 'owner'").bind().run()
    }
    return batch(statements)
  }
  const response = await close(db, id)
  assert.equal(response.status, 403)
  assert.deepEqual(await snapshots(db, id), [])
  assert.equal((await db.prepare('SELECT finalization_status FROM customer_requests WHERE id = ?').bind(id).first()).finalization_status, 'pending')
})

test('offline CLOSE snapshots commit with the receipt once and replay leaves them unchanged', async t => {
  const db = await workflowDb(t)
  await db.script(readFileSync(new URL('../database/migrations/0023_offline_sync_receipts.sql', import.meta.url), 'utf8'))
  await rate(db, 4000)
  const id = await checkout(db)
  const scope = { businessId: 'shop', locationId: 'loc-a', seasonId: season, userId: 'owner', deviceId: 'cost-device-1' }
  const deviceToken = 'ab'.repeat(32)
  assert.equal((await api(db, 'offline/devices', { method: 'POST', body: { deviceId: scope.deviceId, deviceToken } })).status, 200)
  const operation = { operationId: 'cost-offline-close-1', scope, deviceToken, occurredAt: '2026-11-01T12:00:00.000Z',
    kind: 'CLOSE', requestId: id, expectedRevision: await revision(db, id), body: {} }
  assert.equal((await api(db, 'offline/sync', { method: 'POST', body: operation })).status, 200)
  const captured = await snapshots(db, id)
  assert.equal(captured[0].purchase_line_paise, 8000)
  await db.prepare('UPDATE product_purchase_rates SET unit_rate_paise = ? WHERE product_id = ?').bind(99, 'P001').run()
  const replay = await api(db, 'offline/sync', { method: 'POST', body: operation })
  assert.equal(replay.status, 200); assert.equal((await replay.json()).idempotentReplay, true)
  assert.equal((await db.prepare('SELECT count(*) n FROM offline_sync_receipts WHERE operation_id = ?').bind(operation.operationId).first()).n, 1)
  assert.deepEqual(await snapshots(db, id), captured)
  assert.equal((await summary(db, id)).profitPaise, 9000)
})

test('supported Family Pack finalization records an unknown cost without inferring component purchase prices', async t => {
  const db = await workflowDb(t)
  await db.script(readFileSync(new URL('../database/migrations/0023_offline_sync_receipts.sql', import.meta.url), 'utf8'))
  await rate(db)
  await db.script(`INSERT INTO family_packs(id,slug,name,selling_price_paise,active,season_id,location_id)
    VALUES('FP001','cost-pack','Cost pack',20000,1,'season-2026','loc-a');
    INSERT INTO family_pack_items(family_pack_id,product_id,quantity,unit_label) VALUES('FP001','P001',2,'box');`)
  const scope = { businessId: 'shop', locationId: 'loc-a', seasonId: season, userId: 'owner', deviceId: 'pack-cost-device-1' }
  const deviceToken = 'ab'.repeat(32)
  assert.equal((await api(db, 'offline/devices', { method: 'POST', body: { deviceId: scope.deviceId, deviceToken } })).status, 200)
  const catalogue = await (await api(db, 'offline/catalogue')).json()
  const pack = catalogue.familyPacks[0]
  assert.ok(pack, JSON.stringify(catalogue.familyPackIssues))
  const created = await api(db, 'offline/sync', { method: 'POST', body: {
    operationId: 'pack-cost-create-1', scope, deviceToken, occurredAt: '2026-11-01T12:00:00.000Z', kind: 'CREATE',
    catalogue: catalogue.products,
    lineSnapshots: [{ lineId: crypto.randomUUID(), familyPackId: pack.familyPackId, productName: pack.name,
      quantity: 1, unitType: 'box', packSnapshot: pack, sellingUnitPaise: pack.sellingUnitPaise }],
    body: { customer: { name: 'Pack customer', mobile: '9876543210' }, items: [{ familyPackId: 'FP001', quantity: 1 }],
      pricingMode: 'bargain', acceptedAmountPaise: 17000 },
  } })
  assert.equal(created.status, 200, JSON.stringify(await created.clone().json()))
  const id = (await created.json()).requestId
  assert.equal((await close(db, id)).status, 200)
  const [row] = await snapshots(db, id)
  assert.equal(row.unavailable_reason, 'unsupported_family_pack'); assert.equal(row.purchase_line_paise, null)
  assert.equal((await summary(db, id)).profitPaise, null)
})
