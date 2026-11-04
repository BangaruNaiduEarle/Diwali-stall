import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'

const LOCAL_SECRET = 'local-dev-secret-at-least-32-characters-long'

describe('GET /api/admin/platform/session', () => {
  it('returns platform session for platform admin without season membership', async () => {
    const db = createPlatformRouteDb({ platformUserIds: new Set(['u-platform']) })
    const token = await tokenFor('platform@example.com')
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/platform/session', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      localEnv(db, 'platform@example.com'),
      {},
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.platformAdmin, true)
    assert.equal(body.userId, 'u-platform')
    assert.equal(body.email, 'platform@example.com')
  })

  it('forbids global owner role without platform_admins row', async () => {
    const db = createPlatformRouteDb({
      seasonMembers: {
        'u-owner': [{ season_id: DEFAULT_ADMIN_SEASON_ID, role: 'owner', disabled_at: null }],
      },
    })
    const token = await tokenFor('owner@example.com')
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/platform/session', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      localEnv(db, 'owner@example.com'),
      {},
    )
    assert.equal(res.status, 403)
    const body = await res.json()
    assert.equal(body.error, 'forbidden')
    assert.match(body.message, /platform admin/i)
  })

  it('forbids season super_admin without platform_admins row', async () => {
    const db = createPlatformRouteDb({
      seasonMembers: {
        'u-super': [{ season_id: DEFAULT_ADMIN_SEASON_ID, role: 'super_admin', disabled_at: null }],
      },
    })
    const token = await tokenFor('super@example.com')
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/platform/session', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      localEnv(db, 'super@example.com'),
      {},
    )
    assert.equal(res.status, 403)
  })

  it('allows platform admin with season membership and no season header', async () => {
    const db = createPlatformRouteDb({
      platformUserIds: new Set(['u-platform']),
      seasonMembers: {
        'u-platform': [{ season_id: DEFAULT_ADMIN_SEASON_ID, role: 'admin', disabled_at: null }],
      },
    })
    const token = await tokenFor('platform@example.com')
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/platform/session', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      localEnv(db, 'platform@example.com'),
      {},
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.platformAdmin, true)
  })
})

async function tokenFor(email) {
  return signLocalDevAdminJwt(
    { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: email },
    { email },
  )
}

function localEnv(db, email) {
  return {
    DB: db,
    ADMIN_LOCAL_DEV_AUTH: '1',
    ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET,
    ADMIN_LOCAL_DEV_EMAIL: email,
  }
}

/**
 * @param {{
 *   platformUserIds?: Set<string>,
 *   seasonMembers?: Record<string, { season_id: string, role: string, disabled_at: string | null }[]>,
 * }} [config]
 */
function createPlatformRouteDb(config = {}) {
  const platformUserIds = config.platformUserIds ?? new Set()
  const users = new Map([
    [
      'owner@example.com',
      {
        id: 'u-owner',
        email: 'owner@example.com',
        display_name: 'Owner',
        role: 'owner',
        password_hash: 'x',
        disabled_at: null,
      },
    ],
    [
      'super@example.com',
      {
        id: 'u-super',
        email: 'super@example.com',
        display_name: 'Super',
        role: 'super_admin',
        password_hash: 'x',
        disabled_at: null,
      },
    ],
    [
      'platform@example.com',
      {
        id: 'u-platform',
        email: 'platform@example.com',
        display_name: 'Platform',
        role: 'admin',
        password_hash: 'x',
        disabled_at: null,
      },
    ],
  ])

  const seasonRowsByUser = /** @type {Record<string, Record<string, unknown>[]>} */ ({})
  for (const [userId, rows] of Object.entries(config.seasonMembers ?? {})) {
    seasonRowsByUser[userId] = rows.map((row) => ({
      ...row,
      created_at: '2026-01-01',
      code: '2026',
      label: 'Diwali 2026',
      status: 'active',
    }))
  }

  return {
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM platform_admins')) {
                return platformUserIds.has(String(params[0])) ? { ok: 1 } : null
              }
              if (normalized.includes('FROM admin_users WHERE lower(email)')) {
                const u = users.get(String(params[0]).toLowerCase())
                return u ? { ...u } : null
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
              if (normalized.includes('FROM season_members')) {
                const userId = String(params[0])
                return { results: seasonRowsByUser[userId] ?? [] }
              }
              return { results: [] }
            },
          }
        },
      }
    },
  }
}
