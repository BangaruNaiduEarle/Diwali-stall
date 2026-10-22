import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { ADMIN_DEV_JWT_SUPPRESS_COOKIE } from '../src/lib/adminSessionCookie.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'

const LOCAL_SECRET = 'local-dev-secret-at-least-32-characters-long'
const DEV_EMAIL = 'staff@example.com'

describe('admin logout suppresses local dev JWT', () => {
  it('after logout, session is unauthorized even when dev JWT header is present', async () => {
    const env = {
      DB: createLogoutDb(),
      ADMIN_LOCAL_DEV_AUTH: '1',
      ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET,
      ADMIN_LOCAL_DEV_EMAIL: DEV_EMAIL,
    }
    const token = await signLocalDevAdminJwt(env, { email: DEV_EMAIL })

    const sessionBefore = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/session', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      env,
      {},
    )
    assert.equal(sessionBefore.status, 200)

    const logoutRes = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/auth/logout', { method: 'POST' }),
      env,
      {},
    )
    assert.equal(logoutRes.status, 200)
    const setCookies = logoutRes.headers.getSetCookie?.() ?? [logoutRes.headers.get('Set-Cookie') ?? '']
    const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ')
    assert.ok(cookieHeader.includes(ADMIN_DEV_JWT_SUPPRESS_COOKIE))

    const sessionAfter = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/session', {
        headers: {
          Cookie: cookieHeader,
          'Cf-Access-Jwt-Assertion': token,
        },
      }),
      env,
      {},
    )
    assert.equal(sessionAfter.status, 401)
  })
})

function createLogoutDb() {
  const users = new Map([
    [
      DEV_EMAIL.toLowerCase(),
      {
        id: 'u1',
        email: DEV_EMAIL,
        display_name: 'Staff',
        role: 'admin',
        password_hash: 'x',
        disabled_at: null,
      },
    ],
  ])

  return {
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM admin_users WHERE lower(email)')) {
                const u = users.get(String(params[0]).toLowerCase())
                return u ? { ...u } : null
              }
              return null
            },
            async run() {
              return { meta: { changes: 1 } }
            },
          }
        },
      }
    },
  }
}
