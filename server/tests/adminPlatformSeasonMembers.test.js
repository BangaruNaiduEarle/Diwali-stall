import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'

const LOCAL_SECRET = 'local-dev-secret-at-least-32-characters-long'
const PLATFORM_EMAIL = 'platform@example.com'
const ARCHIVED_SEASON_ID = 'season-archived'

describe('Platform Admin season membership API', () => {
  it('lists members for a season including disabled membership state', async () => {
    const db = createMembersDb()
    const res = await platformFetch(db, 'GET', `/api/admin/platform/seasons/${DEFAULT_ADMIN_SEASON_ID}/members`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.members.length, 1)
    assert.equal(body.members[0].email, 'owner@example.com')
    assert.equal(body.members[0].role, 'owner')
  })

  it('assigns existing login with owner role and allows multiple owners', async () => {
    const db = createMembersDb()
    const first = await platformFetch(db, 'POST', `/api/admin/platform/seasons/${DEFAULT_ADMIN_SEASON_ID}/members`, {
      email: 'staff@example.com',
      role: 'owner',
    })
    assert.equal(first.status, 201)
    const firstBody = await first.json()
    assert.equal(firstBody.member.role, 'owner')

    const second = await platformFetch(db, 'POST', `/api/admin/platform/seasons/${DEFAULT_ADMIN_SEASON_ID}/members`, {
      email: 'super@example.com',
      role: 'owner',
    })
    assert.equal(second.status, 201)
    assert.equal(db.globalUserDisabledUpdates, 0)
    assert.equal(db.platformAdminInserts, 0)
  })

  it('returns 409 for duplicate membership', async () => {
    const db = createMembersDb()
    const res = await platformFetch(db, 'POST', `/api/admin/platform/seasons/${DEFAULT_ADMIN_SEASON_ID}/members`, {
      email: 'owner@example.com',
      role: 'admin',
    })
    assert.equal(res.status, 409)
  })

  it('updates membership role', async () => {
    const db = createMembersDb()
    await platformFetch(db, 'POST', `/api/admin/platform/seasons/${DEFAULT_ADMIN_SEASON_ID}/members`, {
      email: 'staff@example.com',
      role: 'admin',
    })
    const res = await platformFetch(
      db,
      'PATCH',
      `/api/admin/platform/seasons/${DEFAULT_ADMIN_SEASON_ID}/members/u-staff`,
      { role: 'super_admin' },
    )
    assert.equal(res.status, 200)
    assert.equal(db.members.get(`${DEFAULT_ADMIN_SEASON_ID}:u-staff`)?.role, 'super_admin')
  })

  it('blocks demoting the last active owner', async () => {
    const db = createMembersDb()
    const res = await platformFetch(
      db,
      'PATCH',
      `/api/admin/platform/seasons/${DEFAULT_ADMIN_SEASON_ID}/members/u-owner`,
      { role: 'admin' },
    )
    assert.equal(res.status, 400)
  })

  it('disables membership without global account disable and protects last owner', async () => {
    const db = createMembersDb()
    await platformFetch(db, 'POST', `/api/admin/platform/seasons/${DEFAULT_ADMIN_SEASON_ID}/members`, {
      email: 'staff@example.com',
      role: 'owner',
    })

    const okDisable = await platformFetch(
      db,
      'POST',
      `/api/admin/platform/seasons/${DEFAULT_ADMIN_SEASON_ID}/members/u-staff/disable`,
    )
    assert.equal(okDisable.status, 200)
    assert.ok(db.members.get(`${DEFAULT_ADMIN_SEASON_ID}:u-staff`)?.disabled_at)
    assert.equal(db.users.get('staff@example.com')?.disabled_at, null)

    const blockLast = await platformFetch(
      db,
      'POST',
      `/api/admin/platform/seasons/${DEFAULT_ADMIN_SEASON_ID}/members/u-owner/disable`,
    )
    assert.equal(blockLast.status, 400)

    const enable = await platformFetch(
      db,
      'POST',
      `/api/admin/platform/seasons/${DEFAULT_ADMIN_SEASON_ID}/members/u-staff/enable`,
    )
    assert.equal(enable.status, 200)
    assert.equal(db.members.get(`${DEFAULT_ADMIN_SEASON_ID}:u-staff`)?.disabled_at, null)
  })

  it('allows read on archived season but blocks mutations', async () => {
    const db = createMembersDb({ includeArchived: true })
    const list = await platformFetch(db, 'GET', `/api/admin/platform/seasons/${ARCHIVED_SEASON_ID}/members`)
    assert.equal(list.status, 200)

    const post = await platformFetch(db, 'POST', `/api/admin/platform/seasons/${ARCHIVED_SEASON_ID}/members`, {
      email: 'staff@example.com',
      role: 'admin',
    })
    assert.equal(post.status, 403)
  })

  it('forbids non-platform admin', async () => {
    const db = createMembersDb()
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: 'owner@example.com' },
      { email: 'owner@example.com' },
    )
    const res = await worker.fetch(
      new Request(`http://127.0.0.1/api/admin/platform/seasons/${DEFAULT_ADMIN_SEASON_ID}/members`, {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      localEnv(db, 'owner@example.com'),
      {},
    )
    assert.equal(res.status, 403)
  })
})

/**
 * @param {ReturnType<typeof createMembersDb>} db
 * @param {string} method
 * @param {string} path
 * @param {Record<string, unknown>} [jsonBody]
 */
async function platformFetch(db, method, path, jsonBody) {
  const token = await signLocalDevAdminJwt(
    { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: PLATFORM_EMAIL },
    { email: PLATFORM_EMAIL },
  )
  const init = /** @type {RequestInit} */ ({
    method,
    headers: {
      'Cf-Access-Jwt-Assertion': token,
      ...(jsonBody ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (jsonBody) init.body = JSON.stringify(jsonBody)
  return worker.fetch(new Request(`http://127.0.0.1${path}`, init), localEnv(db, PLATFORM_EMAIL), {})
}

function localEnv(db, email) {
  return {
    DB: db,
    ADMIN_LOCAL_DEV_AUTH: '1',
    ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET,
    ADMIN_LOCAL_DEV_EMAIL: email,
  }
}

/** @param {{ includeArchived?: boolean }} [opts] */
function createMembersDb(opts = {}) {
  const seasons = new Map([
    [
      DEFAULT_ADMIN_SEASON_ID,
      {
        id: DEFAULT_ADMIN_SEASON_ID,
        code: '2026',
        label: 'Diwali 2026',
        status: 'active',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  ])
  const users = new Map([
    ['owner@example.com', { id: 'u-owner', email: 'owner@example.com', display_name: 'Owner', role: 'owner', password_hash: 'x', disabled_at: null }],
    ['staff@example.com', { id: 'u-staff', email: 'staff@example.com', display_name: 'Staff', role: 'admin', password_hash: 'x', disabled_at: null }],
    ['super@example.com', { id: 'u-super', email: 'super@example.com', display_name: 'Super', role: 'super_admin', password_hash: 'x', disabled_at: null }],
    [PLATFORM_EMAIL, { id: 'u-platform', email: PLATFORM_EMAIL, display_name: 'Platform', role: 'admin', password_hash: 'x', disabled_at: null }],
  ])

  /** @type {Map<string, { season_id: string, admin_user_id: string, role: string, disabled_at: string | null, created_at: string }>} */
  const members = new Map([
    [
      `${DEFAULT_ADMIN_SEASON_ID}:u-owner`,
      {
        season_id: DEFAULT_ADMIN_SEASON_ID,
        admin_user_id: 'u-owner',
        role: 'owner',
        disabled_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  ])

  if (opts.includeArchived) {
    seasons.set(ARCHIVED_SEASON_ID, {
      id: ARCHIVED_SEASON_ID,
      code: 'archived',
      label: 'Archived',
      status: 'archived',
      created_at: '2026-01-02T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    })
    members.set(`${ARCHIVED_SEASON_ID}:u-owner`, {
      season_id: ARCHIVED_SEASON_ID,
      admin_user_id: 'u-owner',
      role: 'owner',
      disabled_at: null,
      created_at: '2026-01-02T00:00:00.000Z',
    })
  }

  const db = {
    seasons,
    users,
    members,
    globalUserDisabledUpdates: 0,
    platformAdminInserts: 0,
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()

      /** @param {unknown[]} params */
      function stmt(params) {
        return {
          async first() {
            if (normalized.includes('FROM platform_admins')) {
              return String(params[0]) === 'u-platform' ? { ok: 1 } : null
            }
            if (normalized.includes('INSERT INTO platform_admins')) {
              db.platformAdminInserts += 1
              return { meta: { changes: 1 } }
            }
            if (normalized.includes('FROM business_seasons WHERE id =')) {
              return seasons.get(String(params[0])) ?? null
            }
            if (normalized.includes('FROM season_members') && normalized.includes('admin_user_id = ?')) {
              if (normalized.includes('INNER JOIN admin_users')) {
                const seasonId = String(params[0])
                const userId = String(params[1])
                const m = members.get(`${seasonId}:${userId}`)
                if (!m) return null
                const u = [...users.values()].find((x) => x.id === userId)
                if (!u) return null
                return {
                  admin_user_id: u.id,
                  role: m.role,
                  disabled_at: m.disabled_at,
                  created_at: m.created_at,
                  email: u.email,
                  display_name: u.display_name,
                  user_disabled_at: u.disabled_at,
                }
              }
              const seasonId = String(params[0])
              const userId = String(params[1])
              const m = members.get(`${seasonId}:${userId}`)
              if (!m) return null
              return { role: m.role, disabled_at: m.disabled_at }
            }
            if (normalized.includes('COUNT(*)') && normalized.includes('season_members')) {
              const seasonId = String(params[0])
              let exclude = ''
              if (params.length > 1) exclude = String(params[1])
              let n = 0
              for (const m of members.values()) {
                if (m.season_id !== seasonId || m.role !== 'owner' || m.disabled_at) continue
                if (exclude && m.admin_user_id === exclude) continue
                n += 1
              }
              return { n }
            }
            if (normalized.includes('FROM admin_users WHERE lower(email)')) {
              const u = users.get(String(params[0]).toLowerCase())
              return u ? { ...u, display_name: u.display_name } : null
            }
            if (normalized.includes('FROM admin_users WHERE id =')) {
              for (const u of users.values()) {
                if (u.id === String(params[0])) {
                  return {
                    id: u.id,
                    email: u.email,
                    display_name: u.display_name,
                    role: u.role,
                    password_hash: u.password_hash,
                    disabled_at: u.disabled_at,
                  }
                }
              }
              return null
            }
            if (normalized.includes('FROM season_members')) {
              return { results: [] }
            }
            return null
          },
          async all() {
            if (normalized.includes('FROM season_members sm') && normalized.includes('INNER JOIN admin_users')) {
              const seasonId = String(params[0])
              const rows = []
              for (const m of members.values()) {
                if (m.season_id !== seasonId) continue
                const u = [...users.values()].find((x) => x.id === m.admin_user_id)
                if (!u) continue
                rows.push({
                  admin_user_id: u.id,
                  role: m.role,
                  disabled_at: m.disabled_at,
                  created_at: m.created_at,
                  email: u.email,
                  display_name: u.display_name,
                  user_disabled_at: u.disabled_at,
                })
              }
              return { results: rows }
            }
            return { results: [] }
          },
          async run() {
            if (normalized.startsWith('INSERT INTO season_members')) {
              const key = `${params[0]}:${params[1]}`
              if (members.has(key)) throw new Error('UNIQUE constraint failed')
              members.set(key, {
                season_id: String(params[0]),
                admin_user_id: String(params[1]),
                role: String(params[2]),
                disabled_at: params[3] ?? null,
                created_at: new Date().toISOString(),
              })
            }
            if (normalized.startsWith('UPDATE season_members SET role')) {
              const m = members.get(`${params[1]}:${params[2]}`)
              if (m) m.role = String(params[0])
            }
            if (normalized.startsWith('UPDATE season_members SET disabled_at')) {
              const m = members.get(`${params[1]}:${params[2]}`)
              if (m) m.disabled_at = params[0] != null ? String(params[0]) : null
            }
            if (normalized.includes('UPDATE admin_users') && normalized.includes('disabled_at')) {
              db.globalUserDisabledUpdates += 1
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
