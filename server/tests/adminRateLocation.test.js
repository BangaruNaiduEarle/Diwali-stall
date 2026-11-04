import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getCurrentPrivateRate, listPrivateRates, upsertCurrentPrivateRate } from '../src/services/adminPrivateRates.js'
import { getCurrentPurchaseRate, listPurchaseRates, upsertCurrentPurchaseRate } from '../src/services/adminPurchaseRates.js'
import { attachAdminRequestContext, getAdminContext } from '../src/middleware/requireAdmin.js'
import { ADMIN_LOCATION_CONTEXT_SQL } from '../src/services/adminLocationContext.js'
import { handleAdminCatalogueRoutes } from '../src/routes/adminCatalogue.js'
import { formatEffectiveFromUtc } from '../src/lib/x4PrivateRatesImport.js'

const oldSeason = 'season-2026', newSeason = 'season-2027'
const rateKinds = [
  { table: 'private_rates', get: getCurrentPrivateRate, list: listPrivateRates, upsert: upsertCurrentPrivateRate, path: 'private-rate', notes: 'admin_rate_update' },
  { table: 'product_purchase_rates', get: getCurrentPurchaseRate, list: listPurchaseRates, upsert: upsertCurrentPurchaseRate, path: 'purchase-rate', notes: 'admin_purchase_rate_update' },
]

// Mocked D1 only. Constraints/NULL derivation below model the already reviewed
// schema contract; these tests do not execute or verify SQLite/D1 trigger SQL.
function fixture() {
  const rows = () => [
    { id: 1, product_id: 'P001', location_id: 'loc-a', season_id: 'season-2025', unit_rate_paise: 900, effective_from: '2019-01-01 00:00:00', effective_to: '2020-01-01 00:00:00', notes: 'history' },
    { id: 2, product_id: 'P001', location_id: 'loc-a', season_id: oldSeason, unit_rate_paise: 1000, effective_from: '2020-01-01 00:00:00', effective_to: null, notes: 'current' },
    { id: 3, product_id: 'P002', location_id: 'loc-b', season_id: newSeason, unit_rate_paise: 2000, effective_from: '2020-01-01 00:00:00', effective_to: null },
  ]
  const state = {
    products: [
      { id: 'P001', location_id: 'loc-a', season_id: oldSeason, category_slug: 'cat-a', category_label: 'A', name: 'A product', images_json: '[]', active: 1, selling_price_paise: 1000 },
      { id: 'P002', location_id: 'loc-b', season_id: newSeason, category_slug: 'cat-b', category_label: 'B', name: 'B product', images_json: '[]', active: 1 },
    ],
    private_rates: rows(), product_purchase_rates: rows(), sequence: { private_rates: 3, product_purchase_rates: 3 },
  }
  const db = {
    state, calls: [], batches: 0, beforeBatch: null, failUnique: null, now: formatEffectiveFromUtc(),
    prepare(raw) {
      const sql = raw.replace(/\s+/g, ' ').trim()
      return { bind(...v) {
        assert.equal((sql.match(/\?/g) ?? []).length, v.length, sql)
        const execute = mode => {
          db.calls.push({ sql, v: [...v], mode })
          const result = mode === 'run' ? mutate(sql, v) : select(raw, sql, v)
          return mode === 'first' ? result[0] ?? null : mode === 'all' ? { results: result } : result
        }
        return { async first() { return execute('first') }, async all() { return execute('all') }, async run() { return execute('run') } }
      } }
    },
    async batch(statements) {
      db.batches++
      db.beforeBatch?.(state)
      const before = structuredClone(state)
      try { const results = []; for (const statement of statements) results.push(await statement.run()); return results }
      catch (error) { for (const key of Object.keys(state)) state[key] = before[key]; throw error }
    },
  }
  function select(raw, sql, v) {
    if (raw === ADMIN_LOCATION_CONTEXT_SQL) return ['loc-a', 'loc-b'].map(loc => ({
      season_user_id: 'u-1', member_season_id: v[1], season_role: 'owner', season_disabled_at: null,
      season_id: v[1], season_code: v[1], season_label: v[1], season_status: 'active',
      location_user_id: 'u-1', member_location_id: loc, location_member_season_id: v[1], location_role: 'owner', location_disabled_at: null,
      location_id: loc, location_business_id: 'shop', location_slug: loc, location_name: loc, location_status: 'active',
      business_id: 'shop', business_slug: 'shop', business_name: 'Permanent shop', business_type: 'permanent', business_status: 'active',
      association_location_id: loc, association_season_id: v[1], operating_year: Number(v[1].slice(-4)), association_status: 'active',
    }))
    if (sql.includes('FROM platform_admins')) return []
    if (sql.includes('FROM season_members')) return [oldSeason, newSeason].map(season_id => ({ season_id, role: 'owner', status: 'active', disabled_at: null, created_at: '', code: season_id, label: season_id }))
    if (sql.includes('FROM products p') && sql.includes('WHERE p.id = ?')) return state.products.filter(p => p.id === v[0] && p[sql.includes('p.location_id = ?') ? 'location_id' : 'season_id'] === v[1]).map(p => ({ ...p }))
    if (sql.includes('FROM products WHERE id = ?')) return state.products.filter(p => p.id === v[0] && p[sql.includes('location_id = ?') ? 'location_id' : 'season_id'] === v[1]).map(p => ({ ...p }))
    const match = sql.match(/FROM (private_rates|product_purchase_rates)\b/)
    if (match) {
      const table = match[1]
      if (sql.includes('AS mismatch')) {
        const owned = state.products.some(p => p.id === v[0] && p.location_id === v[2])
        return owned && state[table].some(r => r.product_id === v[0] && r.location_id !== v[1]) ? [{ mismatch: 1 }] : []
      }
      const location = sql.includes('INNER JOIN products p')
      let result = state[table].filter(r => r.product_id === v[0] && r[location ? 'location_id' : 'season_id'] === v[1])
      if (location) {
        assert.ok(sql.includes('p.location_id = r.location_id'))
        assert.ok(sql.includes('p.location_id = ?'))
        assert.ok(!sql.includes('season_id = ?'))
        result = result.filter(r => state.products.some(p => p.id === r.product_id && p.location_id === r.location_id && p.location_id === v[2]))
      }
      if (sql.includes('effective_to IS NULL')) result = result.filter(r => r.effective_to == null)
      if (sql.includes('ORDER BY')) result = result.toSorted((a, b) => b.effective_from.localeCompare(a.effective_from) || b.id - a.id)
      return result.map(r => ({ ...r }))
    }
    throw Error('Unexpected SELECT: ' + sql)
  }
  function mutate(sql, v) {
    const table = sql.match(/(?:UPDATE|INTO) (private_rates|product_purchase_rates)\b/)?.[1]
    assert.ok(table, sql)
    if (sql.startsWith('UPDATE')) {
      const location = sql.includes('location_id = ?')
      if (location) assert.ok(sql.includes('EXISTS (SELECT 1 FROM products p WHERE p.id = ' + table + '.product_id AND p.location_id = ?)'))
      const targets = state[table].filter(r => r.product_id === v[0] && r.effective_to == null && r[location ? 'location_id' : 'season_id'] === v[1] && (!location || state.products.some(p => p.id === r.product_id && p.location_id === v[2])))
      for (const rate of targets) {
        if (db.now <= rate.effective_from) throw Error('CHECK constraint failed: effective_to IS NULL OR effective_to > effective_from')
        rate.effective_to = db.now; rate.updated_at = db.now
      }
      return { meta: { changes: targets.length } }
    }
    const location = sql.includes('(SELECT id FROM products')
    const product = state.products.find(p => p.id === v[0] && (!location || p.location_id === v[1]))
    if (!product) throw Error('NOT NULL constraint failed: ' + table + '.product_id')
    const row = location
      ? { product_id: product.id, unit_rate_paise: v[2], effective_from: v[3], notes: v[4], season_id: state.products.find(p => p.id === v[5] && p.location_id === v[6])?.season_id ?? null, location_id: v[7], effective_to: null }
      : { product_id: product.id, unit_rate_paise: v[1], effective_from: v[2], notes: v[3], season_id: v[4], location_id: product.location_id, effective_to: null }
    if (row.location_id !== product.location_id) throw Error('rate location must match product location')
    if (db.failUnique === table || state[table].some(r => r.product_id === row.product_id && r.effective_to == null)) {
      db.failUnique = null
      throw Error('UNIQUE constraint failed: ' + table + '.product_id')
    }
    row.id = ++state.sequence[table]
    state[table].push(row)
    return { meta: { changes: 1 } }
  }
  return db
}

async function attach(db, { season = newSeason, mode = true, path = 'private-rate', method = 'GET', product = 'P001', payload } = {}) {
  const req = new Request(`https://example.test/api/admin/products/${product}/${path}`, {
    method, headers: { 'X-Admin-Season-Id': season, 'X-Admin-Location-Id': 'loc-a', 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  })
  assert.equal((await attachAdminRequestContext(req, db, { userId: 'u-1', email: 'owner@test.com' }, { ADMIN_LOCATION_MODE: mode })).ok, true)
  return { context: getAdminContext(req), req }
}

for (const kind of rateKinds) describe(kind.table + ' location awareness (mocked D1 only)', () => {
  const { table, get, list, upsert } = kind
  it('preserves legacy lookup, supersession, INSERT shape and NULL-derivation compatibility', async () => {
    const db = fixture(), { context } = await attach(db, { season: oldSeason, mode: false })
    db.calls.length = 0
    assert.equal((await get(db, 'P001', oldSeason, context)).unitRatePaise, 1000)
    const result = await upsert(db, 'P001', 1500, oldSeason, undefined, context)
    assert.equal(result.ok, true)
    assert.equal(result.rate.unitRatePaise, 1500)
    assert.ok(db.calls.every(call => !call.sql.includes('location_id')))
    const inserted = db.state[table].at(-1)
    assert.equal(inserted.location_id, 'loc-a') // mock models unchanged 0020 AFTER INSERT derivation
    assert.equal(inserted.notes, kind.notes)
    const statement = db.calls.find(call => call.sql.startsWith('INSERT INTO ' + table))
    assert.match(statement.sql, /\(product_id, unit_rate_paise, effective_from, notes, season_id\) VALUES \(\?, \?, \?, \?, \?\)/)
    assert.equal(await get(db, 'P001', newSeason, context), null)
  })

  it('shares current/history rates across two authorized operating seasons', async () => {
    const db = fixture()
    for (const season of [oldSeason, newSeason]) {
      const { context } = await attach(db, { season })
      assert.equal((await get(db, 'P001', season, context)).unitRatePaise, 1000)
      assert.deepEqual((await list(db, 'P001', season, context)).map(r => r.id), [2, 1])
    }
    const { context } = await attach(db)
    const other = structuredClone(db.state[table === 'private_rates' ? 'product_purchase_rates' : 'private_rates'])
    assert.equal((await upsert(db, 'P001', 1500, newSeason, 'location update', context)).ok, true)
    assert.equal(db.state[table].at(-1).season_id, oldSeason)
    assert.equal(db.state[table].at(-1).location_id, 'loc-a')
    assert.equal(db.state[table].at(-1).notes, 'location update')
    assert.equal(db.state[table].filter(r => r.product_id === 'P001' && r.effective_to == null).length, 1)
    assert.deepEqual(db.state[table === 'private_rates' ? 'product_purchase_rates' : 'private_rates'], other)
    const earlier = await attach(db, { season: oldSeason })
    const noOp = await upsert(db, 'P001', 1500, oldSeason, undefined, earlier.context)
    assert.equal(noOp.unchanged, true)
  })

  it('rejects foreign products for lookup, history and writes without mutation', async () => {
    const db = fixture(), { context } = await attach(db), before = structuredClone(db.state)
    assert.equal(await get(db, 'P002', newSeason, context), null)
    assert.deepEqual(await list(db, 'P002', newSeason, context), [])
    assert.equal((await upsert(db, 'P002', 1500, newSeason, undefined, context)).status, 404)
    assert.deepEqual(db.state, before)
  })

  for (const index of [0, 1]) for (const location of [null, 'loc-b']) {
    it(`rejects mismatched ${index === 0 ? 'historical' : 'current'} rate ownership ${location}`, async () => {
      const db = fixture(), { context } = await attach(db)
      db.state[table][index].location_id = location
      const before = structuredClone(db.state)
      await assert.rejects(get(db, 'P001', newSeason, context), e => e.status === 409 && e.code === 'rate_ownership_mismatch')
      await assert.rejects(list(db, 'P001', newSeason, context), e => e.status === 409 && e.code === 'rate_ownership_mismatch')
      assert.equal((await upsert(db, 'P001', 1500, newSeason, undefined, context)).code, 'rate_ownership_mismatch')
      assert.equal(db.batches, 0)
      assert.deepEqual(db.state, before)
    })
  }

  it('keeps unchanged values as a no-op, including dates and history', async () => {
    const db = fixture(), { context } = await attach(db), before = structuredClone(db.state)
    const result = await upsert(db, 'P001', 1000, newSeason, undefined, context)
    assert.equal(result.unchanged, true)
    assert.equal(db.batches, 0)
    assert.deepEqual(db.state, before)
  })

  it('keeps UTC second precision and existing effective-date/supersession behavior', async () => {
    const db = fixture(), { context } = await attach(db), before = formatEffectiveFromUtc()
    const result = await upsert(db, 'P001', 1600, newSeason, undefined, context)
    const after = formatEffectiveFromUtc()
    assert.equal(result.ok, true)
    assert.match(result.rate.effectiveFrom, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    assert.ok(result.rate.effectiveFrom >= before && result.rate.effectiveFrom <= after)
    assert.equal(db.state[table][1].effective_to, db.now)
    assert.equal(db.state[table][0].effective_to, '2020-01-01 00:00:00')
    assert.ok(db.calls.find(call => call.sql.startsWith('UPDATE ' + table)).sql.includes("effective_to = datetime('now')"))
  })

  it('retains the existing CHECK failure when supersession would not advance effective time', async () => {
    const db = fixture(), { context } = await attach(db)
    db.now = db.state[table][1].effective_from
    const before = structuredClone(db.state)
    await assert.rejects(upsert(db, 'P001', 1600, newSeason, undefined, context), /CHECK constraint failed/)
    assert.deepEqual(db.state, before)
  })

  it('preserves unknown catalogue provenance as NULL instead of substituting operating season', async () => {
    const db = fixture(), { context } = await attach(db)
    db.state.products[0].season_id = null
    assert.equal((await upsert(db, 'P001', 1600, newSeason, undefined, context)).ok, true)
    assert.equal(db.state[table].at(-1).season_id, null)
  })

  it('rolls back supersession on per-product uniqueness failure across seasons', async () => {
    const db = fixture(), { context } = await attach(db), before = structuredClone(db.state)
    db.failUnique = table
    const result = await upsert(db, 'P001', 1600, newSeason, undefined, context)
    assert.equal(result.status, 409)
    assert.equal(result.code, 'rate_conflict')
    assert.deepEqual(db.state, before)
  })

  it('does not supersede or insert for a product whose location changed before the batch', async () => {
    const db = fixture(), { context } = await attach(db)
    let expected
    db.beforeBatch = state => { state.products[0].location_id = 'loc-b'; expected = structuredClone(state) }
    assert.equal((await upsert(db, 'P001', 1600, newSeason, undefined, context)).status, 404)
    assert.deepEqual(db.state, expected)
  })

  it('fails closed for missing enabled context and archived writes', async () => {
    const db = fixture(), { context } = await attach(db)
    await assert.rejects(get(db, 'P001', newSeason, { locationModeEnabled: true }), e => e.status === 403)
    context.locationContext.association.status = 'archived'
    await assert.rejects(upsert(db, 'P001', 1600, newSeason, undefined, context), e => e.status === 403)
  })

  it('passes location context through GET/PUT routes and reports ownership conflicts safely', async () => {
    const db = fixture()
    const call = async options => { const { req } = await attach(db, { path: kind.path, ...options }); return handleAdminCatalogueRoutes(req, { DB: db }, new URL(req.url)) }
    assert.equal((await (await call({})).json()).rate.unitRatePaise, 1000)
    const response = await call({ method: 'PUT', payload: { unitRateInr: 16 } })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).rate.unitRatePaise, 1600)
    assert.equal(db.state[table].at(-1).season_id, oldSeason)
    assert.equal((await call({ product: 'P002' })).status, 404)
    db.state[table][0].location_id = 'loc-b'
    for (const options of [{}, { method: 'PATCH', payload: { unitRateInr: 20 } }]) {
      const denied = await call(options)
      assert.equal(denied.status, 409)
      assert.equal((await denied.json()).error, 'rate_ownership_mismatch')
      assert.equal(denied.headers.get('Cache-Control'), 'no-store')
    }
  })
})
