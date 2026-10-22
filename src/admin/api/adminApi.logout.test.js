import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

/** @type {typeof fetch | undefined} */
let originalFetch

describe('logoutAdmin', () => {
  before(() => {
    originalFetch = globalThis.fetch
  })

  after(() => {
    if (originalFetch) globalThis.fetch = originalFetch
  })

  it('POSTs to the admin logout endpoint with credentials', async () => {
    /** @type {string | undefined} */
    let capturedUrl
    /** @type {RequestInit | undefined} */
    let capturedInit

    globalThis.fetch = async (url, init) => {
      capturedUrl = String(url)
      capturedInit = init
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { logoutAdmin } = await import(`./adminApi.js?test=${Date.now()}`)
    const result = await logoutAdmin()

    assert.equal(result.ok, true)
    assert.equal(capturedUrl, '/api/admin/auth/logout')
    assert.equal(capturedInit?.method, 'POST')
    assert.equal(capturedInit?.credentials, 'include')
  })
})
