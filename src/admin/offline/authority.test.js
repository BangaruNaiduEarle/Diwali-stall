import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { webcrypto } from 'node:crypto'
import { IDBFactory } from 'fake-indexeddb'
import { openOfflineStorage, offlineOperationError } from './storage.js'
import { synchronizeOutbox } from './synchronize.js'
import { fetchAdminSession } from '../api/adminApi.js'
import { clearAdminActiveSeasonId, setAdminActiveSeasonId, setAdminLocationSelection } from '../api/adminSeasonRequest.js'

const original = { indexedDB: globalThis.indexedDB, fetch: globalThis.fetch, crypto: globalThis.crypto }
const a = { businessId: 'business-a', locationId: 'a', seasonId: '2026', userId: 'subject', deviceId: 'device-one' }
const b = { ...a, businessId: 'business-b', locationId: 'b' }
const other = { ...a, userId: 'another-user' }
const opened = []
const open = async () => { const db = await openOfflineStorage(); opened.push(db); return db }
const profile = scope => ({ scope, role: 'super_admin', writable: true, handover: { privateCatalogue: [{ id: 'P001', purchase_unit_paise: 3000 }], certificate: { retained: true } } })
function authority(scope, role) {
  return { business: { id: scope.businessId, type: 'seasonal', status: 'active' },
    location: { id: scope.locationId, businessId: scope.businessId, status: 'active' },
    operatingSeason: { id: scope.seasonId, status: 'active' },
    association: { locationId: scope.locationId, seasonId: scope.seasonId, operatingYear: 2026, status: 'active' },
    seasonRole: 'owner', locationRole: role, effectiveRole: role,
    capabilities: { read: true, write: true, viewSensitiveProductPricing: role !== 'admin' } }
}
function session(rows = [authority(a, 'admin'), authority(b, 'owner')]) {
  const active = rows.find(row => row.location.id === a.locationId)
  return { ok: true, email: 'subject@test.invalid', userId: a.userId, locationModeEnabled: true, role: 'owner',
    activeSeasonId: a.seasonId, activeBusinessId: active?.business.id ?? null, activeLocationId: active?.location.id ?? null,
    seasonRole: 'owner', seasonStatus: 'active', memberships: [], authorizedLocations: rows,
    effectiveRole: active?.effectiveRole ?? null, locationRole: active?.locationRole ?? null }
}
const respond = (data, status = 200) => { globalThis.fetch = async () => new Response(JSON.stringify(data), { status }) }
async function retained(db, scope = a) {
  return { drafts: await db.list('drafts', scope), versions: await db.list('versions', scope), outbox: await db.list('outbox', scope),
    catalogue: await db.list('catalogues', scope), meta: await db.transact(['meta'], 'readonly', tx => new Promise((resolve, reject) => {
      const r = tx.objectStore('meta').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
    })) }
}
async function setup() {
  const db = await open()
  for (const scope of [other, b, a]) await db.activate(profile(scope), [{ id: 'P001', selling_price_paise: 10000 }])
  const body = { customer: { name: 'Preserved bill', mobile: '9876543210' }, items: [{ productId: 'P001', quantity: 1 }] }
  await db.saveDraft(a, { draftId: 'bill', body }, { kind: 'CREATE', body: { ...body, pricingMode: 'bargain', acceptedAmountPaise: 10000 } })
  await db.saveDraft(a, { draftId: 'qr', body }, { kind: 'HANDOVER', body: { transfer: { payload: { transferId: 'retained-transfer' } } }, requestId: 'qr-request', expectedRevision: null }, null, 'verified-transfer-fingerprint')
  return db
}
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  if (!globalThis.crypto) globalThis.crypto = webcrypto
  clearAdminActiveSeasonId(); setAdminActiveSeasonId(a.seasonId)
  setAdminLocationSelection({ locationModeEnabled: true, activeBusinessId: a.businessId, activeLocationId: a.locationId })
})
afterEach(() => {
  for (const db of opened.splice(0)) db.close()
  globalThis.indexedDB = original.indexedDB; globalThis.fetch = original.fetch
  if (!original.crypto) delete globalThis.crypto
  clearAdminActiveSeasonId()
})

test('G07-02 session confirmation durably removes populated private pricing before returning Admin authority', async () => {
  const db = await setup(), before = await retained(db), otherStall = await db.get('profiles', b, 'profile'), otherUser = await db.get('profiles', other, 'profile')
  respond(session())
  const confirmed = await fetchAdminSession()
  assert.equal(confirmed.ok, true); assert.equal(confirmed.effectiveRole, 'admin')
  const current = await db.get('profiles', a, 'profile')
  assert.equal(current.role, 'admin'); assert.deepEqual(current.handover.privateCatalogue, [])
  assert.deepEqual(await retained(db), before)
  assert.deepEqual(await db.get('profiles', b, 'profile'), otherStall)
  assert.deepEqual(await db.get('profiles', other, 'profile'), otherUser)
})

test('G07-03 close/reopen cannot restore privileged pricing or actions after confirmed demotion', async () => {
  const db = await setup(), before = await retained(db)
  respond(session()); assert.equal((await fetchAdminSession()).ok, true); db.close()
  const restarted = await open(), active = await restarted.activeProfile()
  assert.equal(active.role, 'admin'); assert.deepEqual(active.handover.privateCatalogue, [])
  assert.match(offlineOperationError(active, { kind: 'PAYMENT' }), /Only Owner/)
  assert.deepEqual(await retained(restarted), before)
  await assert.rejects(restarted.saveDraft(a, { draftId: 'denied', body: {} }, { kind: 'AGREEMENT', body: { acceptedAmountPaise: 10000 } }), /Only Owner/)
})

test('confirmed membership removal invalidates only that user/scope and survives restart without deleting pending QR work', async () => {
  const db = await setup(), before = await retained(db), permitted = await db.get('profiles', b, 'profile')
  respond(session([authority(b, 'owner')])); assert.equal((await fetchAdminSession()).ok, true); db.close()
  const restarted = await open(), active = await restarted.activeProfile()
  assert.equal(active.authorityRevoked, true); assert.equal(active.writable, false); assert.equal(active.role, null)
  assert.deepEqual(active.handover.privateCatalogue, []); assert.deepEqual(await retained(restarted), before)
  assert.deepEqual(await restarted.get('profiles', b, 'profile'), permitted)
})

for (const status of [401,403]) test(`confirmed session ${status} revokes the selected cached authority while preserving other stalls`, async () => {
  const db = await setup(), before = await retained(db), permitted = await db.get('profiles', b, 'profile')
  respond({ error: 'forbidden', message: 'Access denied.' }, status)
  assert.equal((await fetchAdminSession()).status, status)
  assert.equal((await db.activeProfile()).authorityRevoked, true)
  assert.deepEqual((await db.activeProfile()).handover.privateCatalogue, [])
  assert.deepEqual(await retained(db), before); assert.deepEqual(await db.get('profiles', b, 'profile'), permitted)
})

test('network failure and transient public/server unavailability do not invent a membership revocation', async () => {
  const db = await setup(), before = await db.activeProfile()
  globalThis.fetch = async () => { throw Error('offline') }
  assert.equal((await fetchAdminSession()).status, 0); assert.deepEqual(await db.activeProfile(), before)
  respond({ error: 'location_context_unavailable' }, 503)
  assert.equal((await fetchAdminSession()).status, 503); assert.deepEqual(await db.activeProfile(), before)
})

test('demoted sync blocks privileged dispatch locally and retains immutable bill/QR payloads', async () => {
  const db = await setup(), before = await retained(db)
  respond(session()); await fetchAdminSession()
  let sends = 0
  await synchronizeOutbox({ storage: db, scope: a, send: async () => { sends++; throw Error('Unauthorized operation dispatched') }, fetchSnapshot: async () => ({ ok: false }) })
  assert.equal(sends, 0)
  const after = await retained(db)
  assert.deepEqual(after.outbox.map(row => row.payload), before.outbox.map(row => row.payload))
  assert.equal(after.outbox.find(row => row.state === 'failed').lastError.status, 403)
  assert.equal(after.outbox.filter(row => row.state === 'pending').length, 1)
  assert.deepEqual(after.drafts, before.drafts); assert.deepEqual(after.meta, before.meta)
})

test('a later stale privileged session cannot re-elevate a durably demoted offline profile', async () => {
  const db = await setup(); respond(session()); await fetchAdminSession()
  respond(session([authority(a, 'owner'), authority(b, 'owner')])); await fetchAdminSession()
  assert.equal((await db.activeProfile()).role, 'admin'); assert.deepEqual((await db.activeProfile()).handover.privateCatalogue, [])
})

test('an in-flight sync/conflict profile copy cannot reinsert private pricing after demotion', async () => {
  const db = await setup(), stale = await db.activeProfile()
  respond(session()); await fetchAdminSession()
  await db.activate(stale, [{ id: 'P001', selling_price_paise: 10000 }]); db.close()
  const restarted = await open()
  assert.equal((await restarted.activeProfile()).role, 'admin')
  assert.deepEqual((await restarted.activeProfile()).handover.privateCatalogue, [])
})
