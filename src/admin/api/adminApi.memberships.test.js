import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createAdminUser, removeAdminLocationMember } from './adminApi.js'
import { clearAdminActiveSeasonId, setAdminActiveSeasonId, setAdminLocationSelection } from './adminSeasonRequest.js'
import { adminUserAssignmentPayload } from '../lib/adminUsersSeasonAccess.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch; clearAdminActiveSeasonId() })

test('existing-login assignment sends only email/role and trusted selected-stall headers', async () => {
  setAdminActiveSeasonId('season-2026')
  setAdminLocationSelection({ locationModeEnabled: true, activeLocationId: 'fixture-north', activeBusinessId: 'fixture-business' })
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/api/admin/users')
    assert.equal(init.method, 'POST')
    assert.equal(init.headers.get('X-Admin-Season-Id'), 'season-2026')
    assert.equal(init.headers.get('X-Admin-Location-Id'), 'fixture-north')
    assert.equal(init.credentials, 'include')
    assert.deepEqual(JSON.parse(init.body), { email: 'member@test.com', role: 'owner', existingOnly: true })
    return Response.json({ user: { id: 'member' } }, { status: 201 })
  }
  const result = await createAdminUser(adminUserAssignmentPayload({ email: 'member@test.com', role: 'owner', password: 'not-sent' }, true, true))
  assert.equal(result.ok, true)
})

test('removal uses DELETE scoped to the selected stall without deleting the login', async () => {
  setAdminActiveSeasonId('season-2026')
  setAdminLocationSelection({ locationModeEnabled: true, activeLocationId: 'fixture-south', activeBusinessId: 'fixture-business' })
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/api/admin/users/member')
    assert.equal(init.method, 'DELETE')
    assert.equal(init.headers.get('X-Admin-Location-Id'), 'fixture-south')
    assert.equal(init.body, undefined)
    return Response.json({ ok: true })
  }
  assert.equal((await removeAdminLocationMember('member')).ok, true)
})

test('membership removal fails locally without an authorized selected stall', async () => {
  setAdminActiveSeasonId('season-2026')
  setAdminLocationSelection({ locationModeEnabled: true })
  globalThis.fetch = async () => assert.fail('No request should be sent')
  assert.equal((await removeAdminLocationMember('member')).error, 'location_context_required')
})
