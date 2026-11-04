import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildStallRequest, createStallAndRefresh, stallBusinesses, stallOwners } from './adminPlatformStall.js'

const business = { id: 'business-diwali', type: 'seasonal', status: 'active' }
const row = { business, location: { status: 'active' }, operatingSeason: { id: 'season-2026', status: 'active' }, association: { operatingYear: 2026, status: 'active' } }
const owner = { userId: 'owner-1', role: 'owner', userDisabled: false, membershipDisabled: false }
const form = { businessId: business.id, ownerUserId: owner.userId, name: ' East stall ', slug: ' EAST-2026 ' }

test('offers only active authorized seasonal 2026 businesses without duplicates', () => {
  assert.deepEqual(stallBusinesses([row, row, { ...row, business: { ...business, status: 'archived' } },
    { ...row, business: { ...business, type: 'permanent' } }, { ...row, operatingSeason: { id: 'season-2099', status: 'active' } },
    { ...row, association: { ...row.association, status: 'archived' } }]), [business])
})

test('excludes disabled identities, memberships and lower season roles', () => {
  assert.deepEqual(stallOwners([owner, { ...owner, userDisabled: true }, { ...owner, membershipDisabled: true }, { ...owner, role: 'admin' }]), [owner])
})

test('builds the exact release-only contract without catalogue or season creation fields', () => {
  assert.deepEqual(buildStallRequest(form, [business], [owner]), { ok: true, body: {
    businessId: business.id, ownerUserId: owner.userId, name: 'East stall', slug: 'east-2026', seasonId: 'season-2026', operatingYear: 2026,
  } })
  for (const change of [{ name: '' }, { name: 'x'.repeat(201) }, { slug: 'bad code' }, { slug: 'x'.repeat(65) }, { businessId: 'other' }, { ownerUserId: 'other' }]) {
    assert.equal(buildStallRequest({ ...form, ...change }, [business], [owner]).ok, false)
  }
})

test('refreshes the shared session exactly once after creation, without selecting a stall', async () => {
  const calls = []
  const result = await createStallAndRefresh(form, {
    create: async body => { calls.push(body); return { ok: true, location: { id: 'new' } } },
    refreshSession: async () => { calls.push('refresh'); return { ok: true } },
  })
  assert.deepEqual(calls, [form, 'refresh'])
  assert.equal(result.refreshed, true)
})

test('does not refresh after duplicate or authorization errors', async () => {
  for (const status of [403, 409]) {
    const failure = { ok: false, status, message: 'Rejected' }
    assert.equal(await createStallAndRefresh(form, { create: async () => failure, refreshSession: () => assert.fail('Unexpected refresh') }), failure)
  }
})

test('keeps successful creation distinct from failed or thrown refresh, avoiding duplicate creation retries', async () => {
  for (const refreshSession of [async () => ({ ok: false }), async () => { throw Error('offline') }]) {
    const result = await createStallAndRefresh(form, { create: async () => ({ ok: true }), refreshSession })
    assert.equal(result.ok, true)
    assert.equal(result.refreshed, false)
  }
})
