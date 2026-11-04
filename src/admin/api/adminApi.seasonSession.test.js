import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

/** @type {typeof fetch | undefined} */
let originalFetch

describe('admin season session API client', () => {
  before(() => {
    originalFetch = globalThis.fetch
  })

  after(() => {
    if (originalFetch) globalThis.fetch = originalFetch
  })

  it('session active season sync sends X-Admin-Season-Id on later admin requests', async () => {
    /** @type {Headers[]} */
    const headerSnapshots = []

    globalThis.fetch = async (_url, init) => {
      const headers = new Headers(init?.headers)
      headerSnapshots.push(headers)
      const path = String(_url)
      if (path.includes('/api/admin/session')) {
        return new Response(
          JSON.stringify({
            ok: true,
            email: 'owner@example.com',
            role: 'owner',
            platformAdmin: false,
            activeSeasonId: 'season-2026',
            seasonRole: 'owner',
            seasonStatus: 'active',
            memberships: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ products: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const stamp = Date.now()
    const { fetchAdminSession, fetchAdminProductsPage } = await import(`./adminApi.js?season=${stamp}`)
    const { setAdminActiveSeasonId } = await import('./adminSeasonRequest.js')
    const session = await fetchAdminSession()
    assert.equal(session.ok, true)
    if (!session.ok) return
    assert.equal(session.activeSeasonId, 'season-2026')
    setAdminActiveSeasonId(session.activeSeasonId)

    await fetchAdminProductsPage({ page: 1 })

    const sessionHeaders = headerSnapshots.find((h) => !h.get('X-Admin-Season-Id'))
    assert.ok(sessionHeaders, 'initial session fetch should not require a pre-existing season header')

    const productHeaders = headerSnapshots.find((h) => h.get('X-Admin-Season-Id') === 'season-2026')
    assert.ok(productHeaders, 'admin catalogue requests should include X-Admin-Season-Id')
  })

  it('does not attach season header to platform admin APIs', async () => {
    /** @type {Headers | undefined} */
    let platformHeaders

    globalThis.fetch = async (_url, init) => {
      platformHeaders = new Headers(init?.headers)
      return new Response(JSON.stringify({ ok: true, platformAdmin: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const stamp = Date.now()
    const { clearAdminActiveSeasonId, setAdminActiveSeasonId } = await import(
      `./adminSeasonRequest.js?platform=${stamp}`
    )
    const { apiRequest } = await import(`./client.js?platform=${stamp}`)

    clearAdminActiveSeasonId()
    setAdminActiveSeasonId('season-2026')
    await apiRequest('/api/admin/platform/session')

    assert.equal(platformHeaders?.has('X-Admin-Season-Id'), false)
  })

  it('isPlatformAdminApiPath matches platform routes only', async () => {
    const { isPlatformAdminApiPath } = await import(`./adminSeasonRequest.js?paths=${Date.now()}`)
    assert.equal(isPlatformAdminApiPath('/api/admin/platform/session'), true)
    assert.equal(isPlatformAdminApiPath('/api/admin/platform/seasons'), true)
    assert.equal(isPlatformAdminApiPath('/api/admin/products?page=1'), false)
    assert.equal(isPlatformAdminApiPath('/api/admin/session'), false)
  })
})
