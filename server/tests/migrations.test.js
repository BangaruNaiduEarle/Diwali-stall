import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyLocalMigrations, d1QueryLocal } from './helpers/d1Local.js'

describe('local D1 migrations', () => {
  it('applies migrations repeatedly without error (idempotent runner)', () => {
    applyLocalMigrations()
    applyLocalMigrations()
    const tables = d1QueryLocal(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    const names = tables.map((r) => r.name)
    for (const expected of [
      'admin_login_attempts',
      'admin_owner_bootstrap',
      'admin_sessions',
      'admin_users',
      'categories',
      'customer_request_items',
      'customer_requests',
      'private_rates',
      'product_purchase_rates',
      'products',
      'quotation_items',
      'quotations',
    ]) {
      assert.ok(names.includes(expected), `missing table ${expected}`)
    }
  })

  it('records migrations in d1_migrations', () => {
    const rows = d1QueryLocal('SELECT name FROM d1_migrations ORDER BY name')
    const applied = rows.map((r) => r.name)
    assert.ok(applied.some((n) => String(n).includes('0001')))
    assert.ok(applied.some((n) => String(n).includes('0002')))
  })
})
