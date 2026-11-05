import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { clearAdminActiveSeasonId, setAdminActiveSeasonId, setAdminLocationSelection, setAdminRequestIdentity } from './adminSeasonRequest.js'
import { invalidateAdminReadCache } from './adminReadCache.js'
import { apiRequest, cachedApiRequest } from './client.js'
import { fetchAdminCategories, fetchAdminProductsPage } from './adminApi.js'

const originalFetch = globalThis.fetch, originalNow = Date.now
const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
const data = { categories: [{ slug: 'a', label: 'A' }], products: [{ id: 'P001', stockStatus: 'available' }], pagination: { total: 1 } }
const search = (q = 'flower', signal) => fetchAdminProductsPage({ q, categorySlug: 'a', page: 1, limit: 12, flexSearch: true }, { signal, cacheSearch: true })
function select({ business = 'business-a', location = 'stall-a', season = 'season-a', user = 'u1', role = 'owner', capabilities = {} } = {}) {
  setAdminActiveSeasonId(season)
  setAdminLocationSelection({ locationModeEnabled: true, activeBusinessId: business, activeLocationId: location })
  setAdminRequestIdentity({ userId: user, email: user + '@test.com', role, effectiveRole: role, capabilities })
}
beforeEach(() => { clearAdminActiveSeasonId(); invalidateAdminReadCache(); select(); globalThis.fetch = async () => json(data) })
afterEach(() => { clearAdminActiveSeasonId(); invalidateAdminReadCache(); globalThis.fetch = originalFetch; Date.now = originalNow })

test('category remounts coalesce and cached response consumers cannot mutate each other', async () => {
  let calls = 0, finish
  globalThis.fetch = () => { calls++; return new Promise(resolve => { finish = resolve }) }
  const a = fetchAdminCategories(), b = fetchAdminCategories()
  await Promise.resolve()
  assert.equal(calls, 1)
  finish(json(data))
  const [first, second] = await Promise.all([a, b])
  first.categories[0].label = 'Edited locally'
  assert.equal(second.categories[0].label, 'A')
  assert.equal((await fetchAdminCategories()).categories[0].label, 'A')
  assert.equal(calls, 1)
})

test('search keys include query/category and every user, permission and operational scope', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; return json(data) }
  await search(); await search()
  assert.equal(calls, 1)
  await search('pot')
  await fetchAdminProductsPage({ q: 'pot', categorySlug: 'b', page: 1, limit: 12, flexSearch: true }, { cacheSearch: true })
  assert.equal(calls, 3)
  for (const scope of [{ business: 'business-b' }, { location: 'stall-b' }, { season: 'season-b' }, { user: 'u2' }, { role: 'admin' }, { capabilities: { finalPrice: true } }]) {
    select(scope); await search()
  }
  assert.equal(calls, 9)
  clearAdminActiveSeasonId(); select(); await search()
  assert.equal(calls, 10)
})

test('categories and searches expire independently; mutations invalidate both', async () => {
  let now = 1000, calls = 0
  Date.now = () => now
  globalThis.fetch = async () => { calls++; return json(data) }
  await fetchAdminCategories(); await search()
  now += 2001
  await fetchAdminCategories(); await search()
  assert.equal(calls, 3)
  now += 60001
  await fetchAdminCategories()
  assert.equal(calls, 4)
  await apiRequest('/api/admin/categories/a', { method: 'PATCH', body: '{}' })
  await fetchAdminCategories(); await search()
  assert.equal(calls, 7)
  await apiRequest('/api/admin/products/P001/status', { method: 'PATCH', body: '{}' })
  await search()
  assert.equal(calls, 9)
})

test('one cancelled subscriber does not cancel a shared search; unused searches abort', async () => {
  let finish, transport, calls = 0
  globalThis.fetch = (_url, init) => { calls++; transport = init.signal; return new Promise(resolve => { finish = resolve }) }
  const first = new AbortController(), second = new AbortController()
  const a = search('flower', first.signal)
  await Promise.resolve()
  first.abort()
  const b = search('flower', second.signal)
  assert.equal((await a).error, 'aborted')
  assert.equal(transport.aborted, false)
  assert.equal(calls, 1)
  finish(json(data)); assert.equal((await b).ok, true)
  const unused = new AbortController(), pending = search('new', unused.signal)
  await Promise.resolve(); unused.abort()
  assert.equal((await pending).error, 'aborted')
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(transport.aborted, true)
  finish(json(data))
})

test('late responses cannot repopulate cache after mutations or scope changes', async () => {
  let finish
  globalThis.fetch = (url) => String(url).includes('/products?') ? new Promise(resolve => { finish = resolve }) : Promise.resolve(json(data))
  const pending = search()
  await Promise.resolve()
  await apiRequest('/api/admin/products/P001', { method: 'PATCH', body: '{}' })
  finish(json(data)); assert.equal((await pending).error, 'stale_context')
  const previous = search()
  await Promise.resolve(); select({ user: 'another' }); finish(json(data))
  assert.equal((await previous).error, 'stale_context')
})

test('authorization errors invalidate cached references; billing/payment GETs are never cached', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; return json(data) }
  await fetchAdminCategories()
  globalThis.fetch = async () => { calls++; return json({ message: 'Denied' }, 403) }
  assert.equal((await search()).status, 403)
  globalThis.fetch = async () => { calls++; return json(data) }
  await fetchAdminCategories()
  for (const path of ['/api/admin/customer-requests/r/payments', '/api/admin/customer-requests/r/quotation']) {
    await cachedApiRequest(path); await cachedApiRequest(path)
  }
  assert.equal(calls, 7)
})
