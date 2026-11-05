import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'
import {
  canCreateSeasonMemberWithRole,
} from '../src/lib/adminRoles.js'
import {
  createSeasonAdminUser,
  listSeasonAssignees,
  updateSeasonMemberRole,
} from '../src/services/adminUsersManagement.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'

const LOCAL_SECRET = 'local-dev-secret-at-least-32-characters-long'
const OTHER_SEASON_ID = 'season-2099'

describe('season user role policy helpers', () => {
  it('Owner cannot invite Super Admin; both managers may invite Admin', () => {
    assert.equal(canCreateSeasonMemberWithRole('owner', 'super_admin'), false)
    assert.equal(canCreateSeasonMemberWithRole('owner', 'admin'), true)
    assert.equal(canCreateSeasonMemberWithRole('owner', 'owner'), false)
    assert.equal(canCreateSeasonMemberWithRole('super_admin', 'admin'), true)
    assert.equal(canCreateSeasonMemberWithRole('super_admin', 'super_admin'), false)
    assert.equal(canCreateSeasonMemberWithRole('admin', 'admin'), false)
  })
})

describe('createSeasonAdminUser', () => {
  it('adds existing login to another season with a different role', async () => {
    const db = createSeasonUsersDb()
    const result = await createSeasonAdminUser(db, OTHER_SEASON_ID, 'owner', {
      email: 'staff@example.com',
      password: 'unused-for-existing',
      role: 'admin',
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.user.role, 'admin')
    const key = `${OTHER_SEASON_ID}:u-staff`
    assert.equal(db.seasonMembers.get(key)?.role, 'admin')
  })

  it('rejects duplicate membership in the same season', async () => {
    const db = createSeasonUsersDb()
    const result = await createSeasonAdminUser(db, DEFAULT_ADMIN_SEASON_ID, 'owner', {
      email: 'staff@example.com',
      password: 'twelvecharspw',
      role: 'admin',
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'conflict')
  })

  it('blocks super_admin from creating super_admin', async () => {
    const db = createSeasonUsersDb()
    const result = await createSeasonAdminUser(db, DEFAULT_ADMIN_SEASON_ID, 'super_admin', {
      email: 'new-super@test.com',
      password: 'twelvecharspw',
      role: 'super_admin',
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 403)
  })
})

describe('listSeasonAssignees', () => {
  it('excludes globally disabled and membership-disabled users', async () => {
    const db = createSeasonUsersDb()
    db.users.get('u-disabled').disabled_at = '2026-01-01'
    db.seasonMembers.set(`${DEFAULT_ADMIN_SEASON_ID}:u-muted`, {
      season_id: DEFAULT_ADMIN_SEASON_ID,
      admin_user_id: 'u-muted',
      role: 'admin',
      disabled_at: '2026-02-01',
    })
    db.users.set('u-muted', {
      id: 'u-muted',
      email: 'muted@test.com',
      display_name: 'Muted',
      role: 'admin',
      password_hash: 'x',
      disabled_at: null,
    })

    const assignees = await listSeasonAssignees(db, DEFAULT_ADMIN_SEASON_ID)
    const emails = assignees.map((u) => u.email)
    assert.ok(emails.includes('owner@example.com'))
    assert.ok(!emails.includes('disabled@test.com'))
    assert.ok(!emails.includes('muted@test.com'))
  })
})

describe('season user HTTP routes', () => {
  it('lists season members for owner and super_admin only', async () => {
    for (const [email, expectOk] of [
      ['owner@example.com', true],
      ['super@example.com', true],
      ['staff@example.com', false],
    ]) {
      const db = createSeasonUsersDb()
      const env = localEnv(db, email)
      const token = await signLocalDevAdminJwt(
        { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: email },
        { email },
      )
      const res = await worker.fetch(
        new Request('http://127.0.0.1/api/admin/users', {
          headers: { 'Cf-Access-Jwt-Assertion': token },
        }),
        env,
        {},
      )
      assert.equal(res.status, expectOk ? 200 : 403, email)
    }
  })

  it('assignees exclude season Admins regardless of global admin_users.role', async () => {
    const db = createSeasonUsersDb()
    db.seasonMembers.set(`${DEFAULT_ADMIN_SEASON_ID}:u-staff`, {
      season_id: DEFAULT_ADMIN_SEASON_ID,
      admin_user_id: 'u-staff',
      role: 'admin',
      disabled_at: null,
    })
    const env = localEnv(db, 'owner@example.com')
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: 'owner@example.com' },
      { email: 'owner@example.com' },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/users/assignees', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      env,
      {},
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    const staff = body.users.find((u) => u.email === 'staff@example.com')
    assert.equal(staff, undefined)
    assert.ok(body.users.every(u => ['owner', 'super_admin'].includes(u.role)))
  })

  it('Owner cannot promote season members to Super Admin via HTTP', async () => {
    const db = createSeasonUsersDb()
    const env = localEnv(db, 'owner@example.com')
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: 'owner@example.com' },
      { email: 'owner@example.com' },
    )
    const res = await worker.fetch(
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
    assert.equal(res.status, 403)
    assert.equal(db.seasonMembers.get(`${DEFAULT_ADMIN_SEASON_ID}:u-staff`)?.role, 'admin')
  })

  it('allows Super Admin role updates within its hierarchy', async () => {
    const db = createSeasonUsersDb()
    const env = localEnv(db, 'super@example.com')
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: 'super@example.com' },
      { email: 'super@example.com' },
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
    assert.equal(res.status, 200)
  })
})

describe('updateSeasonMemberRole service', () => {
  it('Super Admin may retain an Admin member role', async () => {
    const db = createSeasonUsersDb()
    const result = await updateSeasonMemberRole(
      db,
      DEFAULT_ADMIN_SEASON_ID,
      'super_admin',
      'u-staff',
      'admin',
    )
    assert.equal(result.ok, true)
  })
})

function localEnv(db, email) {
  return {
    DB: db,
    ADMIN_LOCAL_DEV_AUTH: '1',
    ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET,
    ADMIN_LOCAL_DEV_EMAIL: email,
  }
}

function createSeasonUsersDb() {
  /** @type {Map<string, Record<string, unknown>>} */
  const users = new Map([
    [
      'u-owner',
      {
        id: 'u-owner',
        email: 'owner@example.com',
        display_name: 'Owner',
        role: 'owner',
        password_hash: 'x',
        disabled_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    [
      'u-staff',
      {
        id: 'u-staff',
        email: 'staff@example.com',
        display_name: 'Staff',
        role: 'admin',
        password_hash: 'x',
        disabled_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    [
      'u-super',
      {
        id: 'u-super',
        email: 'super@example.com',
        display_name: 'Super',
        role: 'super_admin',
        password_hash: 'x',
        disabled_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    [
      'u-disabled',
      {
        id: 'u-disabled',
        email: 'disabled@test.com',
        display_name: 'Disabled',
        role: 'admin',
        password_hash: 'x',
        disabled_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  ])

  /** @type {Map<string, { season_id: string, admin_user_id: string, role: string, disabled_at: string | null }>} */
  const seasonMembers = new Map([
    [
      `${DEFAULT_ADMIN_SEASON_ID}:u-owner`,
      { season_id: DEFAULT_ADMIN_SEASON_ID, admin_user_id: 'u-owner', role: 'owner', disabled_at: null },
    ],
    [
      `${DEFAULT_ADMIN_SEASON_ID}:u-staff`,
      { season_id: DEFAULT_ADMIN_SEASON_ID, admin_user_id: 'u-staff', role: 'admin', disabled_at: null },
    ],
    [
      `${DEFAULT_ADMIN_SEASON_ID}:u-super`,
      {
        season_id: DEFAULT_ADMIN_SEASON_ID,
        admin_user_id: 'u-super',
        role: 'super_admin',
        disabled_at: null,
      },
    ],
    [
      `${DEFAULT_ADMIN_SEASON_ID}:u-disabled`,
      {
        season_id: DEFAULT_ADMIN_SEASON_ID,
        admin_user_id: 'u-disabled',
        role: 'admin',
        disabled_at: null,
      },
    ],
  ])

  const db = {
    users,
    seasonMembers,
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM platform_admins')) return null
              if (normalized.includes('COUNT(*)') && normalized.includes('season_members')) {
                const seasonId = String(params[0])
                let exclude = ''
                if (params.length > 1) exclude = String(params[1])
                let n = 0
                for (const m of seasonMembers.values()) {
                  if (m.season_id !== seasonId || m.role !== 'owner' || m.disabled_at) continue
                  if (exclude && m.admin_user_id === exclude) continue
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
                  if (String(u.email).toLowerCase() === String(params[0]).toLowerCase()) return { ...u }
                }
                return null
              }
              if (normalized.includes('FROM admin_users WHERE id =')) {
                const u = users.get(String(params[0]))
                return u ? { ...u } : null
              }
              if (normalized.includes('FROM season_members') && normalized.includes('admin_user_id = ?')) {
                const seasonId = String(params[0])
                const userId = String(params[1])
                const m = seasonMembers.get(`${seasonId}:${userId}`)
                if (!m) return null
                return { role: m.role, disabled_at: m.disabled_at }
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
              if (normalized.includes('LIST_SEASON') || normalized.includes('FROM season_members sm')) {
                if (normalized.includes('INNER JOIN business_seasons')) {
                  const seasonId = String(params[0])
                  const rows = []
                  for (const m of seasonMembers.values()) {
                    if (m.season_id !== seasonId || m.disabled_at) continue
                    const u = users.get(m.admin_user_id)
                    if (!u || u.disabled_at) continue
                    rows.push({
                      id: u.id,
                      email: u.email,
                      display_name: u.display_name,
                      role: m.role,
                    })
                  }
                  return { results: rows }
                }
                const seasonId = String(params[0])
                const rows = []
                for (const m of seasonMembers.values()) {
                  if (m.season_id !== seasonId) continue
                  const u = users.get(m.admin_user_id)
                  if (!u) continue
                  rows.push({
                    id: u.id,
                    email: u.email,
                    display_name: u.display_name,
                    user_disabled_at: u.disabled_at,
                    role: m.role,
                    membership_disabled_at: m.disabled_at,
                    membership_created_at: '2026-01-01',
                    created_at: u.created_at,
                    updated_at: u.updated_at,
                  })
                }
                return { results: rows }
              }
              return { results: [] }
            },
            async run() {
              if (normalized.startsWith('INSERT INTO season_members')) {
                const seasonId = String(params[0])
                const userId = String(params[1])
                seasonMembers.set(`${seasonId}:${userId}`, {
                  season_id: seasonId,
                  admin_user_id: userId,
                  role: String(params[2]),
                  disabled_at: params[3] ?? null,
                })
              }
              if (normalized.startsWith('UPDATE season_members SET role')) {
                const role = String(params[0])
                const seasonId = String(params[1])
                const userId = String(params[2])
                const m = seasonMembers.get(`${seasonId}:${userId}`)
                if (m) m.role = role
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
        },
      }
    },
  }
  return db
}
