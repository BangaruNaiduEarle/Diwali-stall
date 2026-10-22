import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'
import {
  createAdminUser,
  updateAdminUserRole,
} from '../src/services/adminUsersManagement.js'

const LOCAL_SECRET = 'local-dev-secret-at-least-32-characters-long'
const OWNER_EMAIL = 'owner@example.com'
const STAFF_EMAIL = 'staff@example.com'
const SUPER_EMAIL = 'super@example.com'

describe('admin user role management', () => {
  it('owner can change another user role via HTTP', async () => {
    const db = createRoleDb()
    const env = localEnv(db)
    const token = await ownerToken(env)

    const changeRes = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/users/u-staff/role', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cf-Access-Jwt-Assertion': token,
        },
        body: JSON.stringify({ role: 'super_admin' }),
      }),
      env,
      {},
    )
    assert.equal(changeRes.status, 200)
    const body = await changeRes.json()
    assert.equal(body.user.role, 'super_admin')
    assert.equal(db.users.get('u-staff')?.role, 'super_admin')
  })

  it('rejects invalid role values', async () => {
    const db = createRoleDb()
    const result = await updateAdminUserRole(db, 'u-staff', 'root')
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 400)
      assert.equal(result.code, 'validation_error')
    }
  })

  it('blocks role change for admin and super_admin', async () => {
    for (const email of [STAFF_EMAIL, SUPER_EMAIL]) {
      const db = createRoleDb()
      const env = localEnv(db)
      const token = await signLocalDevAdminJwt(
        { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: email },
        { email },
      )
      const res = await worker.fetch(
        new Request('http://127.0.0.1/api/admin/users/u-staff/role', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cf-Access-Jwt-Assertion': token,
          },
          body: JSON.stringify({ role: 'admin' }),
        }),
        env,
        {},
      )
      assert.equal(res.status, 403, email)
    }
  })

  it('prevents demoting the last active owner', async () => {
    const db = createRoleDb()
    const result = await updateAdminUserRole(db, 'u-owner', 'admin')
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 400)
      assert.match(result.message, /owner/i)
    }
  })

  it('allows demoting an owner when another active owner exists', async () => {
    const db = createRoleDb()
    db.users.set('u-owner2', {
      id: 'u-owner2',
      email: 'owner2@example.com',
      display_name: 'Owner 2',
      role: 'owner',
      password_hash: 'x',
      disabled_at: null,
    })
    const result = await updateAdminUserRole(db, 'u-owner', 'admin')
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.user.role, 'admin')
  })

  it('createAdminUser accepts admin and super_admin roles', async () => {
    const db = createRoleDb()
    const adminResult = await createAdminUser(db, {
      email: 'new-admin@test.com',
      password: 'twelvecharspw',
      role: 'admin',
    })
    assert.equal(adminResult.ok, true)
    if (adminResult.ok) assert.equal(adminResult.user.role, 'admin')

    const superResult = await createAdminUser(db, {
      email: 'new-super@test.com',
      password: 'twelvecharspw',
      role: 'super_admin',
    })
    assert.equal(superResult.ok, true)
    if (superResult.ok) assert.equal(superResult.user.role, 'super_admin')
  })

  it('createAdminUser rejects owner role', async () => {
    const db = createRoleDb()
    const result = await createAdminUser(db, {
      email: 'bad-owner@test.com',
      password: 'twelvecharspw',
      role: 'owner',
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 403)
  })

  it('list users response omits password hashes', async () => {
    const db = createRoleDb()
    const env = localEnv(db)
    const token = await ownerToken(env)
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/users', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      env,
      {},
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    const serialized = JSON.stringify(body)
    assert.doesNotMatch(serialized, /password_hash/i)
    assert.doesNotMatch(serialized, /passwordHash/i)
  })
})

async function ownerToken(env) {
  return signLocalDevAdminJwt(
    { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: OWNER_EMAIL },
    { email: OWNER_EMAIL },
  )
}

function localEnv(db) {
  return {
    DB: db,
    ADMIN_LOCAL_DEV_AUTH: '1',
    ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET,
    ADMIN_LOCAL_DEV_EMAIL: OWNER_EMAIL,
  }
}

function createRoleDb() {
  /** @type {Map<string, Record<string, unknown>>} */
  const users = new Map([
    [
      'u-owner',
      {
        id: 'u-owner',
        email: OWNER_EMAIL,
        display_name: 'Owner',
        role: 'owner',
        password_hash: 'secret-hash',
        disabled_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    [
      'u-staff',
      {
        id: 'u-staff',
        email: STAFF_EMAIL,
        display_name: 'Staff',
        role: 'admin',
        password_hash: 'secret-hash',
        disabled_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    [
      'u-super',
      {
        id: 'u-super',
        email: SUPER_EMAIL,
        display_name: 'Super',
        role: 'super_admin',
        password_hash: 'secret-hash',
        disabled_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  ])

  const db = {
    users,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      /** @param {unknown[]} params */
      function stmt(params) {
        return {
          async first() {
            if (normalized.includes('COUNT(*)') && normalized.includes("role = 'owner'")) {
              const exclude = params[0]
              let n = 0
              for (const u of users.values()) {
                if (u.role !== 'owner' || u.disabled_at) continue
                if (exclude && u.id === String(exclude)) continue
                n += 1
              }
              return { n }
            }
            if (normalized.includes('COUNT(*)') && normalized.includes('disabled_at IS NULL')) {
              let n = 0
              for (const u of users.values()) {
                if (!u.disabled_at) n += 1
              }
              return { n }
            }
            if (normalized.includes('FROM admin_users WHERE lower(email)')) {
              for (const u of users.values()) {
                if (String(u.email).toLowerCase() === String(params[0]).toLowerCase()) {
                  return { ...u }
                }
              }
              return null
            }
            if (normalized.includes('FROM admin_users WHERE id =')) {
              const u = users.get(String(params[0]))
              return u ? { ...u } : null
            }
            return null
          },
          async all() {
            if (normalized.includes('FROM admin_users ORDER BY')) {
              return {
                results: [...users.values()].map((u) => ({ ...u })),
              }
            }
            return { results: [] }
          },
          async run() {
            if (normalized.startsWith('UPDATE admin_users SET role')) {
              const u = users.get(String(params[1]))
              if (u) {
                u.role = String(params[0])
                users.set(String(params[1]), u)
              }
            }
            if (normalized.startsWith('INSERT INTO admin_users')) {
              users.set(String(params[0]), {
                id: params[0],
                email: params[1],
                display_name: params[2],
                role: params[3],
                password_hash: params[4],
                disabled_at: null,
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
              })
            }
            if (normalized.startsWith('DELETE FROM admin_sessions')) {
              /* no-op */
            }
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
  return db
}
