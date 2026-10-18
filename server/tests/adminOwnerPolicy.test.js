import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  bootstrapOwnerAccount,
  isOwnerBootstrapComplete,
  mapBootstrapBatchError,
} from '../src/services/adminPasswordAuth.js'
import { createAdminUser } from '../src/services/adminUsersManagement.js'

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

  it('createAdminUser always creates admin role', async () => {
    const db = createCountDb(0)
    const result = await createAdminUser(db, {
      email: 'staff@test.com',
      password: 'twelvecharspw',
    })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.user.role, 'admin')
    }
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
  })
})

/** @param {number} activeCount */
function createCountDb(activeCount) {
  return {
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      const isCount = normalized.includes('COUNT(*)') && normalized.includes('disabled_at IS NULL')
      const isEmail = normalized.includes('FROM admin_users WHERE lower(email)')
      const stmt = {
        async first() {
          if (isCount) return { n: activeCount }
          if (isEmail) return null
          return null
        },
        async run() {
          return { meta: { changes: 1 } }
        },
      }
      return {
        bind() {
          return stmt
        },
        first: () => stmt.first(),
        run: () => stmt.run(),
      }
    },
  }
}

/** @param {{ lockTaken: boolean }} opts */
function createBootstrapDb(opts) {
  /** @type {Map<string, Record<string, unknown>>} */
  const users = new Map()
  let lockTaken = opts.lockTaken
  let lockOwnerId = lockTaken ? 'existing-owner' : null

  /** @param {string} normalized @param {unknown[]} args */
  function stmtHandlers(normalized, args) {
    return {
      async first() {
        if (normalized.includes('admin_owner_bootstrap')) {
          return lockTaken ? { singleton_id: 1 } : null
        }
        if (normalized.includes('FROM admin_users WHERE lower(email)')) {
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
        return { meta: { changes: 1 } }
      },
    }
  }

  const db = {
    __users: users,
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
