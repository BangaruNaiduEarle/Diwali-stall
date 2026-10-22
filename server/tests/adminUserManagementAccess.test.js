import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'

const LOCAL_SECRET = 'local-dev-secret-at-least-32-characters-long'
const OWNER_EMAIL = 'owner@example.com'
const SUPER_EMAIL = 'super@example.com'
const ADMIN_EMAIL = 'staff@example.com'

describe('admin user management access', () => {
  it('session returns owner role from D1 for owner account', async () => {
    const db = createUsersMockDb()
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: OWNER_EMAIL },
      { email: OWNER_EMAIL },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/session', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      env(db),
      {},
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.role, 'owner')
  })

  it('blocks GET /api/admin/users for admin and super_admin', async () => {
    for (const [email, role] of [
      [ADMIN_EMAIL, 'admin'],
      [SUPER_EMAIL, 'super_admin'],
    ]) {
      const db = createUsersMockDb()
      const token = await signLocalDevAdminJwt(
        { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: email },
        { email },
      )
      const res = await worker.fetch(
        new Request('http://127.0.0.1/api/admin/users', {
          headers: { 'Cf-Access-Jwt-Assertion': token },
        }),
        env(db),
        {},
      )
      assert.equal(res.status, 403, `${role} should be forbidden`)
    }
  })

  it('allows GET /api/admin/users for owner', async () => {
    const db = createUsersMockDb()
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: OWNER_EMAIL },
      { email: OWNER_EMAIL },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/users', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      env(db),
      {},
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(Array.isArray(body.users))
  })
})

function env(db) {
  return {
    DB: db,
    ADMIN_LOCAL_DEV_AUTH: '1',
    ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET,
    ADMIN_LOCAL_DEV_EMAIL: OWNER_EMAIL,
  }
}

function createUsersMockDb() {
  const users = new Map([
    [
      OWNER_EMAIL.toLowerCase(),
      {
        id: 'u-owner',
        email: OWNER_EMAIL,
        display_name: 'Owner',
        role: 'owner',
        password_hash: 'x',
        disabled_at: null,
      },
    ],
    [
      ADMIN_EMAIL.toLowerCase(),
      {
        id: 'u-admin',
        email: ADMIN_EMAIL,
        display_name: 'Staff',
        role: 'admin',
        password_hash: 'x',
        disabled_at: null,
      },
    ],
    [
      SUPER_EMAIL.toLowerCase(),
      {
        id: 'u-super',
        email: SUPER_EMAIL,
        display_name: 'Super',
        role: 'super_admin',
        password_hash: 'x',
        disabled_at: null,
      },
    ],
  ])

  return {
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      /** @param {unknown[]} params */
      function stmt(params) {
        return {
          async first() {
            if (normalized.includes('FROM admin_users WHERE lower(email)')) {
              const u = users.get(String(params[0]).toLowerCase())
              if (!u) return null
              return { ...u }
            }
            if (normalized.includes('FROM admin_users WHERE id =')) {
              for (const u of users.values()) {
                if (u.id === String(params[0])) return { ...u }
              }
              return null
            }
            return null
          },
          async all() {
            if (normalized.includes('FROM admin_users ORDER BY')) {
              return {
                results: [...users.values()].map((u) => ({
                  ...u,
                  created_at: u.created_at ?? '2026-01-01T00:00:00.000Z',
                  updated_at: u.updated_at ?? '2026-01-01T00:00:00.000Z',
                })),
              }
            }
            return { results: [] }
          },
          async run() {
            return { meta: { changes: 1 } }
          },
        }
      }

      const base = stmt([])
      return {
        bind(...params) {
          return stmt(params)
        },
        first: () => base.first(),
        all: () => base.all(),
        run: () => base.run(),
      }
    },
  }
}
