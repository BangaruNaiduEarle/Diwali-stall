import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'

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

  it('blocks GET /api/admin/users for season admin; allows season super_admin', async () => {
    const dbAdmin = createUsersMockDb()
    const tokenAdmin = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: ADMIN_EMAIL },
      { email: ADMIN_EMAIL },
    )
    const resAdmin = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/users', {
        headers: { 'Cf-Access-Jwt-Assertion': tokenAdmin },
      }),
      env(dbAdmin),
      {},
    )
    assert.equal(resAdmin.status, 403)

    const dbSuper = createUsersMockDb()
    const tokenSuper = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: SUPER_EMAIL },
      { email: SUPER_EMAIL },
    )
    const resSuper = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/users', {
        headers: { 'Cf-Access-Jwt-Assertion': tokenSuper },
      }),
      env(dbSuper),
      {},
    )
    assert.equal(resSuper.status, 200)
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
  /** @type {Map<string, { season_id: string, admin_user_id: string, role: string, disabled_at: string | null }>} */
  const seasonMembers = new Map([
    [`${DEFAULT_ADMIN_SEASON_ID}:u-owner`, { season_id: DEFAULT_ADMIN_SEASON_ID, admin_user_id: 'u-owner', role: 'owner', disabled_at: null }],
    [`${DEFAULT_ADMIN_SEASON_ID}:u-admin`, { season_id: DEFAULT_ADMIN_SEASON_ID, admin_user_id: 'u-admin', role: 'admin', disabled_at: null }],
    [`${DEFAULT_ADMIN_SEASON_ID}:u-super`, { season_id: DEFAULT_ADMIN_SEASON_ID, admin_user_id: 'u-super', role: 'super_admin', disabled_at: null }],
  ])

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
    seasonMembers,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      /** @param {unknown[]} params */
      function stmt(params) {
        return {
          async first() {
            if (normalized.includes('FROM platform_admins')) return null
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
            if (normalized.includes('FROM season_members sm') && normalized.includes('admin_user_id = ?')) {
              const userId = String(params[0])
              const rows = []
              for (const m of seasonMembers.values()) {
                if (m.admin_user_id !== userId) continue
                rows.push({
                  season_id: m.season_id,
                  role: m.role,
                  disabled_at: m.disabled_at,
                  created_at: '2026-01-01',
                  code: '2026',
                  label: 'Diwali',
                  status: 'active',
                })
              }
              return { results: rows }
            }
            if (normalized.includes('FROM season_members sm') && normalized.includes('WHERE sm.season_id = ?')) {
              const seasonId = String(params[0])
              const rows = []
              for (const m of seasonMembers.values()) {
                if (m.season_id !== seasonId) continue
                const u = [...users.values()].find((x) => x.id === m.admin_user_id)
                if (!u) continue
                rows.push({
                  id: u.id,
                  email: u.email,
                  display_name: u.display_name,
                  user_disabled_at: u.disabled_at,
                  role: m.role,
                  membership_disabled_at: m.disabled_at,
                  membership_created_at: '2026-01-01',
                  created_at: u.created_at ?? '2026-01-01T00:00:00.000Z',
                  updated_at: u.updated_at ?? '2026-01-01T00:00:00.000Z',
                })
              }
              return { results: rows }
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
