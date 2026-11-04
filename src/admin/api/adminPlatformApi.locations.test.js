import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createPlatformLocation } from './adminPlatformApi.js'
import { setAdminActiveSeasonId, setAdminLocationSelection, clearAdminActiveSeasonId } from './adminSeasonRequest.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch; clearAdminActiveSeasonId() })
const body = { businessId: 'business-diwali', seasonId: 'season-2026', operatingYear: 2026, ownerUserId: 'u-1', slug: 'east', name: 'East stall' }
const response = { location: { id: 'new-id', businessId: body.businessId, slug: body.slug, name: body.name, status: 'active' },
  association: { locationId: 'new-id', seasonId: body.seasonId, operatingYear: 2026, status: 'active' },
  owner: { userId: 'u-1', seasonRole: 'owner', locationRole: 'owner' } }

test('posts provisioning through the existing platform client without operational context headers', async () => {
  setAdminActiveSeasonId('season-2099')
  setAdminLocationSelection({ locationModeEnabled: true, activeLocationId: 'old', activeBusinessId: 'old-business' })
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /\/api\/admin\/platform\/locations$/)
    assert.equal(init.method, 'POST')
    assert.equal(init.credentials, 'include')
    assert.equal(init.headers.has('X-Admin-Season-Id'), false)
    assert.equal(init.headers.has('X-Admin-Location-Id'), false)
    assert.deepEqual(JSON.parse(init.body), body)
    return Response.json(response, { status: 201 })
  }
  assert.deepEqual(await createPlatformLocation(body), { ok: true, ...response })
})

test('preserves duplicate and authorization feedback', async () => {
  for (const status of [403, 409]) {
    globalThis.fetch = async () => Response.json({ error: 'rejected', message: 'No stall was created.' }, { status })
    const result = await createPlatformLocation(body)
    assert.equal(result.ok, false)
    assert.equal(result.status, status)
    assert.equal(result.message, 'No stall was created.')
  }
})

test('rejects malformed or mismatched success responses', async () => {
  for (const data of [{}, { ...response, owner: { ...response.owner, userId: 'other' } },
    { ...response, association: { ...response.association, seasonId: 'season-2099' } }]) {
    globalThis.fetch = async () => Response.json(data, { status: 201 })
    assert.equal((await createPlatformLocation(body)).error, 'invalid_response')
  }
})
