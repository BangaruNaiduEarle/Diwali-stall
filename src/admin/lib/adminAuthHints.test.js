import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { adminAuthHint } from './adminAuthHints.js'

const localProxyEnv = { DEV: true, VITE_API_BASE_URL: '' }
const prodEnv = { DEV: false, VITE_API_BASE_URL: 'https://diwali-api.example.workers.dev' }

describe('adminAuthHint', () => {
  it('explains local JWT workflow on 401 in Vite proxy mode', () => {
    const hint = adminAuthHint({ httpStatus: 401, errorCode: 'unauthorized' }, localProxyEnv)
    assert.match(hint, /admin:local-jwt/)
    assert.match(hint, /Production passwords do not apply/)
  })

  it('prompts password sign-in in production cross-origin mode', () => {
    const hint = adminAuthHint({ httpStatus: 401, errorCode: 'unauthorized' }, prodEnv)
    assert.match(hint, /email and password/)
    assert.doesNotMatch(hint, /admin:local-jwt/)
  })

  it('mentions wrangler dev for local network errors', () => {
    const hint = adminAuthHint({ httpStatus: 0, errorCode: 'network_error' }, localProxyEnv)
    assert.match(hint, /8787/)
  })
})
