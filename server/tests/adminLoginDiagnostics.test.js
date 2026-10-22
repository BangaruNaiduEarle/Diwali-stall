import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { classifyAdminLoginFailure } from '../src/lib/adminLoginDiagnostics.js'
import { hashPassword } from '../src/lib/passwordHash.js'

describe('adminLoginDiagnostics', () => {
  it('classifies missing password hash separately from mismatch', () => {
    assert.equal(
      classifyAdminLoginFailure({
        user: { passwordHash: null, disabledAt: null },
        passwordVerified: false,
      }),
      'no_password_hash',
    )
    assert.equal(
      classifyAdminLoginFailure({
        user: { passwordHash: 'pbkdf2_sha256$100000$abc', disabledAt: null },
        passwordVerified: false,
      }),
      'password_mismatch',
    )
  })
})

describe('admin login no password hash', () => {
  it('returns generic 401 when owner row has no password_hash', async () => {
    const db = createNoPasswordOwnerDb()
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner@test.com', password: 'twelvecharspw' }),
      }),
      { DB: db },
      {},
    )
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.message, 'Invalid email or password.')
    assert.equal(body.error, 'unauthorized')
  })

  it('login succeeds when password_hash is set', async () => {
    const hash = await hashPassword('twelvecharspw')
    const db = createNoPasswordOwnerDb(hash)
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner@test.com', password: 'twelvecharspw' }),
      }),
      { DB: db },
      {},
    )
    assert.equal(res.status, 200)
  })
})

/** @param {string} [passwordHash] */
function createNoPasswordOwnerDb(passwordHash = null) {
  const user = {
    id: 'owner',
    email: 'owner@test.com',
    display_name: 'Owner',
    role: 'owner',
    password_hash: passwordHash,
    disabled_at: null,
  }
  return {
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM admin_users WHERE lower(email)')) {
                return user.email === String(params[0]).toLowerCase() ? { ...user } : null
              }
              if (normalized.includes('COUNT(*)') && normalized.includes('admin_login_attempts')) {
                return { n: 0 }
              }
              return null
            },
            async run() {
              if (normalized.startsWith('INSERT INTO admin_sessions')) {
                return { meta: { changes: 1 } }
              }
              if (normalized.startsWith('INSERT INTO admin_login_attempts')) {
                return { meta: { changes: 1 } }
              }
              if (normalized.startsWith('UPDATE admin_users SET password_hash')) {
                user.password_hash = String(params[0])
              }
              return { meta: { changes: 1 } }
            },
          }
        },
      }
    },
  }
}
