import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workflowDb, workflowMigration } from './helpers/workflowSqlite.js'
import { attachAdminRequestContext, getAdminContext } from '../src/middleware/requireAdmin.js'
import { handleAdminQuickBillRoutes } from '../src/routes/adminQuickBill.js'
import { handleAdminCustomerRequestRoutes } from '../src/routes/adminCustomerRequests.js'
import { handleAdminQuotationRoutes } from '../src/routes/adminQuotations.js'
import { customerRequestDb } from '../src/lib/adminCustomerRequestScope.js'
import { getRequestWorkflowHistory } from '../src/services/adminRequestWorkflowHistory.js'
import { presentWorkflowEvent } from '../src/lib/requestWorkflowAudit.js'

const season = 'season-2026'
const assignmentFields = {
  assigned_to_user_id: ['assignedToUserId', 'super', 'owner'],
  assigned_to_name: ['assignedToName', 'Original Super', 'Renamed Super'],
  assigned_to_role: ['assignedToRole', 'super_admin', 'owner'],
  assigned_to_email: ['assignedToEmail', 'super@test.com', 'owner@test.com'],
  assigned_by_user_id: ['assignedByUserId', 'admin', 'owner'],
  assigned_by_name: ['assignedByName', 'Original Admin', 'Renamed Admin'],
  assigned_by_role: ['assignedByRole', 'admin', 'owner'],
  assigned_at: ['assignedAt', '2026-11-04T10:00:00Z', '2026-11-04T11:00:00Z'],
}

async function assignmentHistoryFixture(t) {
  const db = await workflowDb(t, { migrate: false })
  await db.script(`INSERT INTO customer_requests(id,source,status,finalization_status,season_id,location_id,created_at)
    VALUES('assignment-history','manual','received','pending','season-2026','loc-a','2026-11-01');`)
  await db.script(workflowMigration)
  await db.prepare(`UPDATE customer_requests SET audit_actor_user_id=?, audit_actor_name=?, audit_actor_role=?,
    audit_device_id=?, audit_occurred_at=? WHERE id=?`)
    .bind('owner', 'Original Owner', 'owner', 'test-device', '2026-11-04T09:00:00Z', 'assignment-history').run()
  return db
}

test('each assignment field independently records one complete before/after workflow event', async t => {
  const db = await assignmentHistoryFixture(t)
  const snapshots = request => Object.fromEntries([
    ['status', request.status], ['finalizationStatus', request.finalization_status],
    ...Object.entries(assignmentFields).map(([column, [key]]) => [key, request[column]]),
    ['closedByEmail', request.closed_by_email], ['closedAt', request.closed_at],
    ['creatorUserId', request.creator_user_id], ['creatorName', request.creator_name],
    ['creatorRole', request.creator_role], ['createdAt', request.created_at],
  ])
  for (const [column, [, first, second]] of Object.entries(assignmentFields)) {
    await t.test(column, async () => {
      // Null-safe tracking in both directions, plus a non-null replacement.
      for (const value of [first, second, null]) {
        const before = await row(db, 'assignment-history')
        const count = (await db.prepare('SELECT COUNT(*) AS n FROM request_workflow_events').bind().first()).n
        await db.prepare(`UPDATE customer_requests SET ${column}=? WHERE id=?`).bind(value, before.id).run()
        const after = await row(db, before.id)
        const recorded = (await db.prepare('SELECT * FROM request_workflow_events WHERE revision>? ORDER BY revision').bind(before.revision).all()).results
        assert.equal(recorded.length, 1, `${column}: exactly one new event`)
        assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM request_workflow_events').bind().first()).n, count + 1)
        assert.equal(after.revision, before.revision + 1)
        assert.deepEqual(after, { ...before, [column]: value, revision: before.revision + 1 })
        const event = recorded[0]
        assert.equal(event.event_type, 'request_assigned')
        assert.equal(event.revision, after.revision)
        assert.deepEqual(JSON.parse(event.metadata_json), { before: snapshots(before), after: snapshots(after) })
        assert.deepEqual([event.request_id, event.business_id, event.location_id, event.season_id,
          event.actor_user_id, event.actor_name, event.actor_role, event.device_id, event.occurred_at],
        [before.id, 'shop', 'loc-a', season, 'owner', 'Original Owner', 'owner', 'test-device', '2026-11-04T09:00:00Z'])
        assert.ok(event.received_at)
      }
    })
  }
})

test('unrelated and unchanged request updates create no workflow events or revision increments', async t => {
  const db = await assignmentHistoryFixture(t)
  await db.prepare('UPDATE customer_requests SET customer_name=?, customer_note=?, updated_at=? WHERE id=?')
    .bind('Updated customer', 'Unrelated note', '2026-11-04', 'assignment-history').run()
  for (const column of ['status', 'finalization_status', ...Object.keys(assignmentFields)]) {
    await db.prepare(`UPDATE customer_requests SET ${column}=${column} WHERE id=?`).bind('assignment-history').run()
  }
  assert.equal((await row(db, 'assignment-history')).revision, 0)
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM request_workflow_events').bind().first()).n, 0)
})

const payload = { customer: { name: 'Guest', mobile: '9876543210' }, items: [{ productId: 'P001', quantity: 2, unitType: 'piece' }] }
async function api(db, path, { method = 'GET', body, actor = 'owner', location = 'loc-a', revision, headers = {} } = {}) {
  const request = new Request('https://example.test/api/admin/' + path, { method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Season-Id': season, 'X-Admin-Location-Id': location,
      'Idempotency-Key': 'history-checkout', ...(revision == null ? {} : { 'If-Match': String(revision) }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const identity = { userId: actor, email: actor + '@test.com' }
  const attached = await attachAdminRequestContext(request, db, identity, { ADMIN_LOCATION_MODE: true })
  if (!attached.ok) return Response.json(attached, { status: attached.status })
  if (path.startsWith('quick-bill')) return handleAdminQuickBillRoutes(request, { DB: db }, identity)
  if (/\/(quotation|quotations)(\/|$)/.test(request.url)) return handleAdminQuotationRoutes(request, { DB: db }, new URL(request.url), identity)
  return handleAdminCustomerRequestRoutes(request, { DB: db }, new URL(request.url), identity)
}
const row = (db, id) => db.prepare('SELECT * FROM customer_requests WHERE id = ?').bind(id).first()
const events = async (db, id, actor = 'owner') => {
  const response = await api(db, `customer-requests/${id}/history`, { actor })
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
  return (await response.json()).events
}
async function create(db, options = {}) {
  const response = await api(db, 'quick-bill/checkout', { method: 'POST', body: payload, ...options })
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  return (await response.json()).request.id
}

test('0021 preserves historical requests/quotations and never invents historical actors, units or events', async t => {
  const db = await workflowDb(t, { migrate: false })
  await db.script(`INSERT INTO customer_requests(id,source,status,season_id,location_id,created_at) VALUES('old','manual','quoted','season-2026','loc-a','2025-01-01');
    INSERT INTO customer_request_items(request_id,line_number,product_id,product_name,quantity,unit_price_paise) VALUES('old',1,'P001','Historical name',2,9900);
    INSERT INTO quotations(id,customer_request_id,subtotal_paise,total_paise,season_id,location_id) VALUES('old-quote','old',19800,19800,'season-2026','loc-a');
    INSERT INTO quotation_items(quotation_id,line_number,product_id,product_name,quantity,unit_rate_paise,line_total_paise) VALUES('old-quote',1,'P001','Historical name',2,9900,19800);`)
  await db.script(workflowMigration)
  const old = await row(db, 'old')
  assert.equal(old.created_at, '2025-01-01'); assert.equal(old.revision, 0)
  assert.equal(old.creator_user_id, null); assert.equal(old.creator_role, null); assert.equal(old.audit_device_id, null)
  const line = await db.prepare('SELECT * FROM customer_request_items WHERE request_id = ?').bind('old').first()
  assert.ok(line.line_id); assert.equal(line.product_name, 'Historical name'); assert.equal(line.unit_type, null)
  const quote = await db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ?').bind('old-quote').first()
  assert.equal(quote.request_line_id, line.line_id); assert.equal(quote.unit_rate_paise, 9900)
  assert.equal((await db.prepare('SELECT * FROM request_workflow_events').bind().all()).results.length, 0)
})

test('real SQLite checkout persists actor/device snapshots, scoped history and explicit line snapshots atomically', async t => {
  const db = await workflowDb(t)
  const id = await create(db, { actor: 'admin', headers: { 'X-Device-Id': 'tablet-1', 'X-Device-Occurred-At': '2026-11-02T12:00:00Z' } })
  const request = await row(db, id)
  assert.equal(request.creator_user_id, 'admin'); assert.equal(request.creator_name, 'Original Admin'); assert.equal(request.creator_role, 'admin')
  const history = await events(db, id)
  assert.equal(history[0].eventType, 'request_created')
  assert.equal(request.revision, history.length)
  assert.deepEqual(history.map(event => event.revision), history.map((_, i) => i + 1))
  assert.ok(history.every(event => event.businessId === 'shop' && event.locationId === 'loc-a' && event.seasonId === season && event.actorUserId === 'admin' && event.actorRole === 'admin' && event.deviceId === 'tablet-1' && event.occurredAt === '2026-11-02T12:00:00.000Z' && event.receivedAt))
  const detail = await (await api(db, `customer-requests/${id}`, { actor: 'admin' })).json()
  const line = detail.request.items[0]
  assert.ok(line.lineId); assert.equal(line.unitType, 'piece')
  assert.equal(line.packSnapshot.piecesPerPack, 10); assert.equal(line.productDetails.company, 'Maker')
  const quotation = await (await api(db, `customer-requests/${id}/quotation`)).json()
  assert.equal(quotation.quotation.items[0].requestLineId, line.lineId)
  assert.equal(quotation.quotation.items[0].unitType, 'piece')
  assert.equal(quotation.quotation.requestRevision, request.revision)
  const count = history.length
  await create(db, { actor: 'admin' })
  assert.equal((await events(db, id)).length, count, 'idempotent replay must not duplicate events')
})

test('assignment captures both parties; adjustment retains stable line identity and before/after history; closure is recorded', async t => {
  const db = await workflowDb(t), id = await create(db)
  const original = await db.prepare('SELECT * FROM customer_request_items WHERE request_id = ?').bind(id).first()
  const assign = await api(db, `customer-requests/${id}/assign`, { method: 'PATCH', body: { assigneeUserId: 'super' }, actor: 'admin', revision: (await row(db, id)).revision })
  assert.equal(assign.status, 200, JSON.stringify(await assign.clone().json()))
  const assigned = await row(db, id)
  assert.equal(assigned.assigned_by_user_id, 'admin'); assert.equal(assigned.assigned_by_role, 'admin')
  assert.equal(assigned.assigned_to_user_id, 'super'); assert.equal(assigned.assigned_to_role, 'super_admin'); assert.ok(assigned.assigned_at)
  await db.prepare('UPDATE admin_users SET display_name = ? WHERE id = ?').bind('Renamed Super', 'super').run()
  const adjusted = await api(db, `customer-requests/${id}/adjust-bill`, { method: 'PATCH', body: { items: [{ productId: 'P001', quantity: 4, unitType: 'piece' }] }, revision: assigned.revision })
  assert.equal(adjusted.status, 200, JSON.stringify(await adjusted.clone().json()))
  const changed = await db.prepare('SELECT * FROM customer_request_items WHERE request_id = ?').bind(id).first()
  assert.equal(changed.line_id, original.line_id); assert.equal(changed.quantity, 4)
  assert.equal(changed.pack_snapshot, original.pack_snapshot)
  const history = await events(db, id)
  const assignment = history.find(event => event.eventType === 'request_assigned')
  assert.equal(assignment.changes.after.assignedToName, 'Original Super')
  assert.ok(history.some(event => event.eventType === 'item_removed' && event.changes.before.quantity === 2))
  assert.ok(history.some(event => event.eventType === 'item_added' && event.changes.after.quantity === 4))
  assert.ok(history.some(event => event.eventType === 'quotation_adjusted'))
  const agreed = await api(db, `customer-requests/${id}/quotation/customer-agreed-amount`, { method: 'PATCH', body: { acceptedAmountInr: 40 }, revision: (await row(db, id)).revision })
  assert.equal(agreed.status, 200)
  const closed = await api(db, `customer-requests/${id}/finalize`, { method: 'PATCH', revision: (await row(db, id)).revision })
  assert.equal(closed.status, 200, JSON.stringify(await closed.clone().json()))
  assert.equal((await events(db, id)).at(-1).eventType, 'request_closed')
  assert.ok((await events(db, id)).every(event => event.deviceId === null && event.occurredAt === null))
})

test('stale revisions reject writes without appending or modifying history', async t => {
  const db = await workflowDb(t), id = await create(db), revision = (await row(db, id)).revision
  assert.equal((await api(db, `customer-requests/${id}/status`, { method: 'PATCH', body: { status: 'reviewing' }, revision })).status, 200)
  const before = await events(db, id)
  const stale = await api(db, `customer-requests/${id}/assign`, { method: 'PATCH', body: { assigneeUserId: 'super' }, revision })
  assert.equal(stale.status, 409)
  assert.deepEqual(await events(db, id), before)
  assert.equal((await row(db, id)).assigned_to_user_id, null)
})

test('history is append-only and audit failure rolls back the corresponding business operation', async t => {
  const db = await workflowDb(t), id = await create(db), history = await events(db, id)
  await assert.rejects(db.prepare('UPDATE request_workflow_events SET event_type = ? WHERE event_id = ?').bind('tampered', history[0].eventId).run(), /append_only/)
  await assert.rejects(db.prepare('DELETE FROM request_workflow_events WHERE event_id = ?').bind(history[0].eventId).run(), /append_only/)
  const before = await row(db, id)
  await db.script(`CREATE TRIGGER test_fail_audit BEFORE INSERT ON request_workflow_events BEGIN SELECT RAISE(ABORT,'test_audit_failure'); END;`)
  await assert.rejects(api(db, `customer-requests/${id}/status`, { method: 'PATCH', body: { status: 'reviewing' } }), /test_audit_failure/)
  assert.deepEqual(await row(db, id), before)
  assert.deepEqual(await events(db, id), history)
})

test('history APIs enforce scope and sanitize restricted metadata', async t => {
  const db = await workflowDb(t), id = await create(db)
  assert.equal((await api(db, `customer-requests/${id}/history`, { location: 'loc-b' })).status, 403)
  await db.script(`INSERT INTO location_members VALUES('loc-b','season-2026','owner','owner',NULL);`)
  assert.equal((await api(db, `customer-requests/${id}/history`, { location: 'loc-b' })).status, 404)
  const restricted = await events(db, id, 'admin')
  assert.ok(!/unitPricePaise|acceptedAmountPaise|purchase|profit|margin/i.test(JSON.stringify(restricted)))
  const privileged = await events(db, id)
  assert.ok(privileged.some(event => event.changes.after?.unitPricePaise === 1000))
  const request = new Request('https://example.test/api/admin/customer-requests', { headers: { 'X-Admin-Season-Id': season, 'X-Admin-Location-Id': 'loc-a' } })
  await attachAdminRequestContext(request, db, { userId: 'owner', email: 'owner@test.com' }, { ADMIN_LOCATION_MODE: true })
  const scoped = customerRequestDb(db, season, getAdminContext(request), true)
  assert.throws(() => scoped.prepare('DELETE FROM request_workflow_events WHERE request_id = ?').bind(id), /Unsupported/)
})

test('transport hints are optional, validated and never accepted as actor authority', async t => {
  const db = await workflowDb(t)
  for (const headers of [{ 'If-Match': '-1' }, { 'X-Device-Id': 'bad device' }, { 'X-Device-Occurred-At': 'yesterday' }]) {
    assert.equal((await api(db, 'quick-bill/checkout', { method: 'POST', body: payload, headers })).status, 400)
  }
  const id = await create(db, { actor: 'admin', body: { ...payload, actorUserId: 'owner', actorRole: 'owner', creatorName: 'Spoofed' } })
  assert.equal((await row(db, id)).creator_user_id, 'admin')
})

test('revision guards reject a concurrent write between lookup and commit', async t => {
  const db = await workflowDb(t), id = await create(db), batch = db.batch
  let raced = false
  db.batch = async statements => {
    if (!raced) {
      raced = true
      await db.prepare('UPDATE customer_requests SET status = ? WHERE id = ?').bind('reviewing', id).run()
    }
    return batch(statements)
  }
  const response = await api(db, `customer-requests/${id}/assign`, { method: 'PATCH', body: { assigneeUserId: 'super' }, revision: (await row(db, id)).revision })
  assert.equal(response.status, 409)
  assert.equal((await row(db, id)).assigned_to_user_id, null)
  const history = await events(db, id)
  assert.equal(history.at(-1).actorUserId, null, 'an unauthenticated SQL writer cannot inherit the previous actor')
})

test('event scope cannot be forged, creator snapshots cannot be rewritten, and revisions cannot move backwards', async t => {
  const db = await workflowDb(t), id = await create(db), original = await row(db, id)
  await assert.rejects(db.prepare(`INSERT INTO request_workflow_events(event_id,request_id,business_id,location_id,season_id,event_type,revision,metadata_json)
    VALUES('forged',?,'shop','loc-b',?,'future_event',?,'{}')`).bind(id, season, original.revision).run(), /scope_mismatch/)
  await assert.rejects(db.prepare('UPDATE customer_requests SET creator_name = ? WHERE id = ?').bind('Rewritten', id).run(), /creator_immutable/)
  await assert.rejects(db.prepare('UPDATE customer_requests SET revision = ? WHERE id = ?').bind(0, id).run(), /revision_must_advance/)
  assert.deepEqual(await row(db, id), original)
})

test('audit privilege comes from effective server role and metadata redaction is recursive', async t => {
  const db = await workflowDb(t), id = await create(db)
  const request = new Request('https://example.test/api/admin/customer-requests', { headers: { 'X-Admin-Season-Id': season, 'X-Admin-Location-Id': 'loc-a' } })
  await attachAdminRequestContext(request, db, { userId: 'admin', email: 'admin@test.com' }, { ADMIN_LOCATION_MODE: true })
  const result = await getRequestWorkflowHistory(db, id, { seasonId: season, context: getAdminContext(request), role: 'owner' })
  assert.ok(!/unitPricePaise|acceptedAmountPaise/.test(JSON.stringify(result.events)))
  for (const privileged of [false, true]) {
    const presented = presentWorkflowEvent({ metadata_json: JSON.stringify({ nested: [{ purchasePrice: 1, profitPaise: 2, margin: 3, quantity: 4 }] }) }, privileged)
    assert.deepEqual(presented.changes, { nested: [{ quantity: 4 }] })
  }
})

test('history cursor pagination exposes stable ascending revisions', async t => {
  const db = await workflowDb(t), id = await create(db), history = await events(db, id)
  const response = await api(db, `customer-requests/${id}/history?afterRevision=1&limit=2`)
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).events.map(event => event.eventId), history.slice(1, 3).map(event => event.eventId))
  assert.equal((await api(db, `customer-requests/${id}/history?limit=101`)).status, 400)
})
