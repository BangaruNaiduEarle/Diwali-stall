import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { workflowDb } from './helpers/workflowSqlite.js'
import { attachAdminRequestContext } from '../src/middleware/requireAdmin.js'
import { handleAdminOfflineRoutes } from '../src/routes/adminOfflineSync.js'
import { handleAdminCustomerRequestRoutes } from '../src/routes/adminCustomerRequests.js'
import worker from '../src/index.js'

const migration = readFileSync(new URL('../database/migrations/0023_offline_sync_receipts.sql', import.meta.url), 'utf8')
const scope = { businessId: 'shop', locationId: 'loc-a', seasonId: 'season-2026', userId: 'owner', deviceId: 'offline-device-1' }
const secret = 'ab'.repeat(32), occurredAt = '2026-11-01T12:00:00.000Z'
async function api(db, path, { body, actor = 'owner', location = 'loc-a', method = body ? 'POST' : 'GET', revision } = {}) {
  const request = new Request('https://test.example/api/admin/' + path, { method, headers: {
    'Content-Type': 'application/json', 'X-Admin-Location-Id': location, 'X-Admin-Season-Id': 'season-2026',
    ...(revision == null ? {} : { 'If-Match': String(revision) }),
  }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const identity = { userId: actor, email: actor + '@test.com' }
  const attached = await attachAdminRequestContext(request, db, identity, { ADMIN_LOCATION_MODE: true })
  if (!attached.ok) return Response.json(attached, { status: attached.status })
  return path.startsWith('offline/') ? handleAdminOfflineRoutes(request, { DB: db }, identity)
    : handleAdminCustomerRequestRoutes(request, { DB: db }, new URL(request.url), identity)
}
async function setup(t, actor = 'owner') {
  const db = await workflowDb(t)
  await db.script(migration)
  assert.equal((await api(db, 'offline/devices', { actor, body: { deviceId: scope.deviceId, deviceToken: secret } })).status, 200)
  const catalogue = (await (await api(db, 'offline/catalogue', { actor })).json()).products
  return { db, catalogue }
}
const operation = (operationId, extra = {}) => ({ operationId, scope, deviceToken: secret, occurredAt, kind: 'CREATE',
  body: { customer: { name: 'Offline customer', mobile: '9876543210' }, items: [{ productId: 'P001', quantity: 2 }], pricingMode: 'bargain', acceptedAmountPaise: 10000 }, ...extra })
async function send(db, op, options = {}) { const response = await api(db, 'offline/sync', { body: op, ...options }); return { status: response.status, ...await response.json() } }
async function create(db, catalogue, key = 'offline-create-01', extra = {}) {
  const result = await send(db, operation(key, { catalogue, ...extra }))
  assert.equal(result.status, 200, JSON.stringify(result))
  return result
}

test('offline creation atomically acknowledges one request/bill, preserves occurrence and recovers lost acknowledgements', async t => {
  const { db, catalogue } = await setup(t)
  const input = operation('offline-create-01', { catalogue })
  const first = await create(db, catalogue)
  const repeat = await send(db, input)
  assert.equal(repeat.status, 200); assert.equal(repeat.idempotentReplay, true); assert.equal(repeat.requestId, first.requestId)
  assert.equal((await db.prepare('SELECT count(*) n FROM customer_requests').bind().first()).n, 1)
  assert.equal((await db.prepare('SELECT count(*) n FROM quotations').bind().first()).n, 1)
  const events = (await db.prepare('SELECT * FROM request_workflow_events WHERE request_id = ?').bind(first.requestId).all()).results
  assert.ok(events.every(row => row.device_id === scope.deviceId && row.occurred_at === occurredAt && row.received_at !== occurredAt))
  assert.ok(events.every(row => row.actor_user_id === 'owner'))
  const changed = await send(db, { ...input, body: { ...input.body, acceptedAmountPaise: 9000 } })
  assert.equal(changed.status, 409)
  await assert.rejects(db.prepare('DELETE FROM offline_sync_receipts WHERE operation_id = ?').bind(input.operationId).run(), /append_only/)
})

test('dependent edits, closure and partial offline payments reuse revisions and ledger idempotency', async t => {
  const { db, catalogue } = await setup(t), created = await create(db, catalogue)
  const edit = operation('offline-edit-01', { kind: 'EDIT', parentOperationId: created.operationId, catalogue,
    body: { items: [{ productId: 'P001', quantity: 3 }], acceptedAmountInr: '100.00' } })
  const edited = await send(db, edit)
  assert.equal(edited.status, 200, JSON.stringify(edited)); assert.ok(edited.revision > created.revision)
  const close = operation('offline-close-01', { kind: 'CLOSE', parentOperationId: edited.operationId, body: {} })
  const closed = await send(db, close)
  assert.equal(closed.status, 200, JSON.stringify(closed))
  const pay = operation('offline-payment-01', { kind: 'PAYMENT', parentOperationId: closed.operationId,
    body: { entryType: 'PAYMENT', amountPaise: 2500, paymentMethod: 'UPI', reference: 'Offline-ref-1', recordingMode: 'OFFLINE' } })
  assert.equal((await send(db, pay)).status, 200)
  assert.equal((await send(db, pay)).idempotentReplay, true)
  const row = await db.prepare('SELECT * FROM request_payment_summaries WHERE request_id = ?').bind(created.requestId).first()
  assert.equal(row.received_paise, 2500); assert.equal(row.outstanding_paise, 7500); assert.equal(row.payment_status, 'PARTIAL')
  const duplicate = { ...pay, operationId: 'offline-payment-02', requestId: created.requestId, parentOperationId: undefined, expectedRevision: row.revision }
  assert.equal((await send(db, duplicate)).status, 409)
  assert.equal((await db.prepare('SELECT count(*) n FROM request_payment_ledger').bind().first()).n, 1)
})

test('stale quantity/price edits and competing closures preserve the server version without receipts', async t => {
  const { db, catalogue } = await setup(t), created = await create(db, catalogue)
  const close = operation('offline-close-01', { kind: 'CLOSE', requestId: created.requestId, expectedRevision: created.revision, body: {} })
  assert.equal((await send(db, close)).status, 200)
  assert.equal((await send(db, { ...close, operationId: 'offline-close-02' })).status, 409)
  const edit = operation('offline-edit-01', { kind: 'EDIT', requestId: created.requestId, expectedRevision: created.revision, catalogue, body: { items: [{ productId: 'P001', quantity: 4 }] } })
  assert.equal((await send(db, edit)).status, 409)
  assert.equal((await db.prepare('SELECT quantity FROM customer_request_items WHERE request_id = ?').bind(created.requestId).first()).quantity, 2)
  assert.equal((await db.prepare('SELECT count(*) n FROM offline_sync_receipts').bind().first()).n, 2)
})

test('changed catalogue and cross-stall catalogue references cannot silently reprice or create a request', async t => {
  const { db, catalogue } = await setup(t)
  await db.prepare('UPDATE products SET selling_price_paise = ? WHERE id = ?').bind(11000, 'P001').run()
  assert.equal((await send(db, operation('offline-create-01', { catalogue }))).error, 'catalogue_conflict')
  assert.equal((await send(db, operation('offline-create-02', { catalogue: [{ ...catalogue[0], id: 'P002' }], body: { customer: { name: 'Guest', mobile: '9876543210' }, items: [{ productId: 'P002', quantity: 1 }] } }))).status, 404)
  assert.equal((await db.prepare('SELECT count(*) n FROM customer_requests').bind().first()).n, 0)
})

test('Admin can create/edit quantities, but cannot submit financial edits, closures or payments', async t => {
  const { db, catalogue } = await setup(t, 'admin')
  const adminScope = { ...scope, userId: 'admin' }
  const base = operation('admin-create-01', { scope: adminScope, catalogue, body: { customer: { name: 'Guest', mobile: '9876543210' }, items: [{ productId: 'P001', quantity: 1 }] } })
  const created = await send(db, base, { actor: 'admin' }); assert.equal(created.status, 200, JSON.stringify(created))
  const edit = { ...base, kind: 'EDIT', operationId: 'admin-edit-01', requestId: created.requestId, expectedRevision: created.revision, body: { items: [{ productId: 'P001', quantity: 2 }] } }
  const edited = await send(db, edit, { actor: 'admin' }); assert.equal(edited.status, 200)
  edit.expectedRevision = edited.revision
  for (const kind of ['CLOSE','PAYMENT']) assert.equal((await send(db, { ...edit, kind, operationId: 'admin-forbid-' + kind, catalogue: undefined, body: {} }, { actor: 'admin' })).status, 403)
  assert.equal((await send(db, { ...edit, operationId: 'admin-prices-01', body: { items: [{ productId: 'P001', quantity: 2, unitRatePaise: 1 }] } }, { actor: 'admin' })).status, 403)
  const snapshot = await (await api(db, 'offline/requests/' + created.requestId, { actor: 'admin' })).json()
  assert.doesNotMatch(JSON.stringify(snapshot), /purchase|profit|margin|finalSubtotal|bargainFloor/i)
})

test('user, device, revoked membership and cross-stall scopes are revalidated on every retry', async t => {
  const { db, catalogue } = await setup(t), input = operation('offline-create-01', { catalogue })
  assert.equal((await send(db, { ...input, scope: { ...scope, userId: 'admin' } })).status, 403)
  assert.equal((await send(db, { ...input, deviceToken: 'cd'.repeat(32) })).status, 403)
  assert.equal((await send(db, { ...input, scope: { ...scope, locationId: 'loc-b' } })).status, 409)
  const saved = await create(db, catalogue)
  assert.equal((await api(db, 'offline/requests/' + saved.requestId, { location: 'loc-b' })).status, 403)
  await db.prepare('UPDATE location_members SET disabled_at = ? WHERE admin_user_id = ?').bind('now', 'owner').run()
  assert.equal((await send(db, input)).status, 403, 'even acknowledged operations require current membership')
})

test('permission/device changes during a write transaction roll back business changes and receipt together', async t => {
  const { db, catalogue } = await setup(t)
  const batch = db.batch
  let changed = false
  db.batch = async statements => {
    if (!changed && statements.some(row => row.sql.includes('INSERT INTO offline_sync_receipts'))) {
      changed = true
      await db.prepare('UPDATE offline_sync_devices SET disabled_at = ? WHERE device_id = ?').bind('now', scope.deviceId).run()
    }
    return batch(statements)
  }
  const result = await send(db, operation('offline-create-01', { catalogue }))
  assert.equal(result.status, 403, JSON.stringify(result))
  assert.equal((await db.prepare('SELECT count(*) n FROM customer_requests').bind().first()).n, 0)
  assert.equal((await db.prepare('SELECT count(*) n FROM offline_sync_receipts').bind().first()).n, 0)
})

test('lost commit response is recovered from the atomic receipt', async t => {
  const { db, catalogue } = await setup(t), batch = db.batch
  let lost = false
  db.batch = async statements => { const result = await batch(statements); if (!lost && statements.some(row => row.sql.includes('INSERT INTO offline_sync_receipts'))) { lost = true; throw Error('lost response') } return result }
  const result = await create(db, catalogue)
  assert.equal((await send(db, operation('offline-create-01', { catalogue }))).requestId, result.requestId)
})

test('simultaneous duplicate synchronization commits exactly one request and one receipt', async t => {
  const { db, catalogue } = await setup(t), input = operation('concurrent-create-01', { catalogue })
  const results = await Promise.all([send(db, input), send(db, input)])
  assert.ok(results.every(result => result.status === 200), JSON.stringify(results))
  assert.equal(results[0].requestId, results[1].requestId)
  assert.equal((await db.prepare('SELECT count(*) n FROM offline_sync_receipts').bind().first()).n, 1)
  assert.equal((await db.prepare('SELECT count(*) n FROM customer_requests').bind().first()).n, 1)
})

test('a catalogue price change between validation and commit rolls the entire offline creation back', async t => {
  const { db, catalogue } = await setup(t), batch = db.batch
  let changed = false
  db.batch = async statements => {
    if (!changed && statements.some(row => row.sql.includes('INSERT INTO offline_sync_receipts'))) {
      changed = true
      await db.prepare('UPDATE products SET selling_price_paise = 11000 WHERE id = ?').bind('P001').run()
    }
    return batch(statements)
  }
  const result = await send(db, operation('catalogue-race-01', { catalogue }))
  assert.equal(result.status, 409, JSON.stringify(result))
  assert.equal((await db.prepare('SELECT count(*) n FROM customer_requests').bind().first()).n, 0)
})

test('authorized second-stall membership still cannot read, close or pay a first-stall request', async t => {
  const { db, catalogue } = await setup(t), saved = await create(db, catalogue)
  await db.prepare('INSERT INTO location_members VALUES(?,?,?,?,NULL)').bind('loc-b','season-2026','owner','owner').run()
  assert.equal((await api(db, 'offline/requests/' + saved.requestId, { location: 'loc-b' })).status, 404)
  assert.equal((await api(db, 'offline/devices', { location: 'loc-b', body: { deviceId: scope.deviceId, deviceToken: secret } })).status, 200)
  for (const kind of ['EDIT','CLOSE','PAYMENT']) {
    const result = await send(db, operation('cross-stall-' + kind, { scope: { ...scope, locationId: 'loc-b' }, kind, requestId: saved.requestId, expectedRevision: saved.revision, body: {} }), { location: 'loc-b' })
    assert.equal(result.status, 404, JSON.stringify(result))
  }
})

test('fresh lesser authority denies closure and payment after an Owner location role becomes Admin', async t => {
  const { db, catalogue } = await setup(t), saved = await create(db, catalogue)
  await db.prepare('UPDATE location_members SET role = ? WHERE admin_user_id = ?').bind('admin','owner').run()
  for (const kind of ['AGREEMENT','CLOSE','PAYMENT']) assert.equal((await send(db, operation('revoked-' + kind, { kind, requestId: saved.requestId, expectedRevision: saved.revision, body: {} }))).status, 403)
  assert.equal((await db.prepare('SELECT status FROM customer_requests WHERE id = ?').bind(saved.requestId).first()).status, 'quoted')
})

test('existing customer-agreed-amount operation supports offline closure of a selling-mode Admin-created request', async t => {
  const { db, catalogue } = await setup(t)
  const saved = await create(db, catalogue, 'selling-create-01', { body: { customer: { name: 'Guest', mobile: '9876543210' }, items: [{ productId: 'P001', quantity: 1 }], pricingMode: 'selling' } })
  const agreed = await send(db, operation('offline-agree-01', { kind: 'AGREEMENT', requestId: saved.requestId, expectedRevision: saved.revision, body: { acceptedAmountPaise: 5000 } }))
  assert.equal(agreed.status, 200, JSON.stringify(agreed))
  assert.equal((await send(db, operation('offline-close-01', { kind: 'CLOSE', parentOperationId: agreed.operationId, body: {} }))).status, 200)
})

test('expired authentication is rejected by the Worker before any offline mutation or acknowledgement', async t => {
  const { db, catalogue } = await setup(t)
  const response = await worker.fetch(new Request('https://test.example/api/admin/offline/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation('expired-auth-01', { catalogue })) }), {
    DB: db, ADMIN_LOCATION_MODE: true, CF_ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com', CF_ACCESS_AUD: 'test-aud',
  }, {})
  assert.equal(response.status, 401)
  assert.equal((await db.prepare('SELECT count(*) n FROM offline_sync_receipts').bind().first()).n, 0)
})

test('prepared migration preserves historical requests/events and invents no devices or receipts', async t => {
  const db = await workflowDb(t)
  await db.prepare(`INSERT INTO customer_requests(id,customer_name,customer_phone,status,source,season_id,location_id)
    VALUES(?,?,?,'received','web','season-2026','loc-a')`).bind('historical-request','Historical','9876543210').run()
  const beforeRequests = await db.prepare('SELECT * FROM customer_requests').bind().all()
  const beforeEvents = await db.prepare('SELECT * FROM request_workflow_events').bind().all()
  await db.script(migration)
  assert.deepEqual(await db.prepare('SELECT * FROM customer_requests').bind().all(), beforeRequests)
  assert.deepEqual(await db.prepare('SELECT * FROM request_workflow_events').bind().all(), beforeEvents)
  assert.equal((await db.prepare('SELECT count(*) n FROM offline_sync_devices').bind().first()).n, 0)
  assert.equal((await db.prepare('SELECT count(*) n FROM offline_sync_receipts').bind().first()).n, 0)
  assert.equal((await db.prepare('PRAGMA foreign_key_check').bind().all()).results.length, 0)
})

test('reported offline role is retained separately and never authorizes a privileged operation', async t => {
  const { db, catalogue } = await setup(t, 'admin')
  const created = await send(db, operation('admin-create-01', { scope: { ...scope, userId: 'admin' }, capturedRole: 'owner', catalogue,
    body: { customer: { name: 'Guest', mobile: '9876543210' }, items: [{ productId: 'P001', quantity: 1 }], pricingMode: 'selling' } }), { actor: 'admin' })
  assert.equal(created.status, 200)
  const row = await db.prepare('SELECT actor_role,captured_role FROM offline_sync_receipts WHERE operation_id = ?').bind('admin-create-01').first()
  assert.equal(row.actor_role, 'admin'); assert.equal(row.captured_role, 'owner', 'untrusted historical hint only')
  assert.equal((await send(db, operation('admin-close-01', { scope: { ...scope, userId: 'admin' }, capturedRole: 'owner', kind: 'CLOSE', requestId: created.requestId, expectedRevision: created.revision, body: {} }), { actor: 'admin' })).status, 403)
})
