import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'

const ADMIN_PATHS = [
  ['GET', '/api/admin/session'],
  ['GET', '/api/admin/categories'],
  ['POST', '/api/admin/categories'],
  ['PATCH', '/api/admin/categories/gift-boxes'],
  ['GET', '/api/admin/products'],
  ['POST', '/api/admin/products'],
  ['GET', '/api/admin/products/P001'],
  ['PATCH', '/api/admin/products/P001'],
  ['POST', '/api/admin/products/P001/archive'],
  ['POST', '/api/admin/products/P001/restore'],
  ['POST', '/api/admin/uploads/sign'],
  ['GET', '/api/admin/family-packs'],
  ['POST', '/api/admin/family-packs'],
  ['GET', '/api/admin/family-packs/FP001'],
  ['PUT', '/api/admin/family-packs/FP001'],
  ['PATCH', '/api/admin/family-packs/FP001/status'],
  ['DELETE', '/api/admin/family-packs/FP001'],
  ['PATCH', '/api/admin/products/P001/status'],
  ['DELETE', '/api/admin/products/P001'],
  ['GET', '/api/admin/customer-requests'],
  ['GET', '/api/admin/customer-requests/11111111-1111-4111-8111-111111111111'],
  ['PATCH', '/api/admin/customer-requests/11111111-1111-4111-8111-111111111111/status'],
  ['GET', '/api/admin/products?page=1'],
  ['PUT', '/api/admin/products/P001/private-rate'],
  ['PUT', '/api/admin/products/P001/x4-selling-rate'],
  ['PUT', '/api/admin/products/P001/purchase-rate'],
  ['POST', '/api/admin/customer-requests/11111111-1111-4111-8111-111111111111/quotation'],
  ['POST', '/api/admin/quick-bill/preview'],
  ['POST', '/api/admin/quick-bill/checkout'],
  ['GET', '/api/admin/users'],
  ['POST', '/api/admin/users'],
  ['GET', '/api/admin/does-not-exist'],
]

describe('admin catalogue routes authorization', () => {
  it('every /api/admin path fails closed before the handler without a session', async () => {
    const env = { DB: createLocalDbStub() }
    for (const [method, path] of ADMIN_PATHS) {
      const res = await worker.fetch(new Request(`https://example.com${path}`, { method }), env, {})
      assert.equal(res.status, 401, `${method} ${path}`)
      const body = await res.json()
      assert.equal(body.error, 'unauthorized', `${method} ${path}`)
    }
  })

  it('GET /api/public/products does not require auth', async () => {
    const res = await worker.fetch(
      new Request('https://example.com/api/public/products'),
      { DB: createLocalDbStub() },
      {},
    )
    assert.notEqual(res.status, 401)
    assert.notEqual(res.status, 503)
  })

  it('GET /api/public/products/:id does not require auth', async () => {
    const res = await worker.fetch(
      new Request('https://example.com/api/public/products/P001'),
      { DB: createLocalDbStub() },
      {},
    )
    assert.notEqual(res.status, 401)
    assert.notEqual(res.status, 503)
  })

  it('POST /api/public/customer-requests does not require admin auth', async () => {
    const res = await worker.fetch(
      new Request('https://example.com/api/public/customer-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: { name: 'Test User', mobile: '9876543210' },
          items: [{ productId: 'P001', quantity: 1 }],
        }),
      }),
      { DB: createLocalDbStub() },
      {},
    )
    assert.notEqual(res.status, 401)
    assert.notEqual(res.status, 503)
  })
})

function createLocalDbStub() {
  return {
    prepare() {
      return {
        bind() {
          return {
            async all() {
              return { results: [] }
            },
            async first() {
              return null
            },
            async run() {
              return { meta: { changes: 0 } }
            },
          }
        },
      }
    },
    async batch() {
      return []
    },
  }
}
