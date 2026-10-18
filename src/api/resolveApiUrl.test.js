import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isCrossOriginApi, isLocalViteProxyMode, readApiBaseUrl } from './adminApiMode.js'
import { resolveApiUrl } from './resolveApiUrl.js'

const prodEnv = { DEV: false, VITE_API_BASE_URL: 'https://diwali-api.example.workers.dev' }
const localProxyEnv = { DEV: true, VITE_API_BASE_URL: '' }
const localCrossEnv = {
  DEV: true,
  VITE_API_BASE_URL: 'https://diwali-api.example.workers.dev',
}

describe('resolveApiUrl', () => {
  it('returns relative paths when API base is empty', () => {
    assert.equal(resolveApiUrl('/api/admin/session', localProxyEnv), '/api/admin/session')
    assert.equal(resolveApiUrl('api/public/products', localProxyEnv), '/api/public/products')
  })

  it('joins absolute Worker origin when VITE_API_BASE_URL is set', () => {
    assert.equal(
      resolveApiUrl('/api/admin/session', prodEnv),
      'https://diwali-api.example.workers.dev/api/admin/session',
    )
  })

  it('strips trailing slashes from base URL', () => {
    assert.equal(
      resolveApiUrl('/api/admin/session', { DEV: true, VITE_API_BASE_URL: 'https://api.test///' }),
      'https://api.test/api/admin/session',
    )
  })
})

describe('adminApiMode', () => {
  it('detects local Vite proxy vs cross-origin API', () => {
    assert.equal(isLocalViteProxyMode(localProxyEnv), true)
    assert.equal(isCrossOriginApi(localProxyEnv), false)
    assert.equal(isLocalViteProxyMode(localCrossEnv), false)
    assert.equal(isCrossOriginApi(localCrossEnv), true)
    assert.equal(isLocalViteProxyMode(prodEnv), false)
    assert.equal(readApiBaseUrl(prodEnv), 'https://diwali-api.example.workers.dev')
  })
})
