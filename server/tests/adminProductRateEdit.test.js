import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { upsertCurrentPrivateRate } from '../src/services/adminPrivateRates.js'
import { upsertCurrentPurchaseRate } from '../src/services/adminPurchaseRates.js'
import { inrToPaise } from '../src/services/money.js'

describe('admin product rate edits (independent)', () => {
  it('purchase upsert does not mutate X4 private_rates state', async () => {
    const db = createRateEditMockDb()
    db.state.rates.set('P001', 169400)
    await upsertCurrentPurchaseRate(db, 'P001', inrToPaise(500))
    assert.equal(db.state.rates.get('P001'), 169400)
    assert.equal(db.state.purchaseRates.get('P001'), 50000)
  })

  it('X4 upsert does not mutate purchase_rates state', async () => {
    const db = createRateEditMockDb()
    db.state.purchaseRates.set('P001', 42350)
    await upsertCurrentPrivateRate(db, 'P001', 170000)
    assert.equal(db.state.purchaseRates.get('P001'), 42350)
    assert.equal(db.state.rates.get('P001'), 170000)
  })

  it('unchanged X4 upsert is a no-op (preserves current row)', async () => {
    const db = createRateEditMockDb()
    db.state.rates.set('P001', 169400)
    db.state.privateInsertCount = 0
    const first = await upsertCurrentPrivateRate(db, 'P001', 169400)
    assert.equal(first.ok, true)
    if (!first.ok) return
    assert.equal(first.unchanged, true)
    assert.equal(db.state.privateInsertCount, 0)
    await upsertCurrentPrivateRate(db, 'P001', 170000)
    assert.equal(db.state.privateInsertCount, 1)
  })

  it('unchanged purchase upsert is a no-op', async () => {
    const db = createRateEditMockDb()
    db.state.purchaseRates.set('P001', 42350)
    db.state.purchaseInsertCount = 0
    const first = await upsertCurrentPurchaseRate(db, 'P001', 42350)
    assert.equal(first.ok, true)
    if (!first.ok) return
    assert.equal(first.unchanged, true)
    assert.equal(db.state.purchaseInsertCount, 0)
  })
})

function createRateEditMockDb() {
  const state = {
    products: new Map([['P001', { id: 'P001' }]]),
    rates: new Map(),
    purchaseRates: new Map(),
    privateInsertCount: 0,
    purchaseInsertCount: 0,
  }

  const db = {
    state,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      const makeStmt = (params) => ({
        bind(...next) {
          return makeStmt(next.length ? next : params)
        },
        async first() {
          if (normalized.includes('FROM products WHERE id = ?')) {
            return state.products.get(String(params[0])) ?? null
          }
          if (normalized.includes('FROM private_rates') && normalized.includes('effective_to IS NULL')) {
            const paise = state.rates.get(String(params[0]))
            return paise == null
              ? null
              : { id: 1, product_id: params[0], unit_rate_paise: paise, effective_to: null, notes: null }
          }
          if (normalized.includes('FROM product_purchase_rates') && normalized.includes('effective_to IS NULL')) {
            const paise = state.purchaseRates.get(String(params[0]))
            return paise == null
              ? null
              : { id: 1, product_id: params[0], unit_rate_paise: paise, effective_to: null, notes: null }
          }
          return null
        },
        async run() {
          if (normalized.includes('UPDATE private_rates') && normalized.includes('effective_to')) {
            return { meta: { changes: 1 } }
          }
          if (normalized.startsWith('INSERT INTO private_rates')) {
            state.privateInsertCount += 1
            state.rates.set(params[0], params[1])
            return { meta: { changes: 1 } }
          }
          if (normalized.includes('UPDATE product_purchase_rates') && normalized.includes('effective_to')) {
            return { meta: { changes: 1 } }
          }
          if (normalized.startsWith('INSERT INTO product_purchase_rates')) {
            state.purchaseInsertCount += 1
            state.purchaseRates.set(params[0], params[1])
            return { meta: { changes: 1 } }
          }
          return { meta: { changes: 1 } }
        },
      })
      return makeStmt([])
    },
    async batch(stmts) {
      for (const s of stmts) await s.run()
    },
  }
  return db
}
