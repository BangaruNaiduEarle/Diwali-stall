import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  bootstrapOwnerAccount,
  isOwnerBootstrapComplete,
  mapBootstrapBatchError,
} from '../src/services/adminPasswordAuth.js'
import { createAdminUser } from '../src/services/adminUsersManagement.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'

describe('single owner policy', () => {
  it('createAdminUser rejects role owner', async () => {
    const result = await createAdminUser(createCountDb(0), {
      email: 'extra-owner@test.com',
      password: 'twelvecharspw',
      role: 'owner',
    })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 403)
      assert.equal(result.code, 'forbidden')
    }
  })

  it('createAdminUser defaults to admin role', async () => {
    const db = createInsertDb(0)
    const result = await createAdminUser(db, {
      email: 'staff@test.com',
      password: 'twelvecharspw',
    })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.user.role, 'admin')
    }
  })

  it('createAdminUser can create super_admin role', async () => {
    const db = createInsertDb(0)
    const result = await createAdminUser(db, {
      email: 'super@test.com',
      password: 'twelvecharspw',
      role: 'super_admin',
    })
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.user.role, 'super_admin')
  })
})

describe('atomic owner bootstrap', () => {
  it('mapBootstrapBatchError maps constraint failures to 409', () => {
    const out = mapBootstrapBatchError(new Error('UNIQUE constraint failed: admin_owner_bootstrap.singleton_id'))
    assert.equal(out.ok, false)
    if (!out.ok) {
      assert.equal(out.status, 409)
      assert.equal(out.code, 'bootstrap_complete')
    }
  })

  it('batch rolls back user insert when bootstrap lock already exists', async () => {
    const db = createBootstrapDb({ lockTaken: true })
    const result = await bootstrapOwnerAccount(db, { ADMIN_BOOTSTRAP_SECRET: 'x'.repeat(32) }, {
      email: 'race@test.com',
      password: 'stall-password-12',
      bootstrapSecret: 'x'.repeat(32),
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 409)
    assert.equal(db.__users.size, 0)
    assert.equal(await isOwnerBootstrapComplete(db), true)
  })

  it('successful bootstrap sets singleton lock before owner row', async () => {
    const db = createBootstrapDb({ lockTaken: false })
    const result = await bootstrapOwnerAccount(db, { ADMIN_BOOTSTRAP_SECRET: 'y'.repeat(32) }, {
      email: 'owner@test.com',
      password: 'stall-password-12',
      bootstrapSecret: 'y'.repeat(32),
    })
    assert.equal(result.ok, true)
    assert.equal(db.__users.size, 1)
    assert.equal(await isOwnerBootstrapComplete(db), true)
    const only = [...db.__users.values()][0]
    assert.equal(only.role, 'owner')
    assert.equal(db.__seasonMembers.get(`${DEFAULT_ADMIN_SEASON_ID}:${only.id}`)?.role, 'owner')
  })

  it('fails when initial business season is missing without creating owner', async () => {
    const db = createBootstrapDb({ lockTaken: false, initialSeasonAvailable: false })
    const result = await bootstrapOwnerAccount(db, { ADMIN_BOOTSTRAP_SECRET: 'z'.repeat(32) }, {
      email: 'owner@test.com',
      password: 'stall-password-12',
      bootstrapSecret: 'z'.repeat(32),
    })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 503)
      assert.equal(result.code, 'bootstrap_unavailable')
    }
    assert.equal(db.__users.size, 0)
    assert.equal(await isOwnerBootstrapComplete(db), false)
  })
})

/** @param {number} activeCount */
function createCountDb(activeCount) {
  return createInsertDb(activeCount)
}

/** @param {number} activeCount */
function createInsertDb(activeCount) {
  /** @type {Map<string, { role: string }>} */
  const inserted = new Map()
  return {
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      const isCount = normalized.includes('COUNT(*)') && normalized.includes('disabled_at IS NULL')
      const isEmail = normalized.includes('FROM admin_users WHERE lower(email)')
      const stmt = {
        async first() {
          if (isCount) return { n: activeCount + inserted.size }
          if (isEmail) return null
          return null
        },
        async run() {
          if (normalized.startsWith('INSERT INTO admin_users')) {
            inserted.set('x', { role: 'admin' })
          }
          return { meta: { changes: 1 } }
        },
      }
      return {
        bind(...args) {
          const bound = {
            async first() {
              if (isCount) return { n: activeCount + inserted.size }
              if (isEmail) return null
              return null
            },
            async run() {
              if (normalized.startsWith('INSERT INTO admin_users')) {
                inserted.set(String(args[0]), { role: String(args[3]) })
              }
              return { meta: { changes: 1 } }
            },
          }
          return bound
        },
        first: () => stmt.first(),
        run: () => stmt.run(),
      }
    },
  }
}

/** @param {{ lockTaken: boolean, initialSeasonAvailable?: boolean, existingUser?: Record<string, unknown>, existingSeasonMembers?: Record<string, { role: string }> }} opts */
function createBootstrapDb(opts) {
  /** @type {Map<string, Record<string, unknown>>} */
  const users = new Map()
  /** @type {Map<string, { season_id: string, admin_user_id: string, role: string }>} */
  const seasonMembers = new Map()
  let lockTaken = opts.lockTaken
  let lockOwnerId = lockTaken ? 'existing-owner' : null
  const initialSeasonAvailable = opts.initialSeasonAvailable !== false

  if (opts.existingUser) {
    users.set(String(opts.existingUser.id), { ...opts.existingUser })
  }
  for (const [key, value] of Object.entries(opts.existingSeasonMembers ?? {})) {
    const [seasonId, userId] = key.split(':')
    seasonMembers.set(key, { season_id: seasonId, admin_user_id: userId, role: value.role })
  }

  /** @param {string} normalized @param {unknown[]} args */
  function stmtHandlers(normalized, args) {
    return {
      async first() {
        if (normalized.includes('admin_owner_bootstrap')) {
          return lockTaken ? { singleton_id: 1 } : null
        }
        if (normalized.includes('FROM business_seasons WHERE id =')) {
          return initialSeasonAvailable ? { id: DEFAULT_ADMIN_SEASON_ID } : null
        }
        if (normalized.includes('FROM season_members WHERE season_id =')) {
          const seasonId = String(args[0])
          const userId = String(args[1])
          return seasonMembers.has(`${seasonId}:${userId}`) ? { ok: 1 } : null
        }
        if (normalized.includes('FROM admin_users WHERE lower(email)')) {
          const email = String(args[0]).toLowerCase()
          for (const u of users.values()) {
            if (String(u.email).toLowerCase() === email) return { ...u }
          }
          return null
        }
        return null
      },
      async run() {
        if (normalized.startsWith('INSERT INTO admin_owner_bootstrap')) {
          if (lockTaken) {
            throw new Error('UNIQUE constraint failed: admin_owner_bootstrap.singleton_id')
          }
          lockTaken = true
          lockOwnerId = String(args[0])
        }
        if (normalized.startsWith('INSERT INTO admin_users')) {
          users.set(String(args[0]), {
            id: args[0],
            email: args[1],
            role: 'owner',
            password_hash: args[3],
          })
        }
        if (normalized.startsWith('UPDATE admin_users')) {
          const id = String(args[2])
          const row = users.get(id) ?? { id, email: '', role: 'admin' }
          users.set(id, {
            ...row,
            role: 'owner',
            password_hash: args[0],
            display_name: args[1],
          })
        }
        if (normalized.startsWith('INSERT INTO season_members')) {
          const seasonId = String(args[0])
          const userId = String(args[1])
          seasonMembers.set(`${seasonId}:${userId}`, {
            season_id: seasonId,
            admin_user_id: userId,
            role: args[2] != null ? String(args[2]) : 'owner',
          })
        }
        return { meta: { changes: 1 } }
      },
    }
  }

  const db = {
    __users: users,
    __seasonMembers: seasonMembers,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      const base = stmtHandlers(normalized, [])
      return {
        bind(...args) {
          return stmtHandlers(normalized, args)
        },
        first: () => base.first(),
        run: () => base.run(),
      }
    },
    async batch(statements) {
      for (const statement of statements) {
        await statement.run()
      }
    },
  }
  return db
}
