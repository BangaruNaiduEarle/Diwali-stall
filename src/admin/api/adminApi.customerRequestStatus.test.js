import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

/** @type {typeof fetch | undefined} */
let originalFetch

describe('patchAdminCustomerRequestStatus', () => {
  before(() => {
    originalFetch = globalThis.fetch
  })

  after(() => {
    if (originalFetch) globalThis.fetch = originalFetch
  })

  it('PATCHes status-only JSON to the customer-request status endpoint', async () => {
    /** @type {string | undefined} */
    let capturedUrl
    /** @type {RequestInit | undefined} */
    let capturedInit

    globalThis.fetch = async (url, init) => {
      capturedUrl = String(url)
      capturedInit = init
      return new Response(JSON.stringify({ request: { id: 'req-1', status: 'reviewing' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { patchAdminCustomerRequestStatus } = await import(
      `./adminApi.js?test=${Date.now()}`
    )
    const result = await patchAdminCustomerRequestStatus('req-1', 'reviewing')

    assert.equal(result.ok, true)
    if (result.ok) {
      assert.deepEqual(result.request, { id: 'req-1', status: 'reviewing' })
    }
    assert.equal(capturedUrl, '/api/admin/customer-requests/req-1/status')
    assert.equal(capturedInit?.method, 'PATCH')
    assert.equal(capturedInit?.credentials, 'include')
    const body = JSON.parse(String(capturedInit?.body))
    assert.deepEqual(body, { status: 'reviewing' })
    assert.equal(Object.keys(body).length, 1)
  })

  it('surfaces API error messages on failure', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: 'invalid_transition',
          message: 'Cannot change status from terminal state "closed".',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )

    const { patchAdminCustomerRequestStatus } = await import(
      `./adminApi.js?test=${Date.now()}`
    )
    const result = await patchAdminCustomerRequestStatus('req-2', 'reviewing')
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 400)
      assert.match(result.message, /terminal/)
    }
  })
})
