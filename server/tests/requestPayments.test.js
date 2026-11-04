import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workflowDb, paymentMigration } from './helpers/workflowSqlite.js'
import { attachAdminRequestContext } from '../src/middleware/requireAdmin.js'
import { handleAdminPaymentRoutes } from '../src/routes/adminPayments.js'
import { handleAdminCustomerRequestRoutes } from '../src/routes/adminCustomerRequests.js'
import { handleAdminQuickBillRoutes } from '../src/routes/adminQuickBill.js'

const season = 'season-2026'
async function api(db, path, { method = 'GET', body, actor = 'owner', location = 'loc-a', revision, headers = {} } = {}) {
  const request = new Request('https://example.test/api/admin/' + path, { method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Season-Id': season, 'X-Admin-Location-Id': location, 'Idempotency-Key': 'payment-request',
      ...(revision == null ? {} : { 'If-Match': String(revision) }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const identity = { userId: actor, email: actor + '@test.com' }
  const attached = await attachAdminRequestContext(request, db, identity, { ADMIN_LOCATION_MODE: true })
  if (!attached.ok) return Response.json(attached, { status: attached.status })
  if (path.startsWith('quick-bill')) return handleAdminQuickBillRoutes(request, { DB: db }, identity)
  if (/\/payments(?:\?|$)/.test(path)) return handleAdminPaymentRoutes(request, { DB: db })
  return handleAdminCustomerRequestRoutes(request, { DB: db }, new URL(request.url), identity)
}
const revision = async (db, id) => (await db.prepare('SELECT revision FROM customer_requests WHERE id = ?').bind(id).first()).revision
async function create(db, finalized = true, { key = 'payment-request', accepted = 10000 } = {}) {
  const response = await api(db, 'quick-bill/checkout', { method: 'POST', headers: { 'Idempotency-Key': key }, body: { customer: { name: 'Guest', mobile: '9876543210' }, items: [{ productId: 'P001', quantity: 2 }], pricingMode: 'bargain', acceptedAmountPaise: accepted } })
  assert.equal(response.status, 201)
  const id = (await response.json()).request.id
  if (finalized) {
    const closed = await api(db, `customer-requests/${id}/finalize`, { method: 'PATCH', revision: await revision(db, id) })
    assert.equal(closed.status, 200, JSON.stringify(await closed.clone().json()))
  }
  return id
}
const payment = (operationId, amountPaise, extra = {}) => ({ operationId, amountPaise, entryType: 'PAYMENT', recordingMode: 'ONLINE', paymentMethod: 'CASH', ...extra })
async function record(db, id, body, options = {}) {
  return api(db, `customer-requests/${id}/payments`, { method: 'POST', body, revision: await revision(db, id), ...options })
}
async function get(db, id, options = {}) {
  const response = await api(db, `customer-requests/${id}/payments`, options)
  assert.equal(response.status, 200)
  return response.json()
}

test('finalization creates an unpaid agreed-amount balance without requiring payment; full payment is independent of closure', async t => {
  const db = await workflowDb(t), id = await create(db)
  let data = await get(db, id)
  assert.equal(data.summary.amountDuePaise, 10000, 'agreed amount, not catalogue/floor reference')
  assert.equal(data.summary.receivedPaise, 0); assert.equal(data.summary.outstandingPaise, 10000); assert.equal(data.summary.paymentStatus, 'UNPAID')
  const before = await db.prepare('SELECT status,finalization_status,closed_at FROM customer_requests WHERE id = ?').bind(id).first()
  const result = await record(db, id, payment('full-payment-1', 10000))
  assert.equal(result.status, 201, JSON.stringify(await result.clone().json()))
  data = await result.json()
  assert.equal(data.summary.paymentStatus, 'PAID'); assert.equal(data.summary.receivedPaise, 10000); assert.equal(data.summary.outstandingPaise, 0)
  assert.deepEqual(await db.prepare('SELECT status,finalization_status,closed_at FROM customer_requests WHERE id = ?').bind(id).first(), before)
})

test('partial payments, multiple methods and immutable actor/device/mode snapshots produce exact balances', async t => {
  const db = await workflowDb(t), id = await create(db)
  const first = await record(db, id, payment('partial-payment-1', 1234), { actor: 'super', headers: { 'X-Device-Id': 'terminal-1', 'X-Device-Occurred-At': '2026-11-02T10:00:00Z' } })
  assert.equal(first.status, 201)
  let data = await first.json()
  assert.equal(data.summary.paymentStatus, 'PARTIAL'); assert.equal(data.summary.outstandingPaise, 8766)
  assert.equal(data.entry.actorUserId, 'super'); assert.equal(data.entry.actorRole, 'super_admin'); assert.equal(data.entry.actorName, 'Original Super')
  assert.equal(data.entry.deviceId, 'terminal-1'); assert.equal(data.entry.occurredAt, '2026-11-02T10:00:00.000Z'); assert.ok(data.entry.receivedAt)
  await db.prepare('UPDATE admin_users SET display_name = ? WHERE id = ?').bind('Changed name', 'super').run()
  assert.equal((await record(db, id, payment('partial-payment-2', 2345, { paymentMethod: 'UPI', reference: 'UPI-123', recordingMode: 'OFFLINE', occurredAt: '2026-11-01T12:00:00Z' }))).status, 201)
  assert.equal((await record(db, id, payment('partial-payment-3', 6421, { paymentMethod: 'BANK', reference: 'BANK-123' }))).status, 201)
  data = await get(db, id)
  assert.equal(data.summary.receivedPaise, 10000); assert.equal(data.summary.paymentCount, 3); assert.equal(data.summary.paymentStatus, 'PAID')
  assert.equal(data.entries[0].actorName, 'Original Super'); assert.equal(data.entries[1].recordingMode, 'OFFLINE'); assert.equal(data.entries[1].paymentMethod, 'UPI')
})

test('payment hold and release are append-only state changes separate from partial payment and bargaining', async t => {
  const db = await workflowDb(t), id = await create(db)
  const hold = operationId => ({ operationId, entryType: 'HOLD', amountPaise: 0, recordingMode: 'ONLINE', details: 'Customer requested time' })
  assert.equal((await record(db, id, hold('hold-operation-1'))).status, 201)
  assert.equal((await get(db, id)).summary.paymentStatus, 'HOLD')
  await record(db, id, payment('hold-payment-1', 2500))
  let data = await get(db, id)
  assert.equal(data.summary.paymentStatus, 'HOLD'); assert.equal(data.summary.receivedPaise, 2500); assert.equal(data.summary.outstandingPaise, 7500)
  assert.equal((await record(db, id, { operationId: 'release-hold-1', entryType: 'RELEASE_HOLD', amountPaise: 0, recordingMode: 'ONLINE' })).status, 201)
  assert.equal((await get(db, id)).summary.paymentStatus, 'PARTIAL')
  await record(db, id, hold('hold-operation-2'))
  await record(db, id, payment('hold-payment-2', 7500))
  data = await get(db, id)
  assert.equal(data.summary.paymentStatus, 'PAID'); assert.equal(data.summary.onHold, false)
  assert.equal(data.entries.length, 5); assert.equal(data.summary.paymentCount, 2)
  assert.equal((await record(db, id, hold('hold-operation-3'))).status, 409)
  assert.equal((await db.prepare('SELECT pricing_mode FROM quotations WHERE customer_request_id = ? AND status != ?').bind(id, 'void').first()).pricing_mode, 'bargain')
})

test('duplicate operation retries replay the original payment even after the revision changes', async t => {
  const db = await workflowDb(t), id = await create(db), originalRevision = await revision(db, id)
  const body = payment('duplicate-operation-1', 3000)
  const first = await record(db, id, body)
  assert.equal(first.status, 201)
  const firstData = await first.json()
  await record(db, id, payment('other-operation-1', 2000))
  const replay = await record(db, id, body, { revision: originalRevision })
  assert.equal(replay.status, 200)
  const data = await replay.json()
  assert.equal(data.idempotentReplay, true); assert.equal(data.entry.paymentId, firstData.entry.paymentId)
  assert.equal(data.summary.paymentCount, 2); assert.equal(data.summary.receivedPaise, 5000)
  assert.equal((await record(db, id, { ...body, amountPaise: 3001 })).status, 409)
  assert.equal((await record(db, id, { ...body, recordingMode: 'OFFLINE', occurredAt: '2026-11-01T00:00:00Z' })).status, 409)
})

test('electronic transaction references prevent duplicate attempts with new operation IDs', async t => {
  const db = await workflowDb(t), id = await create(db)
  assert.equal((await record(db, id, payment('transaction-operation-1', 1000, { paymentMethod: 'CARD', reference: 'Txn Abc' }))).status, 201)
  const duplicate = await record(db, id, payment('transaction-operation-2', 1000, { paymentMethod: 'CARD', reference: '  txnabc  ' }))
  assert.equal(duplicate.status, 409); assert.equal((await duplicate.json()).error, 'duplicate_transaction')
  assert.equal((await get(db, id)).summary.receivedPaise, 1000)
})

test('overpayment, malformed money, method/mode mixing and invalid offline dates are rejected safely', async t => {
  const db = await workflowDb(t), id = await create(db)
  for (const body of [payment('bad-payment-1', 10001), payment('bad-payment-2', 0), payment('bad-payment-3', -1), payment('bad-payment-4', 0.5), payment('bad-payment-5', '100'), payment('bad-payment-6', Number.MAX_SAFE_INTEGER + 1),
    payment('bad-payment-7', 100, { paymentMethod: 'ONLINE' }), payment('bad-payment-8', 100, { recordingMode: 'CASH' }), payment('bad-payment-9', 100, { paymentMethod: 'UPI' }),
    payment('bad-payment-10', 100, { recordingMode: 'OFFLINE' }), payment('bad-payment-11', 100, { occurredAt: '2026-02-30T00:00:00Z' }),
    { operationId: 'bad-payment-12', entryType: 'HOLD', recordingMode: 'ONLINE', amountPaise: 1 }, payment('bad-payment-13', 100, { status: 'PAID', businessId: 'other' })]) {
    assert.equal((await record(db, id, body)).status, 400, JSON.stringify(body))
  }
  assert.equal((await get(db, id)).entries.length, 0)
})

test('Admin cannot record payments or hold; summaries and history never expose purchase/profit details', async t => {
  const db = await workflowDb(t), id = await create(db)
  assert.equal((await record(db, id, payment('unauthorized-operation', 1000), { actor: 'admin' })).status, 403)
  assert.equal((await record(db, id, { operationId: 'unauthorized-hold', entryType: 'HOLD', recordingMode: 'ONLINE', amountPaise: 0 }, { actor: 'admin' })).status, 403)
  const data = await get(db, id, { actor: 'admin' })
  assert.ok(!/purchase|profit|margin/i.test(JSON.stringify(data)))
  const detail = await (await api(db, `customer-requests/${id}`, { actor: 'admin' })).json()
  assert.equal(detail.request.paymentSummary.paymentStatus, 'UNPAID')
  const list = await (await api(db, 'customer-requests', { actor: 'admin' })).json()
  assert.equal(list.requests[0].paymentSummary.outstandingPaise, 10000)
})

test('cross-stall reads/writes and scope changes cannot bypass validated membership', async t => {
  const db = await workflowDb(t), id = await create(db)
  assert.equal((await api(db, `customer-requests/${id}/payments`, { location: 'loc-b' })).status, 403)
  await db.script(`INSERT INTO location_members VALUES('loc-b','season-2026','owner','owner',NULL);`)
  assert.equal((await api(db, `customer-requests/${id}/payments`, { location: 'loc-b' })).status, 404)
  assert.equal((await record(db, id, payment('cross-stall-operation', 1000), { location: 'loc-b' })).status, 404)
  await db.prepare("UPDATE location_members SET role = 'admin' WHERE admin_user_id = ?").bind('owner').run()
  assert.equal((await record(db, id, payment('lower-role-operation', 1000))).status, 403)
})

test('revision conflicts, concurrent payments and lost acknowledgements cannot duplicate or overpay', async t => {
  const db = await workflowDb(t), id = await create(db), oldRevision = await revision(db, id)
  const results = await Promise.all([
    record(db, id, payment('concurrent-payment-1', 7000), { revision: oldRevision }),
    record(db, id, payment('concurrent-payment-2', 7000), { revision: oldRevision }),
  ])
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409])
  assert.equal((await get(db, id)).summary.receivedPaise, 7000)
  const batch = db.batch
  db.batch = async statements => { const result = await batch(statements); if (statements.some(statement => statement.sql.startsWith('INSERT INTO request_payment_ledger'))) throw Error('lost acknowledgement'); return result }
  const recovered = await record(db, id, payment('lost-ack-payment-1', 3000))
  assert.equal(recovered.status, 200)
  assert.equal((await recovered.json()).idempotentReplay, true)
  assert.equal((await get(db, id)).summary.receivedPaise, 10000)
})

test('payment history and accounts are immutable; audit failures roll back the payment', async t => {
  const db = await workflowDb(t), id = await create(db)
  await record(db, id, payment('append-only-payment-1', 1000))
  const entry = (await get(db, id)).entries[0], before = await revision(db, id)
  await assert.rejects(db.prepare('UPDATE request_payment_ledger SET amount_paise = ? WHERE payment_id = ?').bind(2, entry.paymentId).run(), /append_only/)
  await assert.rejects(db.prepare('DELETE FROM request_payment_ledger WHERE payment_id = ?').bind(entry.paymentId).run(), /append_only/)
  await assert.rejects(db.prepare('UPDATE request_payment_accounts SET amount_due_paise = ? WHERE request_id = ?').bind(99999, id).run(), /immutable/)
  await db.script(`CREATE TRIGGER reject_payment_audit BEFORE INSERT ON request_workflow_events WHEN NEW.event_type = 'payment_recorded' BEGIN SELECT RAISE(ABORT,'test_payment_audit_failure'); END;`)
  assert.equal((await record(db, id, payment('audit-failure-payment-1', 2000))).status, 503)
  assert.equal((await get(db, id)).summary.receivedPaise, 1000); assert.equal(await revision(db, id), before)
  const history = await (await api(db, `customer-requests/${id}/history`)).json()
  const event = history.events.find(event => event.eventType === 'payment_recorded')
  assert.equal(event.actorUserId, 'owner'); assert.equal(event.changes.paymentId, entry.paymentId)
})

test('unfinalized requests remain unpaid and payment writes require a revision', async t => {
  const db = await workflowDb(t), id = await create(db, false)
  assert.equal((await get(db, id)).summary.amountDuePaise, null)
  assert.equal((await record(db, id, payment('not-finalized-payment', 1000))).status, 409)
  assert.equal((await api(db, `customer-requests/${id}/finalize`, { method: 'PATCH', revision: await revision(db, id) })).status, 200)
  assert.equal((await api(db, `customer-requests/${id}/payments`, { method: 'POST', body: payment('missing-revision-payment', 1000) })).status, 428)
})

test('0022 backfills verified balances after 0021 without inventing payments or changing workflow history', async t => {
  const db = await workflowDb(t, { payments: false })
  const id = await create(db), unknown = await create(db, true, { key: 'historical-unknown' })
  await db.prepare('UPDATE quotations SET accepted_amount_paise = NULL WHERE customer_request_id = ?').bind(unknown).run()
  const requestsBefore = (await db.prepare('SELECT * FROM customer_requests ORDER BY id').bind().all()).results
  const quotationsBefore = (await db.prepare('SELECT * FROM quotations ORDER BY id').bind().all()).results
  const historyBefore = (await db.prepare('SELECT * FROM request_workflow_events ORDER BY event_id').bind().all()).results
  await db.script(paymentMigration)
  assert.deepEqual((await db.prepare('SELECT * FROM customer_requests ORDER BY id').bind().all()).results, requestsBefore)
  assert.deepEqual((await db.prepare('SELECT * FROM quotations ORDER BY id').bind().all()).results, quotationsBefore)
  assert.deepEqual((await db.prepare('SELECT * FROM request_workflow_events ORDER BY event_id').bind().all()).results, historyBefore)
  assert.equal((await get(db, id)).summary.amountDuePaise, 10000)
  assert.equal((await get(db, unknown)).summary.amountDuePaise, null)
  assert.equal((await db.prepare('SELECT count(*) AS count FROM request_payment_ledger').bind().first()).count, 0)
})

test('integer paise balances remain exact at the safe-integer limit', async t => {
  const db = await workflowDb(t), id = await create(db, true, { accepted: Number.MAX_SAFE_INTEGER })
  assert.equal((await record(db, id, payment('large-payment-1', Number.MAX_SAFE_INTEGER - 1))).status, 201)
  assert.equal((await get(db, id)).summary.outstandingPaise, 1)
  assert.equal((await record(db, id, payment('large-payment-2', 1))).status, 201)
  const data = await get(db, id)
  assert.equal(data.summary.receivedPaise, Number.MAX_SAFE_INTEGER); assert.equal(data.summary.outstandingPaise, 0)
})

test('global operation uniqueness prevents replaying a receipt onto a different request', async t => {
  const db = await workflowDb(t), first = await create(db), second = await create(db, true, { key: 'second-payment-request' })
  assert.equal((await record(db, first, payment('globally-unique-operation', 1000))).status, 201)
  assert.equal((await record(db, second, payment('globally-unique-operation', 1000))).status, 409)
  assert.equal((await get(db, second)).summary.receivedPaise, 0)
})

test('payment authority is rechecked inside the write transaction; Platform Admin is not a payment grant', async t => {
  const db = await workflowDb(t), id = await create(db), batch = db.batch
  await db.script(`INSERT INTO platform_admins(admin_user_id) VALUES('admin');`)
  assert.equal((await record(db, id, payment('platform-admin-attempt', 1000), { actor: 'admin' })).status, 403)
  let revoke = true
  db.batch = async statements => {
    if (revoke && statements.some(statement => statement.sql.startsWith('INSERT INTO request_payment_ledger'))) {
      revoke = false
      await db.prepare("UPDATE location_members SET role = 'admin' WHERE admin_user_id = ?").bind('owner').run()
    }
    return batch(statements)
  }
  const before = await revision(db, id)
  assert.equal((await record(db, id, payment('revoked-payment-attempt', 1000))).status, 403)
  assert.equal((await get(db, id)).entries.length, 0); assert.equal(await revision(db, id), before)
})

test('history pagination does not change the complete balance calculation', async t => {
  const db = await workflowDb(t), id = await create(db)
  for (let i = 0; i < 3; i++) assert.equal((await record(db, id, payment(`page-payment-${i}`, 100))).status, 201)
  const first = await (await api(db, `customer-requests/${id}/payments?limit=2`)).json()
  assert.equal(first.entries.length, 2); assert.equal(first.summary.receivedPaise, 300); assert.equal(first.summary.paymentCount, 3)
  const next = await (await api(db, `customer-requests/${id}/payments?afterSequence=${first.entries.at(-1).sequence}&limit=2`)).json()
  assert.equal(next.entries.length, 1); assert.equal(next.summary.receivedPaise, 300)
})

test('another authorized operating season cannot read or pay a previous season request', async t => {
  const db = await workflowDb(t), id = await create(db)
  await db.script(`INSERT INTO business_seasons(id,code,label,status) VALUES('season-2027','2027','Next season','active');
    INSERT INTO season_members(season_id,admin_user_id,role) VALUES('season-2027','owner','owner');
    INSERT INTO location_seasons VALUES('loc-a','season-2027',2027,'active');
    INSERT INTO location_members VALUES('loc-a','season-2027','owner','owner',NULL);`)
  const headers = { 'X-Admin-Season-Id': 'season-2027' }
  assert.equal((await api(db, `customer-requests/${id}/payments`, { headers })).status, 404)
  assert.equal((await record(db, id, payment('cross-season-payment', 1000), { headers })).status, 404)
  assert.equal((await get(db, id)).summary.receivedPaise, 0)
})
