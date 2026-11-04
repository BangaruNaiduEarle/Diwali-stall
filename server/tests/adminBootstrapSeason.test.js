import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { bootstrapOwnerAccount, isOwnerBootstrapComplete } from '../src/services/adminPasswordAuth.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'

const SECRET = 'bootstrap-secret-minimum-32-characters-long!!'
const OTHER_SEASON_ID = 'season-2099'

describe('bootstrapOwnerAccount season membership', () => {
  it('creates owner membership in the initial season for a new user', async () => {
    const db = createBootstrapSeasonDb()
    const result = await bootstrapOwnerAccount(db, { ADMIN_BOOTSTRAP_SECRET: SECRET }, {
      email: 'new-owner@test.com',
      password: 'stall-password-12',
      bootstrapSecret: SECRET,
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    const member = db.seasonMembers.get(`${DEFAULT_ADMIN_SEASON_ID}:${result.userId}`)
    assert.ok(member)
    assert.equal(member.role, 'owner')
  })

  it('adds initial-season owner membership without changing other seasons', async () => {
    const db = createBootstrapSeasonDb({
      existingUser: {
        id: 'u-existing',
        email: 'legacy@test.com',
        display_name: 'Legacy',
        role: 'admin',
        password_hash: 'old',
      },
      seasonMembers: {
        [`${OTHER_SEASON_ID}:u-existing`]: { role: 'admin' },
      },
    })
    const result = await bootstrapOwnerAccount(db, { ADMIN_BOOTSTRAP_SECRET: SECRET }, {
      email: 'legacy@test.com',
      password: 'stall-password-12',
      bootstrapSecret: SECRET,
    })
    assert.equal(result.ok, true)
    assert.equal(db.seasonMembers.get(`${OTHER_SEASON_ID}:u-existing`)?.role, 'admin')
    assert.equal(db.seasonMembers.get(`${DEFAULT_ADMIN_SEASON_ID}:u-existing`)?.role, 'owner')
    assert.equal(db.users.get('u-existing')?.role, 'owner')
  })

  it('does not insert duplicate membership when initial season row already exists', async () => {
    const db = createBootstrapSeasonDb({
      existingUser: {
        id: 'u-existing',
        email: 'legacy@test.com',
        display_name: 'Legacy',
        role: 'admin',
        password_hash: 'old',
      },
      seasonMembers: {
        [`${DEFAULT_ADMIN_SEASON_ID}:u-existing`]: { role: 'admin' },
      },
    })
    const result = await bootstrapOwnerAccount(db, { ADMIN_BOOTSTRAP_SECRET: SECRET }, {
      email: 'legacy@test.com',
      password: 'stall-password-12',
      bootstrapSecret: SECRET,
    })
    assert.equal(result.ok, true)
    assert.equal(db.seasonMembers.size, 1)
    assert.equal(db.seasonMembers.get(`${DEFAULT_ADMIN_SEASON_ID}:u-existing`)?.role, 'admin')
  })

  it('rejects repeated bootstrap after lock is taken', async () => {
    const db = createBootstrapSeasonDb({ bootstrapComplete: true })
    const result = await bootstrapOwnerAccount(db, { ADMIN_BOOTSTRAP_SECRET: SECRET }, {
      email: 'other@test.com',
      password: 'stall-password-12',
      bootstrapSecret: SECRET,
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'bootstrap_complete')
    assert.equal(await isOwnerBootstrapComplete(db), true)
  })
})

/** @param {{ existingUser?: Record<string, unknown>, seasonMembers?: Record<string, { role: string }>, bootstrapComplete?: boolean, initialSeasonAvailable?: boolean }} [config] */
function createBootstrapSeasonDb(config = {}) {
  /** @type {Map<string, Record<string, unknown>>} */
  const users = new Map()
  /** @type {Map<string, { season_id: string, admin_user_id: string, role: string }>} */
  const seasonMembers = new Map()
  let bootstrapComplete = Boolean(config.bootstrapComplete)
  const initialSeasonAvailable = config.initialSeasonAvailable !== false

  if (config.existingUser) {
    users.set(String(config.existingUser.id), { ...config.existingUser })
  }
  for (const [key, value] of Object.entries(config.seasonMembers ?? {})) {
    const [seasonId, userId] = key.split(':')
    seasonMembers.set(key, { season_id: seasonId, admin_user_id: userId, role: value.role })
  }

  /** @param {string} normalized @param {unknown[]} params */
  function stmt(normalized, params) {
    return {
      async first() {
              if (normalized.includes('FROM admin_owner_bootstrap')) {
                return bootstrapComplete ? { singleton_id: 1 } : null
              }
              if (normalized.includes('FROM business_seasons WHERE id =')) {
                return initialSeasonAvailable ? { id: DEFAULT_ADMIN_SEASON_ID } : null
              }
              if (normalized.includes('FROM season_members WHERE season_id =')) {
                const seasonId = String(params[0])
                const userId = String(params[1])
                return seasonMembers.has(`${seasonId}:${userId}`) ? { ok: 1 } : null
              }
              if (normalized.includes('FROM admin_users WHERE lower(email)')) {
                const email = String(params[0]).toLowerCase()
                for (const u of users.values()) {
                  if (String(u.email).toLowerCase() === email) return { ...u }
                }
                return null
              }
        return null
      },
      async run() {
              if (normalized.startsWith('INSERT INTO admin_owner_bootstrap')) {
                if (bootstrapComplete) {
                  throw new Error('UNIQUE constraint failed: admin_owner_bootstrap.singleton_id')
                }
                bootstrapComplete = true
              }
              if (normalized.startsWith('INSERT INTO admin_users')) {
                users.set(String(params[0]), {
                  id: params[0],
                  email: params[1],
                  display_name: params[2],
                  role: 'owner',
                  password_hash: params[4] ?? params[3],
                })
              }
              if (normalized.startsWith('UPDATE admin_users')) {
                const id = String(params[2])
                users.set(id, {
                  ...(users.get(id) ?? { id, email: '' }),
                  role: 'owner',
                  password_hash: params[0],
                  display_name: params[1],
                })
              }
              if (normalized.startsWith('INSERT INTO season_members')) {
                const seasonId = String(params[0])
                const userId = String(params[1])
                seasonMembers.set(`${seasonId}:${userId}`, {
                  season_id: seasonId,
                  admin_user_id: userId,
                  role: params[2] != null ? String(params[2]) : 'owner',
                })
              }
        return { meta: { changes: 1 } }
      },
    }
  }

  return {
    users,
    seasonMembers,
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      const base = stmt(normalized, [])
      return {
        bind(...params) {
          return stmt(normalized, params)
        },
        first: () => base.first(),
        run: () => base.run(),
      }
    },
    async batch(statements) {
      const usersBefore = new Map(users)
      const membersBefore = new Map(seasonMembers)
      const lockBefore = bootstrapComplete
      try {
        for (const statement of statements) {
          await statement.run()
        }
      } catch (err) {
        users.clear()
        for (const [k, v] of usersBefore) users.set(k, v)
        seasonMembers.clear()
        for (const [k, v] of membersBefore) seasonMembers.set(k, v)
        bootstrapComplete = lockBefore
        throw err
      }
    },
  }
}
