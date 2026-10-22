import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ADMIN_DEV_JWT_SUPPRESS_COOKIE,
  ADMIN_SESSION_COOKIE,
  buildDevJwtSuppressClearCookie,
  buildDevJwtSuppressSetCookie,
  buildSessionClearCookie,
  buildSessionSetCookie,
  isDevJwtSuppressActive,
  resolveSessionCookieOptions,
} from '../src/lib/adminSessionCookie.js'

describe('adminSessionCookie', () => {
  it('uses SameSite=None for direct HTTPS Worker requests', () => {
    const req = new Request('https://diwali-api.example.workers.dev/api/admin/auth/login')
    const opts = resolveSessionCookieOptions(req, {
      CORS_ALLOWED_ORIGINS: 'https://diwali-stall.vercel.app',
    })
    assert.equal(opts.sameSite, 'None')
    assert.equal(opts.secure, true)
    const header = buildSessionSetCookie('abc', 3600, opts)
    assert.match(header, /SameSite=None/)
    assert.ok(header.includes(`${ADMIN_SESSION_COOKIE}=abc`))
  })

  it('uses SameSite=Lax when X-Forwarded-Host matches an allowed frontend origin', () => {
    const req = new Request('https://diwali-api.example.workers.dev/api/admin/auth/login', {
      headers: { 'X-Forwarded-Host': 'diwali-stall.vercel.app' },
    })
    const opts = resolveSessionCookieOptions(req, {
      CORS_ALLOWED_ORIGINS: 'https://diwali-stall.vercel.app,http://localhost:5173',
    })
    assert.equal(opts.sameSite, 'Lax')
    const header = buildSessionSetCookie('abc', 3600, opts)
    assert.match(header, /SameSite=Lax/)
    assert.doesNotMatch(header, /SameSite=None/)
  })

  it('detects dev JWT suppress cookie', () => {
    const active = new Request('https://example.com/', {
      headers: { Cookie: `${ADMIN_DEV_JWT_SUPPRESS_COOKIE}=1` },
    })
    const inactive = new Request('https://example.com/', {
      headers: { Cookie: `${ADMIN_DEV_JWT_SUPPRESS_COOKIE}=0` },
    })
    assert.equal(isDevJwtSuppressActive(active), true)
    assert.equal(isDevJwtSuppressActive(inactive), false)
  })

  it('dev JWT suppress set/clear cookies mirror session cookie options', () => {
    const opts = { secure: false, sameSite: 'Lax' }
    assert.match(buildDevJwtSuppressSetCookie(3600, opts), /SameSite=Lax/)
    assert.ok(buildDevJwtSuppressSetCookie(3600, opts).includes(`${ADMIN_DEV_JWT_SUPPRESS_COOKIE}=1`))
    assert.match(buildDevJwtSuppressClearCookie(opts), /Max-Age=0/)
  })

  it('clear cookie uses the same SameSite as set cookie for proxy requests', () => {
    const req = new Request('https://diwali-api.example.workers.dev/api/admin/auth/logout', {
      headers: { 'X-Forwarded-Host': 'diwali-stall.vercel.app' },
    })
    const opts = resolveSessionCookieOptions(req, {
      CORS_ALLOWED_ORIGINS: 'https://diwali-stall.vercel.app',
    })
    const setHeader = buildSessionSetCookie('sess', 3600, opts)
    const clearHeader = buildSessionClearCookie(opts)
    assert.match(setHeader, /SameSite=Lax/)
    assert.match(clearHeader, /SameSite=Lax/)
    assert.match(clearHeader, /Max-Age=0/)
    assert.ok(clearHeader.startsWith(`${ADMIN_SESSION_COOKIE}=;`))
  })
})
