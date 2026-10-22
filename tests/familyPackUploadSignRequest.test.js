import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

/** @type {typeof fetch | undefined} */
let originalFetch
/** @type {{ url: string, init: RequestInit }[]} */
let fetchCalls = []

before(() => {
  originalFetch = globalThis.fetch
  fetchCalls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    fetchCalls.push({ url, init })
    if (url.includes('/api/admin/uploads/sign')) {
      return new Response(
        JSON.stringify({
          cloudName: 'test-cloud',
          apiKey: 'test-key',
          timestamp: 1_700_000_000,
          signature: 'a'.repeat(40),
          folder: 'diwali/family-packs',
          publicId: 'FP001/1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
  }
})

after(() => {
  globalThis.fetch = originalFetch
})

describe('requestFamilyPackUploadSign', () => {
  it('POSTs familyPackId and slot to the admin sign endpoint', async () => {
    const { requestFamilyPackUploadSign } = await import('../src/admin/api/adminApi.js')
    const result = await requestFamilyPackUploadSign('FP001', 1)
    assert.equal(result.ok, true)
    assert.equal(fetchCalls.length, 1)
    assert.match(fetchCalls[0].url, /\/api\/admin\/uploads\/sign$/)
    assert.equal(fetchCalls[0].init.method, 'POST')
    const body = JSON.parse(String(fetchCalls[0].init.body))
    assert.equal(body.familyPackId, 'FP001')
    assert.equal(body.slot, 1)
    assert.equal('productId' in body, false)
  })
})
