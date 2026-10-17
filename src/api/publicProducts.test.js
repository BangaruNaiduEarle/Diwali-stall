import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PUBLIC_PRODUCTS_PAGE_LIMIT,
  fetchAllPublicProducts,
  fetchPublicProductsPage,
} from './publicProducts.js'

describe('publicProducts API client', () => {
  it('fetchPublicProductsPage builds limit/offset query', async () => {
    let capturedUrl = ''
    const fetchMock = async (url) => {
      capturedUrl = String(url)
      return new Response(JSON.stringify({ products: [{ id: 'P001' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await fetchPublicProductsPage({ limit: 50, offset: 100 }, fetchMock)
    assert.equal(result.ok, true)
    assert.match(capturedUrl, /limit=50/)
    assert.match(capturedUrl, /offset=100/)
  })

  function offsetFromRequestUrl(url) {
    const match = String(url).match(/[?&]offset=(\d+)/)
    return match ? Number(match[1]) : 0
  }

  it('fetchAllPublicProducts pages until a short batch', async () => {
    const calls = []
    const fetchMock = async (url) => {
      calls.push(String(url))
      const offset = offsetFromRequestUrl(url)
      if (offset === 0) {
        const batch = Array.from({ length: PUBLIC_PRODUCTS_PAGE_LIMIT }, (_, i) => ({
          id: `P${String(i + 1).padStart(3, '0')}`,
        }))
        return new Response(JSON.stringify({ products: batch }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ products: [{ id: 'P101' }, { id: 'P102' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await fetchAllPublicProducts(fetchMock)
    assert.equal(result.ok, true)
    assert.equal(calls.length, 2)
    assert.equal(result.products.length, PUBLIC_PRODUCTS_PAGE_LIMIT + 2)
  })

  it('fetchAllPublicProducts dedupes product ids across pages', async () => {
    const fetchMock = async (url) => {
      const offset = offsetFromRequestUrl(url)
      if (offset === 0) {
        const batch = Array.from({ length: PUBLIC_PRODUCTS_PAGE_LIMIT - 1 }, (_, i) => ({
          id: `P${String(i + 1).padStart(3, '0')}`,
        }))
        batch.push({ id: 'P100' })
        return new Response(JSON.stringify({ products: batch }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ products: [{ id: 'P100' }, { id: 'P101' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await fetchAllPublicProducts(fetchMock)
    assert.equal(result.ok, true)
    assert.equal(result.products.length, PUBLIC_PRODUCTS_PAGE_LIMIT + 1)
    assert.equal(result.products.filter((p) => p.id === 'P100').length, 1)
    assert.equal(result.products.at(-1)?.id, 'P101')
  })
})
