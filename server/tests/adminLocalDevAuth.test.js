import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { authenticateAdmin } from '../src/middleware/adminAuth.js'
import {
  DEFAULT_LOCAL_JWT_TTL_SECONDS,
  LOCAL_ADMIN_JWT_AUDIENCE,
  LOCAL_ADMIN_JWT_ISSUER,
  isLocalAdminDevAuthEnabled,
  isLoopbackRequestHostname,
  signLocalDevAdminJwt,
  verifyLocalDevAdminJwt,
} from '../src/middleware/localAdminDevAuth.js'
import { SignJWT } from 'jose'

const LOCAL_SECRET = 'local-dev-secret-at-least-32-characters-long'
const ALLOWED_EMAIL = 'owner@example.com'

function localEnv(overrides = {}) {
  return {
    ADMIN_LOCAL_DEV_AUTH: '1',
    ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET,
    ADMIN_LOCAL_DEV_EMAIL: ALLOWED_EMAIL,
    ...overrides,
  }
}

function dbAllowing(email) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes('admin_users') && String(args[0]).toLowerCase() === email.toLowerCase()) {
                if (sql.includes('password_hash')) {
                  return {
                    id: 'owner',
                    email,
                    display_name: 'Owner',
                    role: 'admin',
                    password_hash: 'pbkdf2_sha256$210000$abc=',
                    disabled_at: null,
                  }
                }
                return { ok: 1 }
              }
              return null
            },
            async run() {
              return { success: true }
            },
            async all() {
              return { results: [] }
            },
          }
        },
      }
    },
  }
}

function dbDenyAll() {
  return {
    prepare() {
      return {
        bind() {
          return { async first() { return null } }
        },
      }
    },
  }
}

describe('local admin dev auth gates', () => {
  it('accepts only exact loopback hostnames', () => {
    assert.equal(isLoopbackRequestHostname(new Request('http://127.0.0.1/api/admin/session')), true)
    assert.equal(isLoopbackRequestHostname(new Request('http://localhost:8787/api/admin/session')), true)
    assert.equal(isLoopbackRequestHostname(new Request('http://[::1]:8787/api/admin/session')), true)
    assert.equal(isLoopbackRequestHostname(new Request('https://example.com/api/admin/session')), false)
    assert.equal(isLoopbackRequestHostname(new Request('https://diwali-api.workers.dev/api/admin/session')), false)
    assert.equal(isLoopbackRequestHostname(new Request('http://myapp.localhost/api/admin/session')), false)
  })

  it('requires explicit env and minimum secret length', () => {
    const req = new Request('http://127.0.0.1/api/admin/session')
    assert.equal(isLocalAdminDevAuthEnabled(localEnv(), req), true)
    assert.equal(isLocalAdminDevAuthEnabled(localEnv({ ADMIN_LOCAL_DEV_AUTH: '0' }), req), false)
    assert.equal(isLocalAdminDevAuthEnabled(localEnv({ ADMIN_LOCAL_DEV_SECRET: 'short' }), req), false)
    assert.equal(isLocalAdminDevAuthEnabled(localEnv(), new Request('https://example.com/api/admin/session')), false)
  })
})

describe('local admin dev JWT', () => {
  it('signs and verifies with fixed issuer and audience', async () => {
    const env = localEnv()
    const token = await signLocalDevAdminJwt(env, { email: ALLOWED_EMAIL, ttlSeconds: 3600 })
    const verified = await verifyLocalDevAdminJwt(token, env)
    assert.equal('error' in verified, false)
    if (!('error' in verified)) assert.equal(verified.email, ALLOWED_EMAIL)
  })

  it('rejects expired tokens', async () => {
    const env = localEnv()
    const token = await signLocalDevAdminJwt(env, {
      email: ALLOWED_EMAIL,
      ttlSeconds: 60,
      now: () => 1_000_000,
    })
    const verified = await verifyLocalDevAdminJwt(token, env)
    assert.equal('error' in verified, true)
  })

  it('rejects wrong issuer or audience', async () => {
    const key = new TextEncoder().encode(LOCAL_SECRET)
    const token = await new SignJWT({ email: ALLOWED_EMAIL })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('wrong-issuer')
      .setAudience(LOCAL_ADMIN_JWT_AUDIENCE)
      .setExpirationTime('2h')
      .sign(key)
    const verified = await verifyLocalDevAdminJwt(token, localEnv())
    assert.equal(verified.error, 'invalid_token')

    const token2 = await new SignJWT({ email: ALLOWED_EMAIL })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(LOCAL_ADMIN_JWT_ISSUER)
      .setAudience('wrong-aud')
      .setExpirationTime('2h')
      .sign(key)
    assert.equal((await verifyLocalDevAdminJwt(token2, localEnv())).error, 'invalid_token')
  })
})

describe('authenticateAdmin local vs Cloudflare', () => {
  it('allows localhost local JWT when allowlisted and CF is not configured', async () => {
    const token = await signLocalDevAdminJwt(localEnv(), {
      email: ALLOWED_EMAIL,
      ttlSeconds: DEFAULT_LOCAL_JWT_TTL_SECONDS,
    })
    const request = new Request('http://127.0.0.1/api/admin/session', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    })
    const result = await authenticateAdmin(request, { ...localEnv(), DB: dbAllowing(ALLOWED_EMAIL) })
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.identity.email, ALLOWED_EMAIL)
  })

  it('returns 403 when local JWT email is not in admin_users', async () => {
    const token = await signLocalDevAdminJwt(localEnv(), { email: 'stranger@example.com' })
    const request = new Request('http://127.0.0.1/api/admin/session', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    })
    const result = await authenticateAdmin(request, { ...localEnv(), DB: dbDenyAll() })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 403)
  })

  it('returns 401 on non-loopback when CF is not configured (no local JWT)', async () => {
    const token = await signLocalDevAdminJwt(localEnv(), { email: ALLOWED_EMAIL })
    const request = new Request('https://diwali-api.workers.dev/api/admin/session', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    })
    const result = await authenticateAdmin(request, { ...localEnv(), DB: dbAllowing(ALLOWED_EMAIL) })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 401)
      assert.equal(result.code, 'unauthorized')
    }
  })

  it('returns 401 on production-like hostname without session or CF', async () => {
    const request = new Request('https://example.com/api/admin/session')
    const result = await authenticateAdmin(request, { DB: dbDenyAll() })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 401)
      assert.equal(result.code, 'unauthorized')
    }
  })

  it('does not accept local JWT on localhost when CF Access is configured', async () => {
    const token = await signLocalDevAdminJwt(localEnv(), { email: ALLOWED_EMAIL })
    const request = new Request('http://127.0.0.1/api/admin/session', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    })
    const result = await authenticateAdmin(request, {
      ...localEnv(),
      CF_ACCESS_TEAM_DOMAIN: 'example',
      CF_ACCESS_AUD: 'test-aud',
      DB: dbAllowing(ALLOWED_EMAIL),
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 401)
  })

  it('returns 401 for invalid token when CF Access is configured (no downgrade)', async () => {
    const request = new Request('https://example.com/api/admin/session', {
      headers: { 'Cf-Access-Jwt-Assertion': 'not.a.jwt' },
    })
    const result = await authenticateAdmin(request, {
      CF_ACCESS_TEAM_DOMAIN: 'example',
      CF_ACCESS_AUD: 'test-aud',
      DB: dbAllowing(ALLOWED_EMAIL),
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 401)
  })

  it('returns 401 when CF is not configured and token is missing on loopback', async () => {
    const request = new Request('http://127.0.0.1/api/admin/session')
    const result = await authenticateAdmin(request, { ...localEnv(), DB: dbAllowing(ALLOWED_EMAIL) })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 401)
  })
})
