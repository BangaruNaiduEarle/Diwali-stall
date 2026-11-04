import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adminOperationScope, validateOperationOwnership } from '../src/lib/adminOperationScope.js'
import { fixture, attach, season, previous } from './helpers/mockAdminTransactionDb.js'

test('shared operation scope binds server-resolved business, location, season and lesser authority', async () => {
  const db = fixture()
  db.state.locationRole = 'admin'
  const { context } = await attach(db)
  const scope = adminOperationScope(db, season, context, true)
  assert.deepEqual(scope, { businessId: 'shop', locationId: 'loc-a', seasonId: season, userId: 'u-1', effectiveRole: 'admin' })
  assert.ok(Object.isFrozen(scope))
  validateOperationOwnership(scope, { businessId: 'shop', locationId: 'loc-a', seasonId: season })
  for (const change of [{ businessId: 'other' }, { locationId: 'loc-b' }, { seasonId: previous }]) {
    assert.throws(() => validateOperationOwnership(scope, { ...scope, ...change }), e => e.status === 409)
  }
  assert.throws(() => validateOperationOwnership(scope, { locationId: 'loc-a' }), e => e.status === 409)
  assert.throws(() => validateOperationOwnership({ ...scope }, scope), e => e.status === 409)
})

test('shared operation scope rejects missing, downgraded, mismatched and archived write context', async () => {
  const db = fixture(), { context } = await attach(db)
  db.calls.length = 0
  for (const value of [undefined, null, {}, { locationModeEnabled: false }]) {
    assert.throws(() => adminOperationScope(db, season, value), e => e.status === 403)
  }
  assert.throws(() => adminOperationScope(db, previous, context), e => e.status === 403)
  const archived = structuredClone(context)
  archived.locationContext.association.status = 'archived'
  assert.equal(adminOperationScope(db, season, archived).locationId, 'loc-a')
  assert.throws(() => adminOperationScope(db, season, archived, true), e => e.status === 403)
  assert.equal(db.calls.length, 0)
})

test('legacy scope retains season-only compatibility and cannot mint location ownership', async () => {
  const db = fixture(), { context } = await attach(db, { mode: false })
  const scope = adminOperationScope(db, season, context)
  assert.deepEqual(scope, { seasonId: season, locationId: null })
  assert.throws(() => validateOperationOwnership(scope, scope), e => e.status === 409)
})
