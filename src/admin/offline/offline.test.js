import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { openOfflineStorage, offlineScopeKey } from './storage.js'
import { synchronizeOutbox } from './synchronize.js'

const scope = { businessId: 'shop', locationId: 'a', seasonId: '2026', userId: 'owner', deviceId: 'device-one' }
const draft = () => ({ draftId: crypto.randomUUID(), body: { customer: { name: 'Guest', mobile: '9876543210' }, items: [{ productId: 'P001', quantity: 1 }] } })
const create = () => ({ kind: 'CREATE', body: { customer: { name: 'Guest', mobile: '9876543210' }, items: [{ productId: 'P001', quantity: 1 }] } })
async function setup(role = 'owner') {
  const indexedDB = new IDBFactory(), name = crypto.randomUUID()
  const storage = await openOfflineStorage({ indexedDB, name })
  await storage.activate({ scope, role, writable: true }, [{ id: 'P001', selling_price_paise: 10000 }])
  return { storage, indexedDB, name }
}
const run = (storage, send, more = {}) => synchronizeOutbox({ storage, scope, deviceToken: 'ab'.repeat(32), send, fetchSnapshot: async () => ({ ok: true, request: { id: 'server-request', revision: 9, status: 'closed' } }), ...more })
const ack = payload => ({ ok: true, operationId: payload.operationId, requestId: 'server-request', revision: 3, receivedAt: '2026-11-03T12:00:00.000Z' })

test('real IndexedDB transactions retain drafts, versions, catalogue, device and outbox across database close/reopen', async () => {
  const { storage, indexedDB, name } = await setup(), identity = await storage.device()
  const saved = await storage.saveDraft(scope, draft(), create())
  await storage.saveDraft(scope, { ...saved.draft, body: { ...saved.draft.body, items: [{ productId: 'P001', quantity: 4 }] } })
  storage.close()
  const reopened = await openOfflineStorage({ indexedDB, name })
  assert.deepEqual(await reopened.device(), identity)
  assert.equal((await reopened.activeProfile()).scope.userId, scope.userId)
  assert.equal((await reopened.list('drafts', scope))[0].body.items[0].quantity, 4)
  assert.equal((await reopened.list('versions', scope)).length, 2)
  assert.equal((await reopened.list('outbox', scope))[0].payload.body.items[0].quantity, 1, 'queued input is never rewritten by later edits')
  assert.equal((await reopened.get('catalogues', scope, 'catalogue')).products[0].selling_price_paise, 10000)
  await reopened.clearActiveProfile(); assert.equal(await reopened.activeProfile(), null)
  assert.equal((await reopened.list('outbox', scope)).length, 1, 'logout keeps pending work')
  reopened.close()
})

test('all local stores are isolated by business, location, season, user and device', async () => {
  const { storage } = await setup()
  await storage.saveDraft(scope, draft(), create())
  for (const field of Object.keys(scope)) {
    const other = { ...scope, [field]: 'different' }
    assert.equal((await storage.list('drafts', other)).length, 0)
    assert.equal((await storage.list('outbox', other)).length, 0)
    assert.equal((await storage.list('versions', other)).length, 0)
    assert.equal(await storage.get('catalogues', other, 'catalogue'), undefined)
  }
  assert.throws(() => offlineScopeKey({ ...scope, deviceId: null }))
  storage.close()
})

test('atomic draft/outbox failure rolls back both and never reports a saved operation', async () => {
  const { storage } = await setup('admin')
  await assert.rejects(storage.saveDraft(scope, draft(), { kind: 'PAYMENT', body: { amountPaise: 100 } }), /Only Owner/)
  assert.equal((await storage.list('drafts', scope)).length, 0)
  assert.equal((await storage.list('outbox', scope)).length, 0)
  await assert.rejects(storage.saveDraft(scope, draft(), { kind: 'EDIT', body: { items: [{ productId: 'P001', quantity: 1, unitRatePaise: 1 }] } }), /financial/)
  storage.close()
})

test('lost acknowledgement and restart retry exactly the same immutable operation identity and occurrence', async () => {
  const { storage, indexedDB, name } = await setup()
  const saved = await storage.saveDraft(scope, draft(), create()), calls = []
  await run(storage, async input => { calls.push(input); throw Error('network dropped after commit') }, { now: () => 10 })
  assert.equal((await storage.list('outbox', scope))[0].state, 'pending')
  storage.close()
  const reopened = await openOfflineStorage({ indexedDB, name })
  await run(reopened, async input => { calls.push(input); return { ...ack(input), idempotentReplay: true } }, { now: () => 100000 })
  assert.deepEqual(calls[0], calls[1])
  const row = (await reopened.list('outbox', scope))[0]
  assert.equal(row.state, 'synced'); assert.equal(row.payload.operationId, saved.operation.operationId)
  assert.equal((await reopened.list('drafts', scope))[0].requestId, 'server-request')
  let repeated = false
  await run(reopened, async () => { repeated = true })
  assert.equal(repeated, false)
  reopened.close()
})

test('partial sync acknowledges successful operations and independent drafts while blocking a conflicting chain', async () => {
  const { storage } = await setup()
  const a = await storage.saveDraft(scope, draft(), create())
  const b = await storage.saveDraft(scope, a.draft, { kind: 'EDIT', body: { items: [{ productId: 'P001', quantity: 2 }] } })
  const c = await storage.saveDraft(scope, b.draft, { kind: 'CLOSE', body: {} })
  const independent = await storage.saveDraft(scope, draft(), create()), calls = []
  await run(storage, async input => { calls.push(input.operationId); return input.operationId === b.operation.operationId ? { ok: false, status: 409, error: 'revision_conflict' } : ack(input) })
  const rows = new Map((await storage.list('outbox', scope)).map(row => [row.payload.operationId, row]))
  assert.equal(rows.get(a.operation.operationId).state, 'synced')
  assert.equal(rows.get(b.operation.operationId).state, 'conflict')
  assert.equal(rows.get(c.operation.operationId).state, 'pending')
  assert.equal(rows.get(independent.operation.operationId).state, 'synced')
  assert.ok(!calls.includes(c.operation.operationId))
  assert.equal(rows.get(b.operation.operationId).serverSnapshot.request.revision, 9)
  assert.deepEqual(rows.get(b.operation.operationId).payload, b.operation)
  storage.close()
})

test('expired authentication and permission changes retain operations and stop further dispatch', async () => {
  for (const status of [401,403]) {
    const { storage } = await setup()
    await storage.saveDraft(scope, draft(), create()); await storage.saveDraft(scope, draft(), create())
    let count = 0
    await run(storage, async () => { count++; return { ok: false, status, error: 'forbidden' } })
    const rows = await storage.list('outbox', scope)
    assert.equal(count, 1); assert.equal(rows.filter(row => row.state === 'failed').length, 1); assert.equal(rows.filter(row => row.state === 'pending').length, 1)
    storage.close()
  }
})

test('interrupted syncing state recovers after restart; acknowledgements cannot be overwritten by a late failure', async () => {
  const { storage, indexedDB, name } = await setup(), saved = await storage.saveDraft(scope, draft(), create())
  await storage.updateOperation(scope, saved.operation.operationId, { state: 'syncing' }); storage.close()
  const reopened = await openOfflineStorage({ indexedDB, name })
  await reopened.recover(scope)
  assert.equal((await reopened.list('outbox', scope))[0].state, 'pending')
  await run(reopened, async input => ack(input))
  await reopened.updateOperation(scope, saved.operation.operationId, { state: 'failed' })
  assert.equal((await reopened.list('outbox', scope))[0].state, 'synced')
  reopened.close()
})

test('explicit conflict replacement preserves both versions, uses a new operation ID and cancels descendants', async () => {
  const { storage } = await setup()
  const a = await storage.saveDraft(scope, { ...draft(), requestId: 'server-request', expectedRevision: 1 }, { kind: 'EDIT', requestId: 'server-request', expectedRevision: 1, body: { items: [{ productId: 'P001', quantity: 2 }] } })
  const b = await storage.saveDraft(scope, a.draft, { kind: 'CLOSE', body: {} })
  await run(storage, async () => ({ ok: false, status: 409, error: 'revision_conflict' }))
  const replaced = await storage.saveDraft(scope, b.draft, { kind: 'EDIT', requestId: 'server-request', expectedRevision: 9, body: { items: [{ productId: 'P001', quantity: 3 }] } }, a.operation.operationId)
  assert.notEqual(replaced.operation.operationId, a.operation.operationId)
  const rows = await storage.list('outbox', scope), old = rows.find(row => row.payload.operationId === a.operation.operationId)
  assert.equal(old.state, 'resolved'); assert.deepEqual(old.payload, a.operation); assert.equal(old.serverSnapshot.request.status, 'closed')
  assert.equal(rows.find(row => row.payload.operationId === b.operation.operationId).state, 'discarded')
  assert.equal(replaced.operation.expectedRevision, 9); assert.equal(replaced.operation.parentOperationId, undefined)
  storage.close()
})

test('queued offline payment waits for closure and retries retain ledger operation ID and original amount', async () => {
  const { storage } = await setup()
  const close = await storage.saveDraft(scope, { ...draft(), requestId: 'server-request', expectedRevision: 1 }, { kind: 'CLOSE', requestId: 'server-request', expectedRevision: 1, body: {} })
  const pay = await storage.saveDraft(scope, close.draft, { kind: 'PAYMENT', body: { amountPaise: 2500, recordingMode: 'OFFLINE', paymentMethod: 'CASH' } })
  let attempts = 0
  const send = async input => { if (input.kind === 'PAYMENT' && ++attempts === 1) return { ok: false, status: 503 }; return ack(input) }
  await run(storage, send, { now: () => 0 }); await run(storage, send, { now: () => 100000 })
  const rows = await storage.list('outbox', scope)
  assert.ok(rows.every(row => row.state === 'synced'))
  assert.equal(rows.find(row => row.payload.kind === 'PAYMENT').payload.operationId, pay.operation.operationId)
  assert.equal(rows.find(row => row.payload.kind === 'PAYMENT').payload.body.amountPaise, 2500)
  storage.close()
})

test('competing tabs cannot silently overwrite quantities or append a stale edit behind another tab operation', async () => {
  const { storage, indexedDB, name } = await setup()
  const original = await storage.saveDraft(scope, draft())
  const otherTab = await openOfflineStorage({ indexedDB, name })
  const tabA = original.draft, tabB = structuredClone(tabA)
  const savedA = await storage.saveDraft(scope, { ...tabA, body: { ...tabA.body, items: [{ productId: 'P001', quantity: 2 }] } }, create())
  await assert.rejects(otherTab.saveDraft(scope, { ...tabB, body: { ...tabB.body, items: [{ productId: 'P001', quantity: 3 }] } }, create()), error => error.code === 'local_revision_conflict')
  const current = await otherTab.get('drafts', scope, tabA.draftId)
  assert.equal(current.body.items[0].quantity, 2); assert.equal(current.tailOperationId, savedA.operation.operationId)
  assert.equal((await otherTab.list('outbox', scope)).length, 1)
  storage.close(); otherTab.close()
  const reopened = await openOfflineStorage({ indexedDB, name })
  const conflict = (await reopened.list('versions', scope)).find(version => version.conflict)
  assert.equal(conflict.attemptedDraft.body.items[0].quantity, 3)
  assert.equal(conflict.attemptedOperation.kind, 'CREATE')
  await reopened.saveDraft(scope, { ...current, localConflictResolution: conflict.key })
  assert.ok((await reopened.list('versions', scope)).some(version => version.resolvesLocalVersion === conflict.key))
  reopened.close()
})

test('local closure is durable, prevents later item changes and allows dependent offline receipts', async () => {
  const { storage } = await setup()
  const original = await storage.saveDraft(scope, { ...draft(), requestId: 'server-request', expectedRevision: 1 })
  await assert.rejects(storage.saveDraft(scope, original.draft, { kind: 'PAYMENT', body: { amountPaise: 100 } }), /Finalize/)
  const closed = await storage.saveDraft(scope, original.draft, { kind: 'CLOSE', requestId: 'server-request', expectedRevision: 1, body: {} })
  assert.equal(closed.draft.localClosure.actorUserId, 'owner')
  assert.equal(closed.draft.localClosure.deviceId, scope.deviceId)
  await assert.rejects(storage.saveDraft(scope, closed.draft, { kind: 'EDIT', body: { items: [] } }), /queued closure/)
  const pay = await storage.saveDraft(scope, closed.draft, { kind: 'PAYMENT', body: { amountPaise: 100, paymentMethod: 'CASH', recordingMode: 'OFFLINE' } })
  assert.equal(pay.operation.parentOperationId, closed.operation.operationId)
  storage.close()
})
