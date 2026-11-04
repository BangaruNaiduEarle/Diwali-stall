import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  listAdminFamilyPacks, getAdminFamilyPackById, createAdminFamilyPack, updateAdminFamilyPack,
  deleteAdminFamilyPack, countFamilyPackCustomerRequestReferences,
  setAdminFamilyPackActive, setAdminFamilyPackArchived,
} from '../src/services/adminFamilyPacks.js'
import { attachAdminRequestContext, getAdminContext } from '../src/middleware/requireAdmin.js'
import { ADMIN_LOCATION_CONTEXT_SQL } from '../src/services/adminLocationContext.js'
import { handleAdminFamilyPackRoutes } from '../src/routes/adminFamilyPacks.js'

const oldSeason = 'season-2026', newSeason = 'season-2027'
const body = (extra = {}) => ({
  name: 'New pack', slug: 'new-pack', sellingPriceInr: 100, active: true,
  items: [{ productId: 'P001', quantity: 2 }],
  images: [{ url: 'https://images.test/new.jpg', isCover: true }], ...extra,
})

// In-memory mock only. It applies the actual query's ownership predicates and
// models batch rollback without opening SQLite, Workerd or any database file.
function fixture() {
  const pack = (id, slug, location_id, season_id) => ({ id, slug, location_id, season_id, name: slug, short_description: '', selling_price_paise: 10000, active: 1, archived: 0, sort_order: 0, created_at: '', updated_at: '' })
  const state = {
    family_packs: [pack('FP001', 'a-pack', 'loc-a', oldSeason), pack('FP900', 'b-pack', 'loc-b', newSeason), pack('FP050', 'unmapped', null, 'season-2099')],
    products: [{ id: 'P001', name: 'A product', pack: 'Box', location_id: 'loc-a', season_id: oldSeason }, { id: 'P002', name: 'B product', location_id: 'loc-b', season_id: newSeason }],
    family_pack_images: [{ id: 1, family_pack_id: 'FP001', url: 'https://images.test/a.jpg', sort_order: 0, is_cover: 1 }, { id: 2, family_pack_id: 'FP900', url: 'https://images.test/b.jpg', sort_order: 0, is_cover: 1 }],
    family_pack_items: [{ id: 1, family_pack_id: 'FP001', product_id: 'P001', quantity: 1, unit_label: 'Box', sort_order: 0 }, { id: 2, family_pack_id: 'FP900', product_id: 'P002', quantity: 1, sort_order: 0 }],
    customer_requests: [{ id: 'request-old', season_id: oldSeason }],
    customer_request_items: [{ request_id: 'request-old', family_pack_id: 'FP001' }, { request_id: 'request-old', family_pack_id: 'FP900' }],
    sequence: { family_pack_images: 2, family_pack_items: 2 },
  }
  const db = {
    state, calls: [], beforeBatch: null, beforeQuery: null,
    prepare(raw) {
      const sql = raw.replace(/\s+/g, ' ').trim()
      return { bind(...v) {
        assert.equal((sql.match(/\?/g) ?? []).length, v.length, sql)
        const call = mode => {
          db.calls.push({ sql, v: [...v], mode })
          db.beforeQuery?.(sql, state)
          const rows = mode === 'run' ? mutate(sql, v) : select(raw, sql, v)
          return mode === 'first' ? rows[0] ?? null : mode === 'all' ? { results: rows } : rows
        }
        return { async first() { return call('first') }, async all() { return call('all') }, async run() { return call('run') } }
      } }
    },
    async batch(statements) {
      db.beforeBatch?.(state)
      const before = structuredClone(state)
      try { const results = []; for (const statement of statements) results.push(await statement.run()); return results }
      catch (error) { for (const key of Object.keys(state)) state[key] = before[key]; throw error }
    },
  }
  const field = sql => sql.includes('location_id = ?') ? 'location_id' : 'season_id'
  const parent = (id, scope, sql) => state.family_packs.find(p => p.id === id && p[field(sql)] === scope)
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
    if (sql.startsWith('SELECT COUNT(*)')) {
      const scoped = sql.includes('fp.location_id')
      const id = scoped ? v[0] : v[1], scope = scoped ? v[1] : v[2]
      return [{ total: parent(id, scope, sql) ? state.customer_request_items.filter(r => r.family_pack_id === id && (scoped || state.customer_requests.some(q => q.id === r.request_id && q.season_id === v[0]))).length : 0 }]
    }
    if (sql.includes('FROM family_pack_images')) {
      if (!parent(v[1], v[2], sql)) return []
      return state.family_pack_images.filter(r => r.family_pack_id === v[0]).map(r => ({ ...r }))
    }
    if (sql.includes('FROM family_pack_items fpi')) {
      if (!parent(v[2], v[3], sql)) return []
      return state.family_pack_items.filter(r => r.family_pack_id === v[1]).flatMap(r => {
        const product = state.products.find(p => p.id === r.product_id && p[field(sql)] === v[0])
        return product ? [{ ...r, product_name: product.name, product_pack: product.pack }] : []
      })
    }
    if (sql.includes("id GLOB 'FP[0-9]*'")) return state.family_packs.toSorted((a, b) => Number(b.id.slice(2)) - Number(a.id.slice(2))).slice(0, 1)
    if (sql.includes('FROM family_packs fp')) {
      const byId = sql.includes('fp.id = ?')
      let rows = state.family_packs.filter(p => p[field(sql)] === v[byId ? 1 : 0] && (!byId || p.id === v[0]))
      if (sql.includes('fp.active = 1')) rows = rows.filter(p => p.active === 1)
      return rows.toSorted((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)).map(r => ({ ...r }))
    }
    if (sql.includes('FROM family_packs WHERE slug = ?')) return state.family_packs.filter(p => p.slug === v[0] && (!sql.includes('id != ?') || p.id !== v[1])).map(r => ({ ...r }))
    if (sql.includes('FROM family_packs WHERE id = ?')) { const p = parent(v[0], v[1], sql); return p ? [{ ...p }] : [] }
    if (sql.includes('FROM products WHERE id = ?')) return state.products.filter(p => p.id === v[0] && p[field(sql)] === v[1])
    throw Error('Unexpected SELECT: ' + sql)
  }
  function mutate(sql, v) {
    const changes = n => ({ meta: { changes: n } })
    if (sql.startsWith('INSERT INTO family_packs')) {
      const [id, slug, name, short_description, selling_price_paise, pack_label, sort_order, active, season_id, location_id] = v
      if (state.family_packs.some(p => p.slug === slug)) throw Error('UNIQUE constraint failed: family_packs.slug')
      if (state.family_packs.some(p => p.id === id)) throw Error('UNIQUE constraint failed: family_packs.id')
      state.family_packs.push({ id, slug, name, short_description, selling_price_paise, pack_label, sort_order, active, archived: 0, season_id, ...(location_id === undefined ? {} : { location_id }), created_at: '', updated_at: '' })
      return changes(1)
    }
    if (sql.startsWith('UPDATE family_packs')) {
      const p = parent(v.at(-2), v.at(-1), sql)
      if (!p) return changes(0)
      if (sql.includes('slug = ?')) {
        if (state.family_packs.some(other => other.id !== p.id && other.slug === v[0])) throw Error('UNIQUE constraint failed: family_packs.slug')
        ;['slug', 'name', 'short_description', 'selling_price_paise', 'pack_label', 'sort_order', 'active'].forEach((key, i) => { p[key] = v[i] })
      } else if (sql.includes('archived = ?')) { p.archived = v[0]; if (v[1] === 1) p.active = 0 }
      else p.active = v[0]
      return changes(1)
    }
    if (sql.startsWith('DELETE FROM family_packs')) {
      const p = parent(v[0], v[1], sql)
      if (!p) return changes(0)
      state.family_packs = state.family_packs.filter(row => row !== p)
      state.family_pack_images = state.family_pack_images.filter(row => row.family_pack_id !== p.id)
      state.family_pack_items = state.family_pack_items.filter(row => row.family_pack_id !== p.id)
      return changes(1)
    }
    const childDelete = sql.match(/^DELETE FROM (family_pack_images|family_pack_items)/)
    if (childDelete) {
      if (!parent(v[1], v[2], sql)) return changes(0)
      const table = childDelete[1], before = state[table].length
      state[table] = state[table].filter(r => r.family_pack_id !== v[0])
      return changes(before - state[table].length)
    }
    const childInsert = sql.match(/^INSERT INTO (family_pack_images|family_pack_items)/)
    if (childInsert) {
      const table = childInsert[1], guarded = sql.includes('(SELECT id FROM family_packs')
      let n = 1
      if (guarded && !parent(v[0], v[n++], sql)) throw Error('NOT NULL constraint failed: ' + table + '.family_pack_id')
      let row
      if (table === 'family_pack_images') row = { family_pack_id: v[0], sort_order: v[n], url: v[n + 1], is_cover: v[n + 2] }
      else {
        const product_id = v[n++]
        if (guarded && !state.products.some(p => p.id === product_id && p.location_id === v[n++])) throw Error('NOT NULL constraint failed: family_pack_items.product_id')
        row = { family_pack_id: v[0], product_id, quantity: v[n], unit_label: v[n + 1], sort_order: v[n + 2] }
      }
      state[table].push({ id: ++state.sequence[table], ...row })
      return changes(1)
    }
    throw Error('Unexpected mutation: ' + sql)
  }
  return db
}

async function attach(db, { season = newSeason, location = 'loc-a', mode = true, path = '', method = 'GET', payload } = {}) {
  const req = new Request('https://example.test/api/admin/family-packs' + path, {
    method, headers: { 'X-Admin-Season-Id': season, 'X-Admin-Location-Id': location, 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  })
  assert.equal((await attachAdminRequestContext(req, db, { userId: 'u-1', email: 'owner@test.com' }, { ADMIN_LOCATION_MODE: mode })).ok, true)
  return { context: getAdminContext(req), req }
}

describe('location-aware family packs (mocked D1 only)', () => {
  it('keeps legacy queries, children, allocation and mutations season-only when disabled', async () => {
    const db = fixture(), { context } = await attach(db, { season: oldSeason, mode: false })
    db.calls.length = 0
    assert.equal((await listAdminFamilyPacks(db, oldSeason, { context })).length, 1)
    assert.equal((await getAdminFamilyPackById(db, 'FP001', oldSeason, context)).items.length, 1)
    const created = await createAdminFamilyPack(db, oldSeason, body(), context)
    assert.equal(created.pack.id, 'FP901')
    assert.equal((await updateAdminFamilyPack(db, 'FP901', oldSeason, body({ slug: 'changed' }), context)).ok, true)
    assert.equal((await setAdminFamilyPackActive(db, 'FP901', false, oldSeason, context)).ok, true)
    assert.equal((await setAdminFamilyPackArchived(db, 'FP901', true, oldSeason, context)).ok, true)
    assert.equal((await deleteAdminFamilyPack(db, 'FP901', oldSeason, context)).ok, true)
    assert.equal(await countFamilyPackCustomerRequestReferences(db, 'FP001', oldSeason, context), 1)
    assert.ok(db.calls.every(call => !call.sql.includes('location_id')))
  })

  it('reuses packs and products with older provenance across authorized operating seasons', async () => {
    const db = fixture()
    db.state.products[0].season_id = 'season-2025'
    for (const season of [oldSeason, newSeason]) {
      const { context } = await attach(db, { season })
      assert.deepEqual((await listAdminFamilyPacks(db, season, { context })).map(p => p.id), ['FP001'])
      const pack = await getAdminFamilyPackById(db, 'FP001', season, context)
      assert.equal(pack.items[0].productName, 'A product')
      assert.equal(pack.images[0].url, 'https://images.test/a.jpg')
    }
    const { context } = await attach(db)
    assert.equal((await updateAdminFamilyPack(db, 'FP001', newSeason, body({ slug: 'a-pack' }), context)).ok, true)
    assert.equal(db.state.family_packs[0].season_id, oldSeason)
  })

  for (const id of ['FP900', 'FP050']) {
    it(`rejects foreign/unmapped ${id} for all ID reads, counts and mutations`, async () => {
      const db = fixture(), { context } = await attach(db), before = structuredClone(db.state)
      assert.equal(await getAdminFamilyPackById(db, id, newSeason, context), null)
      assert.equal(await countFamilyPackCustomerRequestReferences(db, id, newSeason, context), 0)
      for (const operation of [
        () => updateAdminFamilyPack(db, id, newSeason, body(), context),
        () => deleteAdminFamilyPack(db, id, newSeason, context),
        () => setAdminFamilyPackActive(db, id, false, newSeason, context),
        () => setAdminFamilyPackArchived(db, id, true, newSeason, context),
      ]) assert.equal((await operation()).status, 404)
      assert.deepEqual(db.state, before)
    })
  }

  it('rejects cross-location product references before any batch', async () => {
    const db = fixture(), { context } = await attach(db), before = structuredClone(db.state)
    const payload = body({ items: [{ productId: 'P002', quantity: 1 }] })
    assert.equal((await createAdminFamilyPack(db, newSeason, payload, context)).ok, false)
    assert.equal((await updateAdminFamilyPack(db, 'FP001', newSeason, payload, context)).ok, false)
    assert.deepEqual(db.state, before)
  })

  it('scopes children through their parent and never joins a foreign product', async () => {
    const db = fixture(), { context } = await attach(db)
    db.state.family_pack_items.push({ id: 3, family_pack_id: 'FP001', product_id: 'P002', quantity: 1 })
    const pack = await getAdminFamilyPackById(db, 'FP001', newSeason, context)
    assert.deepEqual(pack.items.map(i => i.productId), ['P001'])
    assert.deepEqual(pack.images.map(i => i.id), [1])
    const otherChildren = structuredClone({ items: db.state.family_pack_items.filter(i => i.family_pack_id === 'FP900'), images: db.state.family_pack_images.filter(i => i.family_pack_id === 'FP900') })
    assert.equal((await updateAdminFamilyPack(db, 'FP001', newSeason, body({ slug: 'a-pack' }), context)).ok, true)
    assert.deepEqual(db.state.family_pack_items.filter(i => i.family_pack_id === 'FP900'), otherChildren.items)
    assert.deepEqual(db.state.family_pack_images.filter(i => i.family_pack_id === 'FP900'), otherChildren.images)
  })

  it('preserves global slug constraints and global FP allocation while stamping provenance', async () => {
    const db = fixture(), { context } = await attach(db)
    assert.equal((await createAdminFamilyPack(db, newSeason, body({ slug: 'b-pack' }), context)).errors.slug, 'Slug already in use.')
    assert.equal((await updateAdminFamilyPack(db, 'FP001', newSeason, body({ slug: 'b-pack' }), context)).errors.slug, 'Slug already in use.')
    const result = await createAdminFamilyPack(db, newSeason, body({ location_id: 'loc-b', season_id: 'season-2099' }), context)
    assert.equal(result.pack.id, 'FP901')
    const stored = db.state.family_packs.find(p => p.id === 'FP901')
    assert.equal(stored.location_id, 'loc-a'); assert.equal(stored.season_id, newSeason)
    assert.equal((await deleteAdminFamilyPack(db, 'FP901', newSeason, context)).ok, true)
    assert.ok(!db.state.family_pack_items.some(i => i.family_pack_id === 'FP901'))
    assert.ok(!db.state.family_pack_images.some(i => i.family_pack_id === 'FP901'))
  })

  it('counts historical and unmapped request references before deletion', async () => {
    const db = fixture(), { context } = await attach(db)
    db.state.customer_request_items.push({ request_id: 'unmapped-parent', family_pack_id: 'FP001' })
    assert.equal(await countFamilyPackCustomerRequestReferences(db, 'FP001', newSeason, context), 2)
    const result = await deleteAdminFamilyPack(db, 'FP001', newSeason, context)
    assert.equal(result.status, 409); assert.equal(result.referenceCount, 2)
  })

  it('keeps inactive/search filters and counts within the selected location', async () => {
    const db = fixture(), { context } = await attach(db)
    assert.deepEqual(await listAdminFamilyPacks(db, newSeason, { context, q: 'b-pack' }), [])
    assert.equal(await countFamilyPackCustomerRequestReferences(db, 'FP900', newSeason, context), 0)
    assert.equal((await setAdminFamilyPackActive(db, 'FP001', false, newSeason, context)).ok, true)
    assert.deepEqual(await listAdminFamilyPacks(db, newSeason, { context, includeInactive: false }), [])
    assert.equal((await listAdminFamilyPacks(db, newSeason, { context })).length, 1)
    const other = await attach(db, { location: 'loc-b' })
    assert.deepEqual((await listAdminFamilyPacks(db, newSeason, { context: other.context })).map(p => p.id), ['FP900'])
    assert.equal(await countFamilyPackCustomerRequestReferences(db, 'FP900', newSeason, other.context), 1)
  })

  it('checks parent ownership again inside child reads after the initial lookup', async () => {
    const db = fixture(), { context } = await attach(db)
    db.beforeQuery = (sql, state) => { if (sql.includes('FROM family_pack_images')) state.family_packs[0].location_id = 'loc-b' }
    const result = await getAdminFamilyPackById(db, 'FP001', newSeason, context)
    assert.deepEqual(result.images, []); assert.deepEqual(result.items, [])
  })

  for (const child of ['images', 'items']) {
    it(`rechecks parent ownership in ${child} inserts and rolls back replacement on failure`, async () => {
      const db = fixture(), { context } = await attach(db)
      let expected
      db.beforeBatch = state => { state.family_packs[0].location_id = 'loc-b'; expected = structuredClone(state) }
      const payload = child === 'images' ? body({ items: undefined }) : body({ images: undefined })
      const result = await updateAdminFamilyPack(db, 'FP001', newSeason, payload, context)
      assert.equal(result.status, 404)
      assert.deepEqual(db.state, expected)
    })
  }

  it('rolls back parent/images/item replacement when product ownership changes before the batch', async () => {
    const db = fixture(), { context } = await attach(db)
    let expected
    db.beforeBatch = state => { state.products[0].location_id = 'loc-b'; expected = structuredClone(state) }
    assert.equal((await updateAdminFamilyPack(db, 'FP001', newSeason, body({ slug: 'a-pack' }), context)).ok, false)
    assert.deepEqual(db.state, expected)
  })

  it('does not create a partial pack when a referenced product changes ownership', async () => {
    const db = fixture(), { context } = await attach(db)
    let expected
    db.beforeBatch = state => { state.products[0].location_id = 'loc-b'; expected = structuredClone(state) }
    assert.equal((await createAdminFamilyPack(db, newSeason, body(), context)).ok, false)
    assert.deepEqual(db.state, expected)
  })

  it('handles a global slug race without committing replacement children', async () => {
    const db = fixture(), { context } = await attach(db)
    let expected
    db.beforeBatch = state => { state.family_packs[1].slug = 'new-pack'; expected = structuredClone(state) }
    assert.equal((await createAdminFamilyPack(db, newSeason, body(), context)).errors.slug, 'Slug already in use.')
    assert.deepEqual(db.state, expected)
  })

  it('fails closed for invalid context and archived writes', async () => {
    const db = fixture(), { context } = await attach(db)
    await assert.rejects(listAdminFamilyPacks(db, newSeason, { context: { locationModeEnabled: true } }), e => e.status === 403)
    context.locationContext.location.status = 'archived'
    await assert.rejects(createAdminFamilyPack(db, newSeason, body(), context), e => e.status === 403)
  })

  it('passes validated scope through list/detail/create/update/status/delete routes', async () => {
    const db = fixture()
    const call = async options => { const { req } = await attach(db, options); return handleAdminFamilyPackRoutes(req, { DB: db }, new URL(req.url)) }
    assert.deepEqual((await (await call({})).json()).familyPacks.map(p => p.id), ['FP001'])
    for (const [method, path, payload] of [['GET', '/FP900'], ['PUT', '/FP900', body()], ['DELETE', '/FP900'], ['PATCH', '/FP900/status', { active: false }]]) {
      assert.equal((await call({ method, path, payload })).status, 404)
    }
    assert.equal((await call({ method: 'POST', payload: body() })).status, 201)
    assert.equal((await call({ method: 'PUT', path: '/FP901', payload: body({ slug: 'updated' }) })).status, 200)
    assert.equal((await call({ method: 'PATCH', path: '/FP901/status', payload: { active: false } })).status, 200)
    assert.equal((await call({ method: 'DELETE', path: '/FP901' })).status, 200)
  })
})
