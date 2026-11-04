import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { listAdminCategories, createCategory, updateCategory } from '../src/services/adminCategories.js'
import {
  listAdminProducts, listAdminProductsPage, getAdminProductById, createAdminProduct,
  updateAdminProduct, archiveAdminProduct, restoreAdminProduct, setAdminProductActive, deleteAdminProduct,
} from '../src/services/adminProducts.js'
import { attachAdminRequestContext, getAdminContext } from '../src/middleware/requireAdmin.js'
import { ADMIN_LOCATION_CONTEXT_SQL } from '../src/services/adminLocationContext.js'
import { handleAdminCatalogueRoutes } from '../src/routes/adminCatalogue.js'

const oldSeason = 'season-2026', newSeason = 'season-2027'
const productBody = (id = 'P010', categorySlug = 'cat-a') => ({ id, categorySlug, name: 'New product', stockStatus: 'available', images: [] })

// An in-memory relational fixture, not SQLite/D1. Query predicates and joins are
// interpreted from the SQL actually emitted; every placeholder must be bound.
function fixture() {
  const product = (id, category_slug, location_id, season_id, name) => ({
    id, category_slug, location_id, season_id, name, active: 1, sort_order: Number(id.slice(1)),
    pack: '', description: '', featured: 0, stock_status: 'available', images_json: '[]',
    selling_price_paise: 1000, final_price_paise: 900, allow_loose_sale: 0,
  })
  const data = {
    categories: [
      { slug: 'cat-a', label: 'Location A', location_id: 'loc-a', season_id: oldSeason, sort_order: 1 },
      { slug: 'cat-b', label: 'Location B', location_id: 'loc-b', season_id: newSeason, sort_order: 2 },
      { slug: 'cat-null', label: 'Unmapped', location_id: null, season_id: 'season-2099', sort_order: 3 },
    ],
    products: [
      product('P001', 'cat-a', 'loc-a', oldSeason, 'Flower pots'),
      product('P002', 'cat-a', 'loc-a', oldSeason, 'Rocket pack'),
      product('P003', 'cat-b', 'loc-b', newSeason, 'Rocket foreign'),
      product('P004', 'cat-null', null, 'season-2099', 'Protected test'),
      product('P005', 'cat-b', 'loc-a', oldSeason, 'Bad category reference'),
    ],
    private_rates: [{ product_id: 'P001', location_id: 'loc-a', season_id: oldSeason, effective_to: null, unit_rate_paise: 1200 }],
    product_purchase_rates: [
      { product_id: 'P001', location_id: 'loc-a', season_id: oldSeason, effective_to: null, unit_rate_paise: 700 },
      { product_id: 'P002', location_id: 'loc-b', season_id: newSeason, effective_to: null, unit_rate_paise: 9999 },
    ],
    customer_request_items: [{ product_id: 'P002', request_season: oldSeason }],
    family_pack_items: [], quotation_items: [],
  }
  const calls = []
  const db = {
    data, calls, race: null,
    prepare(sql) {
      const text = sql.replace(/\s+/g, ' ').trim()
      return { bind(...values) {
        assert.equal((sql.match(/\?/g) ?? []).length, values.length, text)
        assert.ok(values.every(value => value !== undefined), 'D1 rejects undefined SQL bindings: ' + text)
        const execute = (mode) => {
          calls.push({ sql: text, values: [...values], mode })
          if (db.race) db.race(text, data)
          if (mode === 'run') return mutation(text, values)
          const rows = select(sql, text, values)
          return mode === 'first' ? rows[0] ?? null : { results: rows }
        }
        return { async first() { return execute('first') }, async all() { return execute('all') }, async run() { return execute('run') } }
      } }
    },
  }
  const scopeMatch = (row, sql, value) => row[sql.includes('location_id = ?') ? 'location_id' : 'season_id'] === value
  const ownedCategory = (p) => data.categories.some(c => c.slug === p.category_slug && c.location_id === p.location_id)
  function select(raw, sql, v) {
    if (raw === ADMIN_LOCATION_CONTEXT_SQL) {
      assert.equal(v[0], 'u-1')
      return ['loc-a', 'loc-b'].map(loc => ({
        season_user_id: v[0], member_season_id: v[1], season_role: data.seasonRole ?? 'owner', season_disabled_at: null,
        season_id: v[1], season_code: v[1], season_label: v[1], season_status: 'active',
        location_user_id: v[0], member_location_id: loc, location_member_season_id: v[1], location_role: data.locationRole ?? 'owner', location_disabled_at: null,
        location_id: loc, location_business_id: 'business-' + loc, location_slug: loc, location_name: loc, location_status: 'active',
        business_id: 'business-' + loc, business_slug: 'business-' + loc, business_name: 'Shop', business_type: 'permanent', business_status: 'active',
        association_location_id: loc, association_season_id: v[1], operating_year: Number(v[1].slice(-4)), association_status: 'active',
      }))
    }
    if (sql.includes('FROM platform_admins')) return []
    if (sql.includes('FROM season_members')) return [oldSeason, newSeason].map(season_id => ({ season_id, role: data.seasonRole ?? 'owner', disabled_at: null, created_at: '', code: season_id, label: season_id, status: 'active' }))
    const reference = sql.match(/^SELECT COUNT\(\*\) AS total FROM (customer_request_items|family_pack_items|quotation_items)/)
    if (reference) {
      const allowed = v.length === 1 || data.products.some(p => p.id === v[1] && p.location_id === v[2])
      return [{ total: allowed ? data[reference[1]].filter(r => r.product_id === v[0]).length : 0 }]
    }
    if (sql.includes('FROM products p')) {
      const locationMode = sql.includes('c.location_id = p.location_id')
      const byId = sql.includes('WHERE p.id = ?')
      const field = locationMode ? 'location_id' : 'season_id'
      assert.ok(sql.includes('p.' + field + ' = ?'), sql)
      if (locationMode) {
        assert.ok(sql.includes('pr.location_id = p.location_id'))
        assert.ok(sql.includes('ppr.location_id = p.location_id'))
        assert.ok(!sql.includes('p.season_id = ?'))
      }
      let n = byId ? 1 : 0
      let rows = data.products.filter(p => (!byId || p.id === v[0]) && p[field] === v[n]).flatMap(p => {
        const c = data.categories.find(c => c.slug === p.category_slug && c[field] === p[field])
        if (!c) return []
        const pr = data.private_rates.find(r => r.product_id === p.id && r.effective_to == null && r[field] === p[field])
        const ppr = data.product_purchase_rates.find(r => r.product_id === p.id && r.effective_to == null && r[field] === p[field])
        return [{ ...p, category_label: c.label, x4_selling_paise: pr?.unit_rate_paise ?? null, purchase_rate_paise: ppr?.unit_rate_paise ?? null }]
      })
      n++
      if (sql.includes('p.active = 1')) rows = rows.filter(p => p.active === 1)
      if (sql.includes('p.active = 0')) rows = rows.filter(p => p.active === 0)
      if (sql.includes('p.category_slug = ?')) { const category = v[n++]; rows = rows.filter(p => p.category_slug === category) }
      if (sql.includes('p.name LIKE ?')) {
        const query = v[n++].slice(1, -1).toLowerCase(); n++
        rows = rows.filter(p => p.name.toLowerCase().includes(query) || p.id.toLowerCase().includes(query))
      } else if (sql.includes('p.id LIKE ?')) { const query = v[n++].slice(0, -1); rows = rows.filter(p => p.id.startsWith(query)) }
      if (sql.includes('p.selling_price_paise IS NULL')) rows = rows.filter(p => p.selling_price_paise == null || p.selling_price_paise <= 0)
      if (sql.includes('ppr.id IS NULL')) rows = rows.filter(p => p.purchase_rate_paise == null)
      if (sql.startsWith('SELECT COUNT(*)')) return [{ total: rows.length }]
      rows.sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
      if (sql.includes('LIMIT ? OFFSET ?')) rows = rows.slice(v.at(-1), v.at(-1) + v.at(-2))
      return rows
    }
    if (sql.includes('FROM categories') && !sql.includes('FROM products WHERE')) {
      let rows = data.categories
      if (sql.includes('slug = ?')) rows = rows.filter(c => c.slug === v[0])
      if (sql.includes('location_id = ?') || sql.includes('season_id = ?')) rows = rows.filter(c => scopeMatch(c, sql, v.at(-1)))
      return rows.toSorted((a, b) => a.sort_order - b.sort_order).map(c => ({ ...c }))
    }
    if (sql.includes('FROM products WHERE id = ?')) {
      return data.products.filter(p => p.id === v[0] && (v.length === 1 || scopeMatch(p, sql, v[1])) && (!sql.includes('EXISTS') || ownedCategory(p))).map(p => ({ ...p }))
    }
    throw Error('Unexpected SELECT: ' + sql)
  }
  function mutation(sql, v) {
    const insert = sql.match(/^INSERT INTO (categories|products) \(([^)]+)\)/)
    if (insert) {
      const table = insert[1], columns = insert[2].split(',').map(c => c.trim())
      const row = Object.fromEntries(columns.map((column, i) => [column, v[i]]))
      const key = table === 'categories' ? 'slug' : 'id'
      if (data[table].some(r => r[key] === row[key])) throw Error('UNIQUE constraint failed: ' + table + '.' + key)
      if (sql.includes('WHERE EXISTS') && !data.categories.some(c => c.slug === v.at(-2) && c.location_id === v.at(-1))) return { meta: { changes: 0 } }
      data[table].push(row)
      return { meta: { changes: 1 } }
    }
    const update = sql.match(/^UPDATE (categories|products) SET (.*?) WHERE /)
    if (update) {
      const table = update[1], assignments = [...update[2].matchAll(/(\w+) = \?/g)].map(m => m[1]), n = assignments.length
      let rows
      if (table === 'categories') rows = data.categories.filter(c => scopeMatch(c, sql, v[n]) && c.slug === v[n + 1])
      else {
        rows = data.products.filter(p => p.id === v[n] && scopeMatch(p, sql, v[n + 1]) && (!sql.includes('EXISTS') || ownedCategory(p)))
        if (sql.includes('c.slug = ?')) rows = rows.filter(() => data.categories.some(c => c.slug === v[n + 2] && c.location_id === v[n + 3]))
      }
      for (const row of rows) assignments.forEach((key, i) => { row[key] = v[i] })
      return { meta: { changes: rows.length } }
    }
    if (sql.startsWith('DELETE FROM products')) {
      const rows = data.products.filter(p => p.id === v[0] && scopeMatch(p, sql, v[1]) && (!sql.includes('EXISTS') || ownedCategory(p)))
      data.products = data.products.filter(p => !rows.includes(p))
      return { meta: { changes: rows.length } }
    }
    throw Error('Unexpected mutation: ' + sql)
  }
  return db
}

async function context(db, season = newSeason, location = 'loc-a', mode = true) {
  const req = new Request('https://example.test/api/admin/products', { headers: { 'X-Admin-Season-Id': season, 'X-Admin-Location-Id': location } })
  const result = await attachAdminRequestContext(req, db, { userId: 'u-1', email: 'owner@test.com' }, { ADMIN_LOCATION_MODE: mode })
  assert.equal(result.ok, true)
  return getAdminContext(req)
}

async function route(db, path, method = 'GET', body, season = newSeason, mode = true) {
  const req = new Request('https://example.test/api/admin/' + path, {
    method, headers: { 'X-Admin-Season-Id': season, 'X-Admin-Location-Id': 'loc-a', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  assert.equal((await attachAdminRequestContext(req, db, { userId: 'u-1', email: 'owner@test.com' }, { ADMIN_LOCATION_MODE: mode })).ok, true)
  return handleAdminCatalogueRoutes(req, { DB: db }, new URL(req.url))
}

describe('admin category/product location catalogue (mocked D1 only)', () => {
  for (const mode of [false, true]) {
    it(`rejects direct Admin selling-price writes, including aliases and clearing (location mode ${mode})`, async () => {
      const db = fixture()
      // A global/season Owner cannot bypass an Admin stall role.
      db.data.seasonRole = mode ? 'owner' : 'admin'
      db.data.locationRole = 'admin'
      for (const key of ['sellingPriceInr', 'selling_price_inr']) {
        for (const value of [25, null, '']) {
          for (const [path, method] of [['products', 'POST'], ['products/P001', 'PATCH']]) {
            const before = structuredClone(db.data)
            const response = await route(db, path, method, { ...productBody(), [key]: value }, oldSeason, mode)
            assert.equal(response.status, 403)
            assert.deepEqual(db.data, before)
          }
        }
      }
      assert.ok(db.calls.every(call => call.mode !== 'run'))
    })

    for (const role of ['owner', 'super_admin']) {
      it(`allows ${role} selling-price create/update (location mode ${mode})`, async () => {
        const db = fixture()
        db.data.seasonRole = role; db.data.locationRole = role
        assert.equal((await route(db, 'products', 'POST', { ...productBody(), sellingPriceInr: 25 }, oldSeason, mode)).status, 201)
        const response = await route(db, 'products/P010', 'PATCH', { selling_price_inr: 30 }, oldSeason, mode)
        assert.equal(response.status, 200)
        assert.equal((await response.json()).product.sellingPricePaise, 3000)
      })
    }

    it(`preserves Admin non-price edits and sensitive-price restrictions (location mode ${mode})`, async () => {
      const db = fixture()
      db.data.seasonRole = 'admin'; db.data.locationRole = 'admin'
      assert.equal((await route(db, 'products', 'POST', productBody(), oldSeason, mode)).status, 201)
      const response = await route(db, 'products/P001', 'PATCH', { name: 'Renamed' }, oldSeason, mode)
      assert.equal(response.status, 200)
      const product = (await response.json()).product
      assert.equal(product.name, 'Renamed')
      assert.equal(product.sellingPricePaise, 1000)
      for (const key of ['purchaseRatePaise', 'purchaseRateInr', 'finalPricePaise', 'finalPriceInr', 'privateX4Paise', 'x4SellingPricePaise', 'profitPaise', 'marginPaise']) {
        assert.equal(Object.hasOwn(product, key), false, key)
      }
      for (const path of ['purchase-rate', 'private-rate', 'x4-selling-rate']) {
        assert.equal((await route(db, 'products/P001/' + path, 'PATCH', { unitRateInr: 10 }, oldSeason, mode)).status, 403)
        assert.equal((await route(db, 'products/P001/' + path, 'GET', undefined, oldSeason, mode)).status, 403)
      }
    })
  }
  const suppliedImages = ['/images/products/test.webp', 'https://res.cloudinary.com/test-cloud/image/upload/v1700000000/diwali/products/P010/1.webp']
  for (const [label, images] of [['omitted', undefined], ['empty', []], ['provided', suppliedImages]]) {
    it(`creates a product with images ${label} without undefined SQL bindings`, async () => {
      const db = fixture(), body = productBody()
      if (images === undefined) delete body.images
      else body.images = images
      const response = await route(db, 'products', 'POST', body, oldSeason, false)
      assert.equal(response.status, 201)
      const expected = images ?? []
      assert.deepEqual((await response.json()).product.images, expected)
      assert.equal(db.data.products.find(p => p.id === 'P010').images_json, JSON.stringify(expected))
    })
  }

  it('preserves omitted update images, clears explicit empty images and retains provided image order', async () => {
    const db = fixture(), ctx = await context(db, oldSeason, 'ignored', false)
    assert.equal((await createAdminProduct(db, oldSeason, { ...productBody(), images: suppliedImages }, ctx)).ok, true)
    const unchanged = await updateAdminProduct(db, oldSeason, 'P010', { name: 'Renamed' }, ctx)
    assert.equal(unchanged.ok, true)
    assert.deepEqual(unchanged.product.images, suppliedImages)
    const cleared = await updateAdminProduct(db, oldSeason, 'P010', { images: [] }, ctx)
    assert.equal(cleared.ok, true)
    assert.deepEqual(cleared.product.images, [])
    const replaced = await updateAdminProduct(db, oldSeason, 'P010', { images: suppliedImages.toReversed() }, ctx)
    assert.equal(replaced.ok, true)
    assert.deepEqual(replaced.product.images, suppliedImages.toReversed())
  })

  it('keeps rejecting invalid explicit images before a product insert', async () => {
    for (const images of [null, 'not-an-array', ['https://example.com/image.webp']]) {
      const db = fixture(), ctx = await context(db, oldSeason, 'ignored', false)
      const result = await createAdminProduct(db, oldSeason, { ...productBody(), images }, ctx)
      assert.equal(result.ok, false)
      assert.ok(result.errors.images)
      assert.equal(db.data.products.some(p => p.id === 'P010'), false)
    }
  })

  it('preserves legacy season predicates and joins with the gate disabled', async () => {
    const db = fixture(), ctx = await context(db, oldSeason, 'foreign-header', false)
    db.calls.length = 0
    assert.deepEqual((await listAdminCategories(db, oldSeason, ctx)).map(c => c.slug), ['cat-a'])
    assert.equal((await listAdminProducts(db, { seasonId: oldSeason, context: ctx })).length, 2)
    assert.equal((await listAdminProductsPage(db, { seasonId: oldSeason, context: ctx, limit: 10, offset: 0 })).total, 2)
    assert.equal((await updateAdminProduct(db, oldSeason, 'P001', { name: 'Legacy update' }, ctx)).ok, true)
    assert.equal((await archiveAdminProduct(db, oldSeason, 'P001', ctx)).ok, true)
    assert.equal((await restoreAdminProduct(db, oldSeason, 'P001', ctx)).ok, true)
    assert.equal((await updateCategory(db, oldSeason, 'cat-a', { label: 'Legacy category' }, ctx)).ok, true)
    assert.equal((await createCategory(db, oldSeason, { slug: 'legacy-new', label: 'Legacy new' }, ctx)).ok, true)
    assert.equal((await createAdminProduct(db, oldSeason, productBody(), ctx)).ok, true)
    assert.equal((await deleteAdminProduct(db, oldSeason, 'P010', ctx)).ok, true)
    assert.ok(db.calls.every(c => !c.sql.includes('location_id')))
    assert.equal(await getAdminProductById(db, newSeason, 'P001', ctx), null)
  })

  it('accesses a permanent location catalogue across independently authorized operating seasons', async () => {
    const db = fixture(), first = await context(db, oldSeason), second = await context(db)
    for (const [season, ctx] of [[oldSeason, first], [newSeason, second]]) {
      assert.deepEqual((await listAdminCategories(db, season, ctx)).map(c => c.slug), ['cat-a'])
      assert.deepEqual((await listAdminProducts(db, { seasonId: season, context: ctx })).map(p => p.id), ['P001', 'P002'])
      assert.equal((await getAdminProductById(db, season, 'P001', ctx)).purchaseRatePaise, 700)
      assert.equal((await getAdminProductById(db, season, 'P001', ctx)).x4SellingPricePaise, 1200)
    }
    assert.equal((await updateAdminProduct(db, newSeason, 'P001', { name: 'Updated in 2027' }, second)).ok, true)
    assert.equal(db.data.products.find(p => p.id === 'P001').season_id, oldSeason)
    assert.equal((await updateCategory(db, newSeason, 'cat-a', { label: 'Updated in 2027' }, second)).ok, true)
    assert.equal(db.data.categories[0].season_id, oldSeason)
  })

  it('scopes counts, pagination, category filters, missing rates and flexible search', async () => {
    const db = fixture(), ctx = await context(db)
    const page = await listAdminProductsPage(db, { seasonId: newSeason, context: ctx, limit: 1, offset: 1 })
    assert.equal(page.total, 2)
    assert.deepEqual(page.products.map(p => p.id), ['P002'])
    const options = { seasonId: newSeason, context: ctx, limit: 10, offset: 0 }
    assert.equal((await listAdminProductsPage(db, { ...options, categorySlug: 'cat-b' })).total, 0)
    assert.equal((await listAdminProductsPage(db, { ...options, missingPurchaseRateOnly: true })).products[0].id, 'P002')
    const search = await listAdminProductsPage(db, { ...options, q: 'rocket', flexSearch: true })
    assert.equal(search.total, 1)
    assert.deepEqual(search.products.map(p => p.id), ['P002'])
    const b = await context(db, newSeason, 'loc-b')
    assert.deepEqual((await listAdminProducts(db, { seasonId: newSeason, context: b })).map(p => p.id), ['P003'])
    assert.deepEqual((await listAdminCategories(db, newSeason, b)).map(c => c.slug), ['cat-b'])
  })

  it('does not expose malformed cross-location category/rate joins', async () => {
    const db = fixture(), ctx = await context(db)
    assert.equal(await getAdminProductById(db, newSeason, 'P005', ctx), null)
    assert.equal((await getAdminProductById(db, newSeason, 'P002', ctx)).purchaseRatePaise, null)
    db.data.categories[0].season_id = 'season-2025'
    assert.equal((await getAdminProductById(db, newSeason, 'P001', ctx)).id, 'P001')
  })

  for (const id of ['P003', 'P004', 'P005']) {
    it(`rejects foreign/unmapped/invalid-parent product ${id} for every ID operation`, async () => {
      const db = fixture(), ctx = await context(db), before = structuredClone(db.data)
      assert.equal(await getAdminProductById(db, newSeason, id, ctx), null)
      for (const operation of [
        () => updateAdminProduct(db, newSeason, id, { name: 'Forbidden' }, ctx),
        () => archiveAdminProduct(db, newSeason, id, ctx),
        () => restoreAdminProduct(db, newSeason, id, ctx),
        () => setAdminProductActive(db, newSeason, id, false, ctx),
        () => deleteAdminProduct(db, newSeason, id, ctx),
      ]) assert.equal((await operation()).status, 404)
      assert.deepEqual(db.data, before)
    })
  }

  it('rejects foreign category edits and cross-location product category assignment', async () => {
    const db = fixture(), ctx = await context(db), before = structuredClone(db.data)
    assert.equal((await updateCategory(db, newSeason, 'cat-b', { label: 'Forbidden' }, ctx)).status, 404)
    assert.equal((await createAdminProduct(db, newSeason, productBody('P010', 'cat-b'), ctx)).errors.categorySlug, 'Unknown category.')
    assert.equal((await updateAdminProduct(db, newSeason, 'P001', { categorySlug: 'cat-b' }, ctx)).errors.categorySlug, 'Unknown category.')
    assert.deepEqual(db.data, before)
  })

  it('stamps new ownership and operating-season provenance, ignoring body ownership hints', async () => {
    const db = fixture(), ctx = await context(db)
    assert.equal((await createCategory(db, newSeason, { slug: 'new-cat', label: 'New category', location_id: 'loc-b', season_id: 'season-2099' }, ctx)).ok, true)
    assert.equal((await createAdminProduct(db, newSeason, { ...productBody(), location_id: 'loc-b', season_id: 'season-2099' }, ctx)).ok, true)
    const category = db.data.categories.find(c => c.slug === 'new-cat'), product = db.data.products.find(p => p.id === 'P010')
    assert.equal(category.location_id, 'loc-a'); assert.equal(category.season_id, newSeason)
    assert.equal(product.location_id, 'loc-a'); assert.equal(product.season_id, newSeason)
    assert.equal(product.category_slug, 'cat-a')
    assert.equal((await archiveAdminProduct(db, newSeason, 'P010', ctx)).product.active, false)
    assert.equal((await restoreAdminProduct(db, newSeason, 'P010', ctx)).product.active, true)
    assert.equal((await deleteAdminProduct(db, newSeason, 'P010', ctx)).ok, true)
  })

  it('keeps global category slug and product ID reservations across locations', async () => {
    const db = fixture(), ctx = await context(db), before = structuredClone(db.data)
    assert.equal((await createCategory(db, newSeason, { slug: 'cat-b', label: 'Duplicate' }, ctx)).errors.slug, 'Category slug already exists.')
    assert.equal((await createAdminProduct(db, newSeason, productBody('P003'), ctx)).errors.id, 'Product id already exists.')
    assert.deepEqual(db.data, before)
  })

  it('reports global uniqueness races without changing the existing global keys', async () => {
    for (const table of ['categories', 'products']) {
      const db = fixture(), ctx = await context(db)
      db.race = (sql, data) => {
        if (!sql.startsWith('INSERT INTO ' + table)) return
        db.race = null
        data[table].push(table === 'categories'
          ? { slug: 'raced-cat', location_id: 'loc-b', season_id: oldSeason }
          : { id: 'P010', location_id: 'loc-b', season_id: oldSeason })
      }
      const result = table === 'categories'
        ? await createCategory(db, newSeason, { slug: 'raced-cat', label: 'New' }, ctx)
        : await createAdminProduct(db, newSeason, productBody(), ctx)
      assert.equal(result.ok, false)
      assert.equal(result.errors[table === 'categories' ? 'slug' : 'id'], table === 'categories' ? 'Category slug already exists.' : 'Product id already exists.')
    }
  })

  it('retains target-category ownership checks in the final product update', async () => {
    const db = fixture(), ctx = await context(db)
    db.data.categories.push({ slug: 'new-category', label: 'New', location_id: 'loc-a', season_id: newSeason })
    db.race = (sql, data) => {
      if (sql.startsWith('UPDATE products')) data.categories.find(c => c.slug === 'new-category').location_id = 'loc-b'
    }
    assert.equal((await updateAdminProduct(db, newSeason, 'P001', { categorySlug: 'new-category' }, ctx)).status, 404)
    assert.equal(db.data.products[0].category_slug, 'cat-a')
  })

  it('retains category ownership in the final update and follow-up lookup', async () => {
    const db = fixture(), ctx = await context(db)
    db.race = (sql, data) => { if (sql.startsWith('UPDATE categories')) data.categories[0].location_id = 'loc-b' }
    assert.equal((await updateCategory(db, newSeason, 'cat-a', { label: 'Forbidden' }, ctx)).status, 404)
    assert.equal(db.data.categories[0].label, 'Location A')
  })

  it('blocks deletion for an owned product referenced in an older operating season', async () => {
    const db = fixture(), ctx = await context(db)
    const result = await deleteAdminProduct(db, newSeason, 'P002', ctx)
    assert.equal(result.status, 409)
    assert.equal(result.referenceCount, 1)
    assert.ok(db.data.products.some(p => p.id === 'P002'))
  })

  it('revalidates category ownership in the product INSERT statement', async () => {
    const db = fixture(), ctx = await context(db)
    db.race = (sql, data) => { if (sql.startsWith('INSERT INTO products')) data.categories[0].location_id = 'loc-b' }
    const result = await createAdminProduct(db, newSeason, productBody(), ctx)
    assert.equal(result.ok, false)
    assert.equal(result.errors.categorySlug, 'Unknown category.')
    assert.ok(!db.data.products.some(p => p.id === 'P010'))
  })

  it('includes ownership in final mutation predicates after a lookup race', async () => {
    for (const operation of [
      (db, ctx) => updateAdminProduct(db, newSeason, 'P001', { name: 'Forbidden' }, ctx),
      (db, ctx) => archiveAdminProduct(db, newSeason, 'P001', ctx),
      (db, ctx) => deleteAdminProduct(db, newSeason, 'P001', ctx),
    ]) {
      const db = fixture(), ctx = await context(db)
      db.race = (sql, data) => { if (/^(UPDATE|DELETE)/.test(sql)) data.products[0].location_id = 'loc-b' }
      assert.equal((await operation(db, ctx)).status, 404)
      assert.equal(db.data.products[0].name, 'Flower pots')
      assert.equal(db.data.products[0].active, 1)
    }
  })

  it('fails closed for malformed, season-mismatched or archived write context before any query', async () => {
    const db = fixture(), valid = await context(db)
    for (const ctx of [{ locationModeEnabled: true }, { ...valid, activeSeasonId: oldSeason }]) {
      db.calls.length = 0
      await assert.rejects(listAdminProducts(db, { seasonId: newSeason, context: ctx }), e => e.status === 403)
      assert.equal(db.calls.length, 0)
    }
    valid.locationContext.location.status = 'archived'
    db.calls.length = 0
    await assert.rejects(createCategory(db, newSeason, { slug: 'new', label: 'New' }, valid), e => e.status === 403)
    assert.equal(db.calls.length, 0)
  })

  it('passes request scope through category, list/count, detail and mutation routes', async () => {
    const db = fixture()
    assert.deepEqual((await (await route(db, 'categories')).json()).categories.map(c => c.slug), ['cat-a'])
    const page = await (await route(db, 'products?page=1&limit=1')).json()
    assert.equal(page.pagination.total, 2)
    assert.equal((await route(db, 'products/P001')).status, 200)
    assert.equal((await route(db, 'products/P003')).status, 404)
    assert.equal((await route(db, 'categories/cat-b', 'PATCH', { label: 'Forbidden' })).status, 404)
    assert.equal((await route(db, 'products/P003', 'PATCH', { name: 'Forbidden' })).status, 404)
    assert.equal((await route(db, 'products/P003/archive', 'POST', {})).status, 404)
    assert.equal((await route(db, 'products/P003/status', 'PATCH', { active: false })).status, 404)
    assert.equal((await route(db, 'products/P003', 'DELETE')).status, 404)
    assert.equal((await route(db, 'products/P003/purchase-rate', 'PATCH', { unitRateInr: 10 })).status, 404)
    assert.equal((await route(db, 'products/P003/private-rate', 'PUT', { unitRateInr: 10 })).status, 404)
    assert.equal((await route(db, 'categories', 'POST', { slug: 'route-new', label: 'New' })).status, 201)
    assert.equal((await route(db, 'products', 'POST', productBody())).status, 201)
    assert.equal(db.data.products.find(p => p.id === 'P010').location_id, 'loc-a')
  })
})
