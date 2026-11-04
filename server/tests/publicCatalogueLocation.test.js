import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { listPublicProducts, getPublicProductById, PUBLIC_PRODUCT_FIELD_KEYS } from '../src/services/publicProducts.js'
import { listPublicFamilyPacks, getPublicFamilyPackBySlug } from '../src/services/publicFamilyPacks.js'
import { resolvePublicCatalogueContext } from '../src/services/publicCatalogueSeason.js'
import { PUBLIC_REQUEST_CONTEXT_SQL, preparePublicCustomerRequestWriter, resolveTrustedPublicLocation } from '../src/services/publicCustomerRequestContext.js'
import { handlePublicProductsList, handlePublicProductById } from '../src/routes/publicProducts.js'
import { handlePublicFamilyPacksList, handlePublicFamilyPackBySlug } from '../src/routes/publicFamilyPacks.js'
import { publicCatalogueCacheKey } from '../src/routes/publicCatalogueResponse.js'

const season = 'season-2027'
const config = { ADMIN_LOCATION_MODE: 'true', PUBLIC_REQUEST_BUSINESS_ID: 'shop-a', PUBLIC_REQUEST_LOCATION_ID: 'loc-a', PUBLIC_REQUEST_SEASON_ID: season }
const otherConfig = { ...config, PUBLIC_REQUEST_BUSINESS_ID: 'shop-b', PUBLIC_REQUEST_LOCATION_ID: 'loc-b' }
const request = (path = '/api/public/products', headers = {}) => new Request('https://shop.test' + path, { headers })

function fixture() {
  const category = (slug, location_id, season_id = season) => ({ slug, label: slug, location_id, season_id })
  const product = (id, location_id, category_slug, season_id = season, sort_order = 0) => ({ id, location_id, category_slug, season_id, sort_order,
    name: id, pack: 'box', description: '', featured: 0, stock_status: 'available', images_json: '["/one.png","/two.png"]', active: 1, selling_price_paise: 10000,
    final_price_paise: 5000, purchase_rate_paise: 100, company: 'Internal', unit_rate_paise: 999 })
  const pack = (id, location_id, slug, season_id = season, sort_order = 0) => ({ id, location_id, slug, season_id, sort_order, name: slug,
    short_description: 'Description', active: 1, archived: 0, selling_price_paise: 5000, pack_label: 'Gift box' })
  const state = {
    publicSeason: season,
    contexts: [['loc-a', 'shop-a', season, 2027], ['loc-b', 'shop-b', season, 2027], ['loc-a', 'shop-a', 'season-2028', 2028]].map(([location_id, business_id, season_id, operating_year]) => ({
      location_id, business_id, season_id, operating_year, location_status: 'active', business_status: 'active', association_status: 'active', season_status: 'active',
    })),
    categories: [category('a-category', 'loc-a', 'season-2026'), category('b-category', 'loc-b'), category('legacy', null), category('test', null, 'season-2099')],
    products: [product('P001', 'loc-a', 'a-category', 'season-2026', 2), product('P002', 'loc-b', 'b-category'),
      product('P003', 'loc-a', 'a-category', 'season-2028', 1), product('P004', 'loc-a', 'b-category'),
      product('P005', null, 'legacy'), product('P006', null, 'test', 'season-2099'), { ...product('P007', 'loc-a', 'a-category'), active: 0 }],
    packs: [pack('FP001', 'loc-a', 'a-pack', 'season-2026', 2), pack('FP002', 'loc-b', 'b-pack'), pack('FP003', 'loc-a', 'a-second', 'season-2028', 1),
      pack('FP004', null, 'legacy-pack'), pack('FP005', null, 'test-pack', 'season-2099'), { ...pack('FP006', 'loc-a', 'inactive-pack'), active: 0 }],
    images: [{ id: 1, family_pack_id: 'FP001', url: '/a-second.png', sort_order: 1, is_cover: 0 }, { id: 2, family_pack_id: 'FP001', url: '/a-cover.png', sort_order: 0, is_cover: 1 },
      { id: 3, family_pack_id: 'FP002', url: '/b-private.png', sort_order: 0, is_cover: 1 }, { id: 4, family_pack_id: 'FP005', url: '/test.png', sort_order: 0, is_cover: 1 }],
    items: ['P001', 'P003', 'P002', 'P004', 'P005', 'P007'].map((product_id, i) => ({ id: i + 1, family_pack_id: 'FP001', product_id, quantity: i + 1, unit_label: 'box', sort_order: i })),
  }
  const db = { state, calls: [], beforeChild: null, prepare(raw) {
    const sql = raw.replace(/\s+/g, ' ').trim()
    return { bind(...v) {
      assert.equal((sql.match(/\?/g) ?? []).length, v.length, sql)
      const read = () => {
        db.calls.push({ sql, v })
        if (raw === PUBLIC_REQUEST_CONTEXT_SQL) return state.contexts.filter(r => r.location_id === v[0] && r.business_id === v[1] && r.season_id === v[2]).map(r => ({ ...r }))
        if (sql.includes('FROM platform_settings')) return state.publicSeason ? [{ public_catalogue_season_id: state.publicSeason }] : []
        if (sql.includes('FROM business_seasons')) return [{ status: 'active' }]
        if (sql.includes('FROM family_pack_images')) {
          db.beforeChild?.(state)
          const scoped = sql.includes('fp.location_id = ?'), loc = scoped ? v.at(-1) : null
          const ids = sql.includes('family_pack_id IN') ? v.slice(0, scoped ? -1 : undefined) : [v[0]]
          return state.images.filter(i => ids.includes(i.family_pack_id) && (!scoped || state.packs.some(p => p.id === i.family_pack_id && p.location_id === loc && p.active === 1)))
            .toSorted((a, b) => a.sort_order - b.sort_order || a.id - b.id)
        }
        if (sql.includes('FROM family_pack_items fpi')) {
          const scoped = sql.includes('fp.location_id = ?'), [ownership, id] = v
          const parent = state.packs.find(p => p.id === id)
          if (scoped && (!parent || parent.location_id !== ownership || parent.active !== 1)) return []
          return state.items.filter(i => i.family_pack_id === id).flatMap(i => {
            const p = state.products.find(p => p.id === i.product_id && p.active === 1 && (scoped ? p.location_id === ownership : p.season_id === ownership))
            const c = state.categories.find(c => c.slug === p?.category_slug && c.location_id === ownership)
            return p && (!scoped || c) ? [{ ...i, product_id: p.id, product_name: p.name, product_pack: p.pack }] : []
          }).toSorted((a, b) => a.sort_order - b.sort_order || a.id - b.id)
        }
        if (sql.includes('FROM products p')) {
          const byId = sql.includes('p.id = ?'), scoped = sql.includes('p.location_id = ?'), owner = v[byId ? 1 : 0]
          let rows = state.products.filter(p => (!byId || p.id === v[0]) && p.active === 1 && p.selling_price_paise > 0 && (scoped ? p.location_id === owner : p.season_id === owner)).flatMap(p => {
            const c = state.categories.find(c => c.slug === p.category_slug && (scoped ? c.location_id === p.location_id : c.season_id === p.season_id))
            return c ? [{ ...p, category_label: c.label }] : []
          }).toSorted((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
          if (!byId) rows = rows.slice(v.at(-1), v.at(-1) + v.at(-2))
          return rows
        }
        if (sql.includes('FROM family_packs fp')) {
          const bySlug = sql.includes('fp.slug = ?'), scoped = sql.includes('fp.location_id = ?'), owner = v[bySlug ? 1 : 0]
          return state.packs.filter(p => p.active === 1 && (!bySlug || p.slug === v[0]) && (scoped ? p.location_id === owner : p.season_id === owner))
            .toSorted((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
        }
        throw Error('Unexpected read: ' + sql)
      }
      return { async first() { return read()[0] ?? null }, async all() { return { results: read() } }, async run() { throw Error('Catalogue must be read-only') } }
    } }
  } }
  return db
}

describe('trusted public catalogue location reads (mocked D1 only)', () => {
  it('preserves disabled service results and public cache headers without any 0020 query', async () => {
    const db = fixture(), env = { DB: db, ADMIN_LOCATION_MODE: false, PUBLIC_REQUEST_LOCATION_ID: 'foreign' }
    assert.deepEqual((await listPublicProducts(db, {}, env)).map(p => p.id), ['P002', 'P004', 'P005'])
    assert.deepEqual((await listPublicFamilyPacks(db, env)).map(p => p.id), ['FP002', 'FP004'])
    const response = await handlePublicProductsList(request(), env)
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60')
    assert.equal(response.headers.get('ETag'), null)
    const detail = await handlePublicFamilyPackBySlug(request('/api/public/family-packs/b-pack'), env, 'b-pack')
    assert.equal(detail.headers.get('Cache-Control'), 'public, max-age=60'); assert.equal(detail.headers.get('ETag'), null)
    const pack = (await detail.json()).familyPack
    assert.equal(pack.coverImageUrl, '/b-private.png')
    assert.deepEqual(Object.keys(pack).sort(), ['id', 'slug', 'name', 'shortDescription', 'sellingPricePaise', 'sellingPriceInr', 'packLabel', 'sortOrder', 'coverImageUrl', 'images', 'items'].sort())
    assert.ok(db.calls.every(c => !/business_locations|location_seasons|location_id/.test(c.sql)))
  })

  it('isolates products, category labels and packs for two businesses sharing one season', async () => {
    const db = fixture()
    assert.deepEqual((await listPublicProducts(db, {}, config)).map(p => [p.id, p.categoryLabel]), [['P003', 'a-category'], ['P001', 'a-category']])
    assert.deepEqual((await listPublicProducts(db, {}, otherConfig)).map(p => [p.id, p.categoryLabel]), [['P002', 'b-category']])
    assert.deepEqual((await listPublicFamilyPacks(db, config)).map(p => p.id), ['FP003', 'FP001'])
    assert.deepEqual((await listPublicFamilyPacks(db, otherConfig)).map(p => p.id), ['FP002'])
    assert.equal(await getPublicProductById(db, 'P002', config), null)
    assert.equal(await getPublicFamilyPackBySlug(db, 'b-pack', config), null)
    assert.equal(await getPublicProductById(db, 'P004', config), null)
  })

  it('retains sorting, pagination, image fields, price visibility and older permanent catalogue provenance', async () => {
    const db = fixture()
    for (const operating of [season, 'season-2028']) {
      const env = { ...config, PUBLIC_REQUEST_SEASON_ID: operating }
      const products = await listPublicProducts(db, { limit: 1, offset: 1 }, env)
      assert.deepEqual(products.map(p => p.id), ['P001'])
      assert.deepEqual(Object.keys(products[0]).sort(), [...PUBLIC_PRODUCT_FIELD_KEYS].sort())
      assert.deepEqual(products[0].images, ['/one.png', '/two.png'])
      assert.equal(products[0].coverImageUrl, '/one.png'); assert.equal(products[0].sellingPricePaise, 10000)
      assert.equal((await getPublicFamilyPackBySlug(db, 'a-pack', env)).sellingPriceInr, 50)
    }
    const joins = db.calls.filter(c => c.sql.includes('FROM products p'))
    assert.ok(joins.every(c => c.sql.includes('c.location_id = p.location_id') && !c.sql.includes('season_id')))
  })

  it('scopes pack children, images, product and category joins through the owned parent', async () => {
    const db = fixture(), pack = await getPublicFamilyPackBySlug(db, 'a-pack', config)
    assert.deepEqual(pack.items.map(i => i.productId), ['P001', 'P003'])
    assert.deepEqual(pack.images.map(i => i.url), ['/a-cover.png', '/a-second.png'])
    assert.equal(pack.coverImageUrl, '/a-cover.png')
    const list = await listPublicFamilyPacks(db, config)
    assert.equal(list.find(p => p.id === 'FP001').coverImageUrl, '/a-cover.png')
    assert.ok(db.calls.filter(c => c.sql.includes('FROM family_pack_images')).every(c => c.sql.includes('fp.location_id = ?')))
    const items = db.calls.find(c => c.sql.includes('FROM family_pack_items fpi'))
    assert.ok(items.sql.includes('p.location_id = fp.location_id') && items.sql.includes('c.location_id = p.location_id'))
    db.beforeChild = state => { state.packs.find(p => p.id === 'FP001').location_id = 'loc-b' }
    const moved = await getPublicFamilyPackBySlug(db, 'a-pack', config)
    assert.deepEqual(moved.images, []); assert.deepEqual(moved.items, [])
  })

  it('ignores client business/location/season selectors on list and detail routes', async () => {
    const db = fixture(), env = { DB: db, ...config }
    const req = request('/api/public/products?business_id=shop-b&location_id=loc-b&season_id=season-2099', { 'X-Admin-Location-Id': 'loc-b', 'X-Admin-Season-Id': 'season-2099' })
    assert.deepEqual((await (await handlePublicProductsList(req, env)).json()).products.map(p => p.id), ['P003', 'P001'])
    assert.equal(db.calls.filter(c => c.sql === PUBLIC_REQUEST_CONTEXT_SQL.replace(/\s+/g, ' ').trim()).length, 1)
    assert.equal((await handlePublicProductById(req, env, 'P002')).status, 404)
    assert.equal((await handlePublicFamilyPackBySlug(req, env, 'b-pack')).status, 404)
    assert.deepEqual((await (await handlePublicFamilyPacksList(req, env)).json()).familyPacks.map(p => p.id), ['FP003', 'FP001'])
  })

  it('uses exactly the writer resolver rules and rejects missing, invalid, ambiguous or unmapped configuration', async () => {
    for (const override of [{ PUBLIC_REQUEST_BUSINESS_ID: '' }, { PUBLIC_REQUEST_LOCATION_ID: '' }, { PUBLIC_REQUEST_SEASON_ID: '' },
      { PUBLIC_REQUEST_BUSINESS_ID: 'wrong' }, { PUBLIC_REQUEST_LOCATION_ID: 'unmapped' }, { PUBLIC_REQUEST_SEASON_ID: 'season-2029' }, { PUBLIC_REQUEST_SEASON_ID: 'season-2099' }, { ADMIN_LOCATION_MODE: 'invalid' }]) {
      const db = fixture(), env = { ...config, ...override }
      const writer = await preparePublicCustomerRequestWriter(db, env)
      assert.equal(writer.ok, false)
      await assert.rejects(resolvePublicCatalogueContext(db, env), e => e.code === writer.error && e.status === writer.status && e.message === writer.message)
    }
    const db = fixture(); db.state.contexts.push({ ...db.state.contexts[0] })
    await assert.rejects(listPublicProducts(db, {}, config), e => e.status === 503)
    const valid = fixture(), writer = await preparePublicCustomerRequestWriter(valid, config), context = await resolvePublicCatalogueContext(valid, config)
    assert.deepEqual(context.scope, writer.scope)
    assert.deepEqual((await resolveTrustedPublicLocation(valid, config)).scope, writer.scope)
    await assert.rejects(listPublicProducts(valid, {}, config, { ok: true, scope: writer.scope }), e => e.status === 503)
  })

  for (const field of ['business_status', 'location_status', 'association_status', 'season_status']) it(`rejects archived ${field} identically to request creation`, async () => {
    const db = fixture(); db.state.contexts[0][field] = 'archived'
    assert.equal((await preparePublicCustomerRequestWriter(db, config)).ok, false)
    await assert.rejects(listPublicFamilyPacks(db, config), e => e.status === 503)
  })

  it('returns safe non-cacheable errors for all catalogue routes without valid context or schema', async () => {
    const routes = [handlePublicProductsList, handlePublicFamilyPacksList, (r, e) => handlePublicProductById(r, e, 'P001'), (r, e) => handlePublicFamilyPackBySlug(r, e, 'a-pack')]
    for (const route of routes) {
      const db = fixture(), env = { DB: db, ...config, PUBLIC_REQUEST_LOCATION_ID: '' }
      const response = await route(request(), env)
      assert.equal(response.status, 503); assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(response.headers.get('ETag'), null)
      assert.equal((await response.json()).error, 'catalogue_unavailable')
      assert.equal(db.calls.length, 0)
      db.prepare = () => { throw Error('no such table: business_locations') }
      const missing = await route(request(), { DB: db, ...config })
      assert.equal(missing.status, 503); assert.ok(!(await missing.text()).includes('business_locations'))
    }
  })

  it('does not expose NULL-owned or 2099 records even when the legacy public season points there', async () => {
    const db = fixture(); db.state.publicSeason = 'season-2099'
    assert.deepEqual((await listPublicProducts(db, {}, config)).map(p => p.id), ['P003', 'P001'])
    for (const id of ['P005', 'P006']) assert.equal(await getPublicProductById(db, id, config), null)
    for (const slug of ['legacy-pack', 'test-pack']) assert.equal(await getPublicFamilyPackBySlug(db, slug, config), null)
    assert.ok(db.calls.every(c => !c.sql.includes('platform_settings')))
  })

  it('fails closed without caching a successful-looking result if a location column is missing', async () => {
    const db = fixture(), prepare = db.prepare.bind(db)
    db.prepare = sql => {
      if (sql.includes('FROM products p')) throw Error('no such column: p.location_id')
      return prepare(sql)
    }
    const response = await handlePublicProductsList(request(), { DB: db, ...config })
    assert.equal(response.status, 503); assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.ok(!(await response.text()).includes('p.location_id'))
  })

  it('never shares cache identities across trusted locations or operating seasons', async () => {
    const db = fixture(), req = request(), contexts = [], tags = []
    for (const cfg of [config, otherConfig, { ...config, PUBLIC_REQUEST_SEASON_ID: 'season-2028' }]) {
      const env = { DB: db, ...cfg }, context = await resolvePublicCatalogueContext(db, env)
      contexts.push(publicCatalogueCacheKey(req, context))
      const response = await handlePublicProductsList(req, env)
      assert.equal(response.headers.get('Cache-Control'), 'no-store')
      tags.push(response.headers.get('ETag'))
    }
    assert.equal(new Set(contexts).size, 3); assert.equal(new Set(tags).size, 3)
    const changed = await handlePublicProductsList(request('/api/public/products', { 'If-None-Match': tags[0] }), { DB: db, ...otherConfig })
    assert.equal(changed.status, 200)
    assert.deepEqual((await changed.json()).products.map(p => p.id), ['P002'])
    for (const route of [handlePublicFamilyPacksList, (r, e) => handlePublicFamilyPackBySlug(r, e, 'a-pack'), (r, e) => handlePublicProductById(r, e, 'P001')]) {
      const response = await route(request(), { DB: db, ...config })
      assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.ok(response.headers.get('ETag'))
    }
  })
})
