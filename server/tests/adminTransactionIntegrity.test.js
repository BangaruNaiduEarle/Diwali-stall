import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture, attach, season, A, actor } from './helpers/mockAdminTransactionDb.js'
import { customerRequestDb } from '../src/lib/adminCustomerRequestScope.js'
import { activeQuotationSnapshot } from '../src/lib/adminTransactionIntegrity.js'
import { createOrGetQuotationForRequest, patchActiveQuotationCustomerAgreedAmount } from '../src/services/adminQuotations.js'
import { finalizeAdminCustomerRequest } from '../src/services/adminCustomerRequests.js'
import { adjustPendingCustomerRequestBill } from '../src/services/adminCustomerRequestBillAdjust.js'

const request = db => db.state.customer_requests.find(r => r.id === A)
const quote = db => db.state.quotations.find(q => q.id === 'q-a')

for (const state of ['closed', 'finalized']) test(`rejects ${state} quotation regeneration and agreed-amount edits`, async () => {
  const db = fixture(), { context } = await attach(db)
  if (state === 'closed') request(db).status = 'closed'
  else request(db).finalization_status = 'finalized'
  const before = structuredClone(db.state)
  assert.equal((await createOrGetQuotationForRequest(db, A, { seasonId: season, context, regenerate: true })).status, 409)
  assert.equal((await patchActiveQuotationCustomerAgreedAmount(db, A, 12000, season, context)).status, 409)
  assert.deepEqual(db.state, before)
  const scoped = customerRequestDb(db, season, context, true)
  assert.equal((await scoped.prepare("UPDATE quotations SET status = 'void' WHERE id = ? AND season_id = ?").bind('q-a', season).run()).meta.changes, 0)
  assert.deepEqual(db.state, before)
})

for (const race of ['amount', 'identity', 'total', 'void', 'status', 'openStatus']) test(`finalization rejects a stale ${race} at the UPDATE boundary`, async () => {
  const db = fixture(), { context } = await attach(db)
  db.beforeRun = (sql) => {
    if (!sql.startsWith('UPDATE customer_requests') || !sql.includes("SET finalization_status = 'finalized'")) return
    db.beforeRun = null
    if (race === 'amount') quote(db).accepted_amount_paise = 13000
    if (race === 'identity') quote(db).id = 'replacement'
    if (race === 'total') quote(db).total_paise = 13000
    if (race === 'void') quote(db).status = 'void'
    if (race === 'status') request(db).status = 'void'
    if (race === 'openStatus') request(db).status = 'reviewing'
  }
  const result = await finalizeAdminCustomerRequest(db, A, { ...actor, context })
  assert.equal(result.status, 409)
  assert.equal(request(db).finalization_status, 'pending')
  const mutation = db.calls.find(c => c.mode === 'run' && c.sql.includes("SET finalization_status = 'finalized'"))
  assert.match(mutation.sql, /guard_quote.id = \?/)
  assert.match(mutation.sql, /guard_quote.accepted_amount_paise IS \?/)
  assert.match(mutation.sql, /guard_quote.location_id = customer_requests.location_id/)
  assert.match(mutation.sql, /customer_requests.location_id = \? AND customer_requests.season_id = \?/)
})

test('finalization wins first: a delayed agreed-amount mutation cannot change the closed bill', async () => {
  const db = fixture(), { context } = await attach(db)
  db.beforeRun = sql => {
    if (!sql.startsWith('UPDATE quotations')) return
    db.beforeRun = null
    request(db).status = 'closed'; request(db).finalization_status = 'finalized'
  }
  assert.equal((await patchActiveQuotationCustomerAgreedAmount(db, A, 14000, season, context)).status, 409)
  assert.equal(quote(db).accepted_amount_paise, 10000)
})

for (const action of ['regenerate', 'adjust']) test(`${action} rolls back without voiding/replacing when finalization wins before the batch`, async () => {
  const db = fixture(), { context } = await attach(db)
  const before = structuredClone({ quotes: db.state.quotations, items: db.state.customer_request_items, quoteItems: db.state.quotation_items })
  db.beforeBatch = state => {
    db.beforeBatch = null
    state.customer_requests[0].status = 'closed'; state.customer_requests[0].finalization_status = 'finalized'
  }
  const result = action === 'regenerate'
    ? await createOrGetQuotationForRequest(db, A, { seasonId: season, context, regenerate: true })
    : await adjustPendingCustomerRequestBill(db, A, [{ productId: 'P001', quantity: 2 }], { seasonId: season, context })
  assert.equal(result.status, 409)
  assert.deepEqual({ quotes: db.state.quotations, items: db.state.customer_request_items, quoteItems: db.state.quotation_items }, before)
  const firstWrite = db.calls.find(c => c.mode === 'run' && !c.sql.includes('SET audit_actor_user_id'))
  assert.match(firstWrite.sql, /^UPDATE customer_requests SET status = CASE/)
  assert.equal(request(db).finalization_status, 'finalized')
})

test('replacement rejects a stale active quotation/financial snapshot without voiding the winner', async () => {
  for (const change of [q => { q.id = 'new-active' }, q => { q.accepted_amount_paise = 15000 }]) {
    const db = fixture(), { context } = await attach(db)
    db.beforeBatch = () => { db.beforeBatch = null; change(quote(db)) }
    assert.equal((await createOrGetQuotationForRequest(db, A, { seasonId: season, context, regenerate: true })).status, 409)
    assert.equal(db.state.quotations.filter(q => q.customer_request_id === A).length, 1)
    assert.equal(db.state.quotations[0].status, 'draft')
  }
})

test('two stale agreed-amount editors do not overwrite the first winner', async () => {
  const db = fixture(), { context } = await attach(db)
  db.beforeRun = sql => { if (sql.startsWith('UPDATE quotations')) { db.beforeRun = null; quote(db).accepted_amount_paise = 15000 } }
  assert.equal((await patchActiveQuotationCustomerAgreedAmount(db, A, 12000, season, context)).status, 409)
  assert.equal(quote(db).accepted_amount_paise, 15000)
})

test('gate OFF keeps legacy finalization and quotation SQL, without location/snapshot queries', async () => {
  const db = fixture(), { context } = await attach(db, { mode: false })
  assert.equal((await finalizeAdminCustomerRequest(db, A, { ...actor, context })).ok, true)
  assert.ok(db.calls.every(c => !/location_id|guard_quote|SET status = CASE/.test(c.sql)))
})

test('financial CAS uses NULL-safe comparisons for every original financial audit field', () => {
  const snapshot = activeQuotationSnapshot({ id: 'q', acceptedAmountPaise: 100, totalPaise: 100 })
  assert.equal(snapshot.values.length, 9)
  assert.equal((snapshot.sql.match(/ IS \?/g) ?? []).length, 8)
  assert.ok(snapshot.values.includes(null))
})
