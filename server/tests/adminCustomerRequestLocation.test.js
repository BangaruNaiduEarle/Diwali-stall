import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  listAdminCustomerRequests, getAdminCustomerRequestById, updateAdminCustomerRequestStatus,
  assignAdminCustomerRequest, resolveQuickBillAssignee, recordPublicCustomerAgreementPendingFinalization,
  finalizeAdminCustomerRequest, markCustomerRequestPendingFinalization,
} from '../src/services/adminCustomerRequests.js'
import { adjustPendingCustomerRequestBill, previewPendingCustomerRequestBillAdjust } from '../src/services/adminCustomerRequestBillAdjust.js'
import { customerRequestDb } from '../src/lib/adminCustomerRequestScope.js'
import { handleAdminCustomerRequestRoutes } from '../src/routes/adminCustomerRequests.js'

import { fixture, attach, season, previous, A, B, OLD, WEB, actor } from './helpers/mockAdminTransactionDb.js'

describe('customer request location + operating-season ownership (mocked D1 only)', () => {
  it('returns the original database and preserves optional legacy detail fallback when disabled', async () => {
    const db = fixture(), { context } = await attach(db, { mode: false })
    assert.equal(customerRequestDb(db, season, context), db)
    assert.ok(await getAdminCustomerRequestById(db, B))
    db.calls.length = 0
    assert.equal((await updateAdminCustomerRequestStatus(db, A, 'reviewing', { ...actor, context })).ok, true)
    assert.ok(db.calls.every(c => !c.sql.includes('location_id')))
  })

  it('scopes list, count and pagination by location AND operating season', async () => {
    const db = fixture(), { context } = await attach(db)
    const result = await listAdminCustomerRequests(db, { seasonId: season, context, limit: 1, offset: 0 })
    assert.equal(result.total, 2); assert.equal(result.requests.length, 1)
    assert.ok([A, WEB].includes(result.requests[0].id))
    const old = await attach(db, { operatingSeason: previous })
    assert.deepEqual((await listAdminCustomerRequests(db, { seasonId: previous, context: old.context, limit: 25, offset: 0 })).requests.map(r => r.id), [OLD])
    assert.equal(await getAdminCustomerRequestById(db, OLD, season, context), null)
    assert.equal(await getAdminCustomerRequestById(db, A, previous, old.context), null)
  })

  for (const id of [B, OLD]) it(`rejects foreign location/season ${id} before child reads or mutations`, async () => {
    const db = fixture(), { context } = await attach(db), before = structuredClone(db.state)
    db.calls.length = 0
    assert.equal(await getAdminCustomerRequestById(db, id, season, context), null)
    assert.ok(!db.calls.some(c => c.sql.includes('FROM customer_request_items')))
    for (const operation of [
      () => updateAdminCustomerRequestStatus(db, id, 'closed', { ...actor, context }),
      () => assignAdminCustomerRequest(db, id, { assigneeUserId: 'assignee' }, { seasonId: season, context, assignedByEmail: 'owner@test.com' }),
      () => recordPublicCustomerAgreementPendingFinalization(db, id, season, context),
      () => finalizeAdminCustomerRequest(db, id, { ...actor, context }),
      () => previewPendingCustomerRequestBillAdjust(db, id, [{ productId: 'P001', quantity: 2 }], season, context),
      () => adjustPendingCustomerRequestBill(db, id, [{ productId: 'P001', quantity: 2 }], { seasonId: season, context }),
    ]) assert.equal((await operation()).status, 404)
    assert.deepEqual(db.state, before)
  })

  it('reads only owned children and rejects product/family-pack ownership mismatches', async () => {
    const db = fixture(), { context } = await attach(db)
    assert.deepEqual((await getAdminCustomerRequestById(db, A, season, context)).items.map(i => i.productId), ['P001'])
    db.state.customer_request_items[0].product_id = 'P002'
    await assert.rejects(getAdminCustomerRequestById(db, A, season, context), e => e.code === 'request_ownership_mismatch')
    db.state.customer_request_items[0].product_id = null
    db.state.customer_request_items[0].family_pack_id = 'FP002'
    await assert.rejects(getAdminCustomerRequestById(db, A, season, context), e => e.status === 409)
  })

  it('requires both assignee memberships and the same location/operating season', async () => {
    const db = fixture(), { context } = await attach(db)
    db.state.assigneeSeason.role = 'super_admin'
    db.state.assigneeLocation.role = 'super_admin'
    assert.equal((await resolveQuickBillAssignee(db, { assigneeUserId: 'assignee' }, season, context)).ok, true)
    for (const change of [
      s => { s.assigneeSeason.disabled_at = 'disabled' },
      s => { s.assigneeLocation = null },
      s => { s.assigneeLocation.disabled_at = 'disabled' },
      s => { s.assigneeLocation.location_id = 'loc-b' },
      s => { s.assigneeLocation.season_id = previous },
      s => { s.assigneeLocation.role = 'unknown' },
      s => { s.assigneeSeason.role = 'admin' },
      s => { s.assigneeLocation.role = 'admin' },
    ]) {
      const original = structuredClone(db.state)
      change(db.state)
      assert.equal((await resolveQuickBillAssignee(db, { assigneeUserId: 'assignee' }, season, context)).code, 'invalid_assignee')
      Object.assign(db.state, original)
    }
    assert.equal((await assignAdminCustomerRequest(db, A, { assigneeUserId: 'assignee' }, { context, seasonId: season, assignedByEmail: 'owner@test.com' })).ok, true)
    assert.equal(db.state.customer_requests[0].assigned_to_email, 'staff@test.com')
  })

  it('scopes agreement, status and finalization while preserving saved-amount restrictions', async () => {
    const db = fixture(), { context } = await attach(db)
    assert.equal((await recordPublicCustomerAgreementPendingFinalization(db, WEB, season, context)).ok, true)
    db.state.quotations[0].accepted_amount_paise = null
    assert.equal((await finalizeAdminCustomerRequest(db, A, { ...actor, context })).code, 'agreed_amount_required')
    db.state.quotations[0].accepted_amount_paise = 10000
    assert.equal((await finalizeAdminCustomerRequest(db, A, { ...actor, context })).ok, true)
    assert.equal(db.state.customer_requests[0].finalization_status, 'finalized')
    assert.equal(db.state.customer_requests[0].closed_by_email, 'owner@test.com')
    assert.equal(db.state.customer_requests.find(r => r.id === B).status, 'quoted')
  })

  it('rejects mismatched active quotation ownership before finalization', async () => {
    const db = fixture(), { context } = await attach(db)
    db.state.quotations[0].location_id = 'loc-b'
    const before = structuredClone(db.state)
    await assert.rejects(finalizeAdminCustomerRequest(db, A, { ...actor, context }), e => e.status === 409)
    assert.deepEqual(db.state, before)
  })

  it('preserves bill calculations using older owned catalogue provenance', async () => {
    const db = fixture(), { context } = await attach(db)
    db.state.customer_request_items.push({ request_id: A, line_number: 2, product_id: null, family_pack_id: 'FP001', product_name: 'A pack', quantity: 1, unit_price_paise: 5000 })
    const preview = await previewPendingCustomerRequestBillAdjust(db, A, [{ productId: 'P001', quantity: 2 }], season, context)
    assert.equal(preview.ok, true); assert.equal(preview.preview.customerSellingSubtotalPaise, 25000)
    const result = await adjustPendingCustomerRequestBill(db, A, [{ productId: 'P001', quantity: 2 }], { seasonId: season, context, adjustedByEmail: 'owner@test.com' })
    assert.equal(result.ok, true)
    const current = db.state.quotations.find(q => q.customer_request_id === A && q.status !== 'void')
    assert.equal(current.location_id, 'loc-a'); assert.equal(current.season_id, season)
    assert.equal(current.total_paise, 25000)
    assert.deepEqual(db.state.customer_request_items.filter(i => i.request_id === A).map(i => i.quantity), [2, 1])
    assert.equal(db.state.customer_request_items.find(i => i.request_id === B).product_id, 'P002')
  })

  it('rejects foreign adjustment products and family-pack lines without a write', async () => {
    const db = fixture(), { context } = await attach(db), before = structuredClone(db.state)
    assert.equal((await previewPendingCustomerRequestBillAdjust(db, A, [{ productId: 'P002', quantity: 1 }], season, context)).ok, false)
    assert.deepEqual(db.state, before)
    db.state.customer_request_items.push({ request_id: A, line_number: 2, product_id: null, family_pack_id: 'FP002', product_name: 'Foreign', quantity: 1 })
    await assert.rejects(adjustPendingCustomerRequestBill(db, A, [{ productId: 'P001', quantity: 1 }], { seasonId: season, context }), e => e.status === 409)
  })

  it('retains ownership predicates after a request moves between lookup and update', async () => {
    const db = fixture(), { context } = await attach(db)
    db.beforeRun = (sql, state) => { if (sql.startsWith('UPDATE customer_requests')) state.customer_requests[0].location_id = 'loc-b' }
    assert.equal((await updateAdminCustomerRequestStatus(db, A, 'closed', { ...actor, context })).status, 404)
    assert.equal(db.state.customer_requests[0].status, 'quoted')
  })

  it('fails an adjustment batch rather than writing foreign children after ownership changes', async () => {
    const db = fixture(), { context } = await attach(db)
    let expected
    db.beforeBatch = state => { state.products[0].location_id = 'loc-b'; expected = structuredClone(state) }
    const result = await adjustPendingCustomerRequestBill(db, A, [{ productId: 'P001', quantity: 2 }], { seasonId: season, context })
    assert.equal(result.ok, false)
    assert.deepEqual(db.state, expected)
  })

  it('rejects missing operating season/context and unsupported/unrestricted SQL in enabled mode', async () => {
    const db = fixture(), { context } = await attach(db)
    await assert.rejects(getAdminCustomerRequestById(db, A, undefined, context), e => e.status === 403)
    await assert.rejects(listAdminCustomerRequests(db, { limit: 25, offset: 0, context }), e => e.status === 403)
    await assert.rejects(markCustomerRequestPendingFinalization(db, A, season, { locationModeEnabled: true }), e => e.status === 403)
    const scoped = customerRequestDb(db, season, context)
    assert.throws(() => scoped.prepare('SELECT * FROM private_rates').bind(), /Unsupported statement/)
    assert.throws(() => scoped.prepare('SELECT * FROM products').bind(), /Unsupported statement/)
    const all = await scoped.prepare('SELECT id FROM customer_requests').bind().all()
    assert.deepEqual(all.results.map(r => r.id).sort(), [A, WEB].sort())
  })

  it('passes context through list/detail/assignment/adjustment/finalization routes', async () => {
    const db = fixture()
    const call = async options => { const { req } = await attach(db, options); return handleAdminCustomerRequestRoutes(req, { DB: db }, new URL(req.url), { email: 'owner@test.com' }) }
    assert.equal((await (await call({})).json()).pagination.total, 2)
    assert.equal((await call({ path: '/' + A })).status, 200)
    for (const [path, method, payload] of [[B, 'GET'], [B + '/status', 'PATCH', { status: 'closed' }], [B + '/assign', 'PATCH', { assigneeUserId: 'assignee' }], [B + '/finalize', 'PATCH'], [B + '/adjust-bill/preview', 'POST', { items: [{ productId: 'P001', quantity: 1 }] }]]) {
      assert.equal((await call({ path: '/' + path, method, payload })).status, 404)
    }
    db.state.customer_request_items[0].product_id = 'P002'
    assert.equal((await call({ path: '/' + A })).status, 409)
  })
})
