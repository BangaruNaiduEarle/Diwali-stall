import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'
import { filterAdminProductForRole } from '../src/lib/adminProductResponse.js'
import { mapAdminProductRow } from '../src/services/adminProducts.js'

const LOCAL_SECRET = 'local-dev-secret-at-least-32-characters-long'
const OWNER_EMAIL = 'owner@example.com'
const ADMIN_EMAIL = 'staff@example.com'
const SUPER_EMAIL = 'super@example.com'

describe('filterAdminProductForRole', () => {
  const sample = {
    id: 'P001',
    sellingPriceInr: 50,
    purchaseRateInr: 10,
    hasPurchaseRate: true,
    pricingMapping: { mappingStatus: 'verified', publicCataloguePriceDrift: true },
    x4SellingPriceInr: 120,
  }

  it('strips purchase, X4 config, and mapping for admin role', () => {
    const filtered = filterAdminProductForRole(sample, 'admin')
    assert.equal(filtered.sellingPriceInr, 50)
    assert.equal('purchaseRateInr' in filtered, false)
    assert.equal('x4SellingPriceInr' in filtered, false)
    assert.equal('hasX4SellingRate' in filtered, false)
    assert.equal('pricingMapping' in filtered, false)
  })

  it('preserves all fields for owner and super_admin', () => {
    for (const role of ['owner', 'super_admin']) {
      const filtered = filterAdminProductForRole(sample, role)
      assert.equal(filtered.sellingPriceInr, 50)
      assert.equal(filtered.purchaseRateInr, 10)
      assert.equal(filtered.x4SellingPriceInr, 120)
    }
  })
})

describe('admin products API role filtering', () => {
  it('omits sensitive fields for admin session role', async () => {
    const db = createRoleAwareMockDb('admin')
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: ADMIN_EMAIL },
      { email: ADMIN_EMAIL },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/products?page=1&limit=5', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      roleEnv(db),
      {},
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(body.products.length >= 1)
    const p = body.products[0]
    assert.equal('purchaseRateInr' in p, false)
    assert.equal('x4SellingPriceInr' in p, false)
    assert.equal('hasX4SellingRate' in p, false)
    assert.equal('pricingMapping' in p, false)
    assert.equal(p.sellingPriceInr, 50)
    assert.equal(p.sellingPricePaise, 5000)
  })

  it('returns the same normal selling price for owner and admin on list API', async () => {
    for (const role of ['owner', 'super_admin', 'admin']) {
      const email =
        role === 'owner' ? OWNER_EMAIL : role === 'super_admin' ? SUPER_EMAIL : ADMIN_EMAIL
      const db = createRoleAwareMockDb(role)
      const token = await signLocalDevAdminJwt(
        { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: email },
        { email },
      )
      const res = await worker.fetch(
        new Request('http://127.0.0.1/api/admin/products?page=1&limit=5', {
          headers: { 'Cf-Access-Jwt-Assertion': token },
        }),
        roleEnv(db),
        {},
      )
      assert.equal(res.status, 200, role)
      const p = (await res.json()).products[0]
      assert.equal(p.sellingPriceInr, 50, role)
      assert.equal(p.sellingPricePaise, 5000, role)
    }
  })

  it('omits X4 selling fields on product detail for admin session role', async () => {
    const db = createRoleAwareMockDb('admin')
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: ADMIN_EMAIL },
      { email: ADMIN_EMAIL },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/products/P001', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      roleEnv(db),
      {},
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    const p = body.product
    assert.equal('x4SellingPriceInr' in p, false)
    assert.equal('hasX4SellingRate' in p, false)
    assert.equal('pricingMapping' in p, false)
    assert.equal(p.sellingPriceInr, 50)
  })

  it('includes sensitive fields for super_admin session role', async () => {
    const db = createRoleAwareMockDb('super_admin')
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: SUPER_EMAIL },
      { email: SUPER_EMAIL },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/products?page=1&limit=5', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      roleEnv(db),
      {},
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    const p = body.products[0]
    assert.equal(p.sellingPriceInr, 50)
    assert.equal(typeof p.purchaseRateInr, 'number')
    assert.equal(p.x4SellingPriceInr, 120)
  })

  it('blocks purchase-rate endpoint for admin role', async () => {
    const db = createRoleAwareMockDb('admin')
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: ADMIN_EMAIL },
      { email: ADMIN_EMAIL },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/products/P001/purchase-rate', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      roleEnv(db),
      {},
    )
    assert.equal(res.status, 403)
  })
})

describe('admin X4 selling-rate API authorization', () => {
  for (const role of ['owner', 'super_admin']) {
    it(`${role} may GET x4-selling-rate`, async () => {
      const email = role === 'owner' ? OWNER_EMAIL : SUPER_EMAIL
      const db = createX4RateApiMockDb(role)
      const token = await signLocalDevAdminJwt(
        { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: email },
        { email },
      )
      const res = await worker.fetch(
        new Request('http://127.0.0.1/api/admin/products/P001/x4-selling-rate', {
          headers: { 'Cf-Access-Jwt-Assertion': token },
        }),
        roleEnv(db),
        {},
      )
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.productId, 'P001')
      assert.equal(body.rateKind, 'x4_selling')
      assert.equal(body.rate?.unitRatePaise, 12000)
    })
  }

  it('admin is denied GET x4-selling-rate', async () => {
    const db = createX4RateApiMockDb('admin')
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: ADMIN_EMAIL },
      { email: ADMIN_EMAIL },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/products/P001/x4-selling-rate', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      roleEnv(db),
      {},
    )
    assert.equal(res.status, 403)
  })

  for (const role of ['owner', 'super_admin']) {
    it(`${role} may PUT x4-selling-rate`, async () => {
      const email = role === 'owner' ? OWNER_EMAIL : SUPER_EMAIL
      const db = createX4RateApiMockDb(role)
      const token = await signLocalDevAdminJwt(
        { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: email },
        { email },
      )
      const res = await worker.fetch(
        new Request('http://127.0.0.1/api/admin/products/P001/x4-selling-rate', {
          method: 'PUT',
          headers: {
            'Cf-Access-Jwt-Assertion': token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ x4SellingPriceInr: 150 }),
        }),
        roleEnv(db),
        {},
      )
      assert.equal(res.status, 200)
      assert.equal(db.state.rates.get('P001'), 15000)
    })
  }

  it('admin PUT x4-selling-rate is denied and does not mutate stored rate', async () => {
    const db = createX4RateApiMockDb('admin')
    const token = await signLocalDevAdminJwt(
      { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: ADMIN_EMAIL },
      { email: ADMIN_EMAIL },
    )
    const res = await worker.fetch(
      new Request('http://127.0.0.1/api/admin/products/P001/x4-selling-rate', {
        method: 'PUT',
        headers: {
          'Cf-Access-Jwt-Assertion': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ x4SellingPriceInr: 999 }),
      }),
      roleEnv(db),
      {},
    )
    assert.equal(res.status, 403)
    assert.equal(db.state.rates.get('P001'), 12000)
    assert.equal(db.state.privateInsertCount, 0)
  })
})

function roleEnv(db) {
  return {
    DB: db,
    ADMIN_LOCAL_DEV_AUTH: '1',
    ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET,
    ADMIN_LOCAL_DEV_EMAIL: OWNER_EMAIL,
  }
}

/** @param {'owner' | 'super_admin' | 'admin'} role */
function createRoleAwareMockDb(role) {
  const row = {
    id: 'P001',
    category_slug: 'others',
    category_label: 'Others',
    name: 'Demo',
    pack: '1',
    description: '',
    featured: 0,
    stock_status: 'available',
    active: 1,
    sort_order: 0,
    images_json: '[]',
    company: 'TST',
    selling_price_paise: 5000,
    x4_selling_paise: 12000,
    purchase_rate_paise: 3000,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  }
  const users = new Map([
    [OWNER_EMAIL.toLowerCase(), { id: 'u-owner', email: OWNER_EMAIL, role: 'owner', disabled_at: null }],
    [ADMIN_EMAIL.toLowerCase(), { id: 'u-admin', email: ADMIN_EMAIL, role: 'admin', disabled_at: null }],
    [SUPER_EMAIL.toLowerCase(), { id: 'u-super', email: SUPER_EMAIL, role: 'super_admin', disabled_at: null }],
  ])
  const activeEmail = role === 'owner' ? OWNER_EMAIL : role === 'super_admin' ? SUPER_EMAIL : ADMIN_EMAIL

  const db = {
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM admin_users WHERE lower(email)')) {
                const u = users.get(String(params[0]).toLowerCase())
                if (!u) return null
                return {
                  id: u.id,
                  email: u.email,
                  display_name: u.email,
                  role: u.role,
                  password_hash: 'x',
                  disabled_at: u.disabled_at,
                }
              }
              if (normalized.includes('COUNT(*) AS total') && normalized.includes('products p')) {
                return { total: 1 }
              }
              if (normalized.includes('FROM products p') && normalized.includes('LIMIT')) {
                return null
              }
              if (
                (normalized.includes('FROM products WHERE id = ?') ||
                  (normalized.includes('FROM products p') && normalized.includes('WHERE p.id = ?'))) &&
                String(params[0]) === 'P001'
              ) {
                return { ...row }
              }
              if (normalized.includes('SELECT 1 FROM categories')) {
                return { ok: 1 }
              }
              return null
            },
            async all() {
              if (normalized.includes('FROM products p') && normalized.includes('LIMIT')) {
                return { results: [{ ...row }] }
              }
              return { results: [] }
            },
            async run() {
              return { meta: { changes: 1 } }
            },
          }
        },
      }
    },
  }
  void activeEmail
  return db
}

/** @param {'owner' | 'super_admin' | 'admin'} role */
function createX4RateApiMockDb(role) {
  const state = {
    rates: new Map([['P001', 12000]]),
    privateInsertCount: 0,
  }
  const users = new Map([
    [OWNER_EMAIL.toLowerCase(), { id: 'u-owner', email: OWNER_EMAIL, role: 'owner', disabled_at: null }],
    [ADMIN_EMAIL.toLowerCase(), { id: 'u-admin', email: ADMIN_EMAIL, role: 'admin', disabled_at: null }],
    [SUPER_EMAIL.toLowerCase(), { id: 'u-super', email: SUPER_EMAIL, role: 'super_admin', disabled_at: null }],
  ])
  void role

  const productRow = {
    id: 'P001',
    category_slug: 'others',
    category_label: 'Others',
    name: 'Demo',
    pack: '1',
    description: '',
    featured: 0,
    stock_status: 'available',
    active: 1,
    sort_order: 0,
    images_json: '[]',
    company: 'TST',
    selling_price_paise: 5000,
    x4_selling_paise: 12000,
    purchase_rate_paise: 3000,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  }

  const db = {
    state,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM admin_users WHERE lower(email)')) {
                const u = users.get(String(params[0]).toLowerCase())
                if (!u) return null
                return {
                  id: u.id,
                  email: u.email,
                  display_name: u.email,
                  role: u.role,
                  password_hash: 'x',
                  disabled_at: u.disabled_at,
                }
              }
              if (
                (normalized.includes('FROM products WHERE id = ?') ||
                  (normalized.includes('FROM products p') && normalized.includes('WHERE p.id = ?'))) &&
                String(params[0]) === 'P001'
              ) {
                return { ...productRow }
              }
              if (normalized.includes('FROM private_rates') && normalized.includes('effective_to IS NULL')) {
                const paise = state.rates.get(String(params[0]))
                return paise == null
                  ? null
                  : {
                      id: 1,
                      product_id: params[0],
                      unit_rate_paise: paise,
                      effective_to: null,
                      notes: null,
                    }
              }
              return null
            },
            async all() {
              return { results: [] }
            },
            async run() {
              if (normalized.includes('UPDATE private_rates') && normalized.includes('effective_to')) {
                return { meta: { changes: 1 } }
              }
              if (normalized.startsWith('INSERT INTO private_rates')) {
                state.privateInsertCount += 1
                state.rates.set(String(params[0]), params[1])
                return { meta: { changes: 1 } }
              }
              return { meta: { changes: 1 } }
            },
          }
        },
      }
    },
    async batch(stmts) {
      for (const s of stmts) await s.run()
    },
  }
  return db
}

describe('mapAdminProductRow baseline', () => {
  it('leaves selling price missing when D1 selling_price_paise is null', () => {
    const mapped = mapAdminProductRow({
      id: 'P999',
      category_slug: 'others',
      category_label: 'Others',
      name: 'Sample',
      pack: '1',
      description: '',
      featured: 0,
      stock_status: 'available',
      active: 1,
      sort_order: 0,
      images_json: '[]',
      company: 'TST',
      selling_price_paise: null,
      x4_selling_paise: 12000,
      purchase_rate_paise: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    })
    assert.equal(mapped.sellingPriceInr, null)
    assert.equal(mapped.sellingPricePaise, null)
    assert.equal(mapped.x4SellingPriceInr, 120)
    assert.equal(mapped.hasX4SellingRate, true)
  })

  it('includes purchase and mapping fields before role filter', () => {
    const mapped = mapAdminProductRow({
      id: 'P005',
      category_slug: 'others',
      category_label: 'Others',
      name: 'Sample',
      pack: '1',
      description: '',
      featured: 0,
      stock_status: 'available',
      active: 1,
      sort_order: 0,
      images_json: '[]',
      company: 'TST',
      selling_price_paise: 5000,
      x4_selling_paise: 12000,
      purchase_rate_paise: 3000,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    })
    assert.equal(mapped.purchaseRateInr, 30)
    assert.equal(mapped.sellingPriceInr, 50)
  })
})
