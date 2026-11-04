import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'

const LOCAL_SECRET = 'local-dev-secret-at-least-32-characters-long'
const OTHER_SEASON_ID = 'season-2099'

describe('GET /api/admin/session season context', () => {
  it('returns null active season when multiple memberships and no season header', async () => {
    const db = createSessionDb()
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: 'owner@example.com' },
      { email: 'owner@example.com' },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/session', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      localEnv(db),
      {},
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.email, 'owner@example.com')
    assert.equal(body.role, 'owner')
    assert.equal(body.userId, 'u-owner')
    assert.equal(body.platformAdmin, false)
    assert.equal(body.activeSeasonId, null)
    assert.equal(body.seasonRole, null)
    assert.equal(body.seasonStatus, null)
    assert.equal(body.memberships.length, 2)
  })

  it('returns active season for single membership without header', async () => {
    const db = createSessionDb({ singleSeasonUser: true })
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: 'solo@example.com' },
      { email: 'solo@example.com' },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/session', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      localEnv(db, 'solo@example.com'),
      {},
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.activeSeasonId, DEFAULT_ADMIN_SEASON_ID)
    assert.equal(body.seasonRole, 'owner')
    assert.equal(body.seasonStatus, 'active')
    assert.equal(body.memberships.length, 1)
  })

  it('honors X-Admin-Season-Id for seasonRole across seasons', async () => {
    const db = createSessionDb()
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: 'owner@example.com' },
      { email: 'owner@example.com' },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/session', {
        headers: {
          'Cf-Access-Jwt-Assertion': token,
          'X-Admin-Season-Id': OTHER_SEASON_ID,
        },
      }),
      localEnv(db),
      {},
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.role, 'owner')
    assert.equal(body.activeSeasonId, OTHER_SEASON_ID)
    assert.equal(body.seasonRole, 'admin')
    assert.equal(body.seasonStatus, 'active')
  })

  it('does not fall back when X-Admin-Season-Id is invalid', async () => {
    const db = createSessionDb()
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: 'owner@example.com' },
      { email: 'owner@example.com' },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/session', {
        headers: {
          'Cf-Access-Jwt-Assertion': token,
          'X-Admin-Season-Id': 'season-missing',
        },
      }),
      localEnv(db),
      {},
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.activeSeasonId, null)
    assert.equal(body.seasonRole, null)
    assert.equal(body.seasonStatus, null)
    assert.equal(body.memberships.length, 2)
  })

  it('returns platformAdmin with empty memberships when user has no season rows', async () => {
    const db = createSessionDb({ platformAdminUserIds: new Set(['u-platform']) })
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: 'platform@example.com' },
      { email: 'platform@example.com' },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/session', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      localEnv(db),
      {},
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.platformAdmin, true)
    assert.deepEqual(body.memberships, [])
    assert.equal(body.activeSeasonId, null)
    assert.equal(body.seasonRole, null)
  })

  it('maps membership fields for client season pickers', async () => {
    const db = createSessionDb()
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: 'owner@example.com' },
      { email: 'owner@example.com' },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/session', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      localEnv(db),
      {},
    )
    const body = await res.json()
    const other = body.memberships.find((m) => m.seasonId === OTHER_SEASON_ID)
    assert.ok(other)
    assert.equal(other.code, '2099')
    assert.equal(other.label, 'Diwali 2099')
    assert.equal(other.status, 'active')
    assert.equal(other.role, 'admin')
    assert.equal(other.membershipDisabled, false)
  })
})

function localEnv(db, devEmail = 'owner@example.com') {
  return {
    DB: db,
    ADMIN_LOCAL_DEV_AUTH: '1',
    ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET,
    ADMIN_LOCAL_DEV_EMAIL: devEmail,
  }
}

/** @param {{ platformAdminUserIds?: Set<string>, singleSeasonUser?: boolean }} [opts] */
function createSessionDb(opts = {}) {
  const platformAdminUserIds = opts.platformAdminUserIds ?? new Set()

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
      'solo@example.com',
      {
        id: 'u-solo',
        email: 'solo@example.com',
        display_name: 'Solo',
        role: 'owner',
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

  const seasonRowsByUser = {
    'u-solo': [
      {
        season_id: DEFAULT_ADMIN_SEASON_ID,
        role: 'owner',
        disabled_at: null,
        created_at: '2026-01-01',
        code: '2026',
        label: 'Diwali 2026',
        status: 'active',
      },
    ],
    'u-owner': [
      {
        season_id: DEFAULT_ADMIN_SEASON_ID,
        role: 'owner',
        disabled_at: null,
        created_at: '2026-01-01',
        code: '2026',
        label: 'Diwali 2026',
        status: 'active',
      },
      {
        season_id: OTHER_SEASON_ID,
        role: 'admin',
        disabled_at: null,
        created_at: '2026-01-02',
        code: '2099',
        label: 'Diwali 2099',
        status: 'active',
      },
    ],
    'u-platform': [],
  }

  return {
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM platform_admins')) {
                return platformAdminUserIds.has(String(params[0])) ? { ok: 1 } : null
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
            async run() {
              return { meta: { changes: 0 } }
            },
          }
        },
      }
    },
  }
}
