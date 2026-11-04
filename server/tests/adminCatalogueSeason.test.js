import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { attachAdminSeasonContext } from '../src/middleware/requireAdmin.js'
import { handleAdminCatalogueRoutes } from '../src/routes/adminCatalogue.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'

const SEASON_2027 = 'season-2027'
const ARCHIVED_SEASON = 'season-archived'

describe('admin catalogue season gate', () => {
  it('returns 403 when active season is missing', async () => {
    const request = new Request('https://example.com/api/admin/categories')
    const res = await handleAdminCatalogueRoutes(
      request,
      { DB: createEmptyDb() },
      new URL(request.url),
      { role: 'owner' },
    )
    assert.equal(res.status, 403)
    const body = await res.json()
    assert.equal(body.error, 'forbidden')
  })

  it('allows category list when season context is attached', async () => {
    const db = createSeasonDb()
    const request = await withSeasonContext(
      db,
      'u-1',
      DEFAULT_ADMIN_SEASON_ID,
      'owner',
      'owner',
      'https://example.com/api/admin/categories',
    )
    const res = await handleAdminCatalogueRoutes(
      request,
      { DB: db },
      new URL(request.url),
      { role: 'owner' },
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(Array.isArray(body.categories))
    assert.equal(body.categories.length, 1)
    assert.equal(body.categories[0].slug, 'others')
  })
})

describe('admin catalogue season-scoped authorization', () => {
  it('uses season role not global identity for sensitive pricing read', async () => {
    const db = createCatalogueAuthDb()
    const request = await withSeasonContext(
      db,
      'u-mixed',
      SEASON_2027,
      'owner',
      'admin',
      'https://example.com/api/admin/products/P001/private-rate',
    )
    const res = await handleAdminCatalogueRoutes(
      request,
      { DB: db },
      new URL(request.url),
      { role: 'owner' },
    )
    assert.equal(res.status, 403)
    const body = await res.json()
    assert.equal(body.error, 'forbidden')
  })

  it('allows sensitive pricing read when season role is super_admin', async () => {
    const db = createCatalogueAuthDb()
    const request = await withSeasonContext(
      db,
      'u-mixed',
      DEFAULT_ADMIN_SEASON_ID,
      'super_admin',
      'admin',
      'https://example.com/api/admin/products/P001/private-rate',
    )
    const res = await handleAdminCatalogueRoutes(
      request,
      { DB: db },
      new URL(request.url),
      { role: 'admin' },
    )
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.productId, 'P001')
  })

  it('allows archived season reads but rejects writes', async () => {
    const db = createCatalogueAuthDb({ archivedSeason: true })
    const getReq = await withSeasonContext(
      db,
      'u-archived',
      ARCHIVED_SEASON,
      'owner',
      'owner',
      'https://example.com/api/admin/categories',
    )
    const getRes = await handleAdminCatalogueRoutes(
      getReq,
      { DB: db },
      new URL(getReq.url),
      { role: 'owner' },
    )
    assert.equal(getRes.status, 200)

    const postReq = await withSeasonContext(
      db,
      'u-archived',
      ARCHIVED_SEASON,
      'owner',
      'owner',
      'https://example.com/api/admin/categories',
      'POST',
    )
    const postRes = await handleAdminCatalogueRoutes(
      postReq,
      { DB: db },
      new URL(postReq.url),
      { role: 'owner' },
    )
    assert.equal(postRes.status, 403)
    const postBody = await postRes.json()
    assert.match(postBody.message, /archived/i)
  })

  it('permits permanent delete for season owner only', async () => {
    const db = createCatalogueAuthDb({ allowDelete: true })
    const superReq = await withSeasonContext(
      db,
      'u-super-del',
      DEFAULT_ADMIN_SEASON_ID,
      'super_admin',
      'owner',
      'https://example.com/api/admin/products/P001',
      'DELETE',
    )
    const superRes = await handleAdminCatalogueRoutes(
      superReq,
      { DB: db },
      new URL(superReq.url),
      { role: 'owner' },
    )
    assert.equal(superRes.status, 403)

    const ownerReq = await withSeasonContext(
      db,
      'u-del',
      DEFAULT_ADMIN_SEASON_ID,
      'owner',
      'owner',
      'https://example.com/api/admin/products/P001',
      'DELETE',
    )
    const ownerRes = await handleAdminCatalogueRoutes(
      ownerReq,
      { DB: db },
      new URL(ownerReq.url),
      { role: 'owner' },
    )
    assert.equal(ownerRes.status, 200)
  })
})

/**
 * @param {ReturnType<typeof createCatalogueAuthDb>} db
 * @param {string} userId
 * @param {string} seasonHeader
 * @param {string} membershipRole
 * @param {string} identityRole
 * @param {string} url
 * @param {string} [method]
 */
async function withSeasonContext(db, userId, seasonHeader, membershipRole, identityRole, url, method = 'GET') {
  const request = new Request(url, {
    method,
    headers: { 'X-Admin-Season-Id': seasonHeader },
  })
  await attachAdminSeasonContext(request, db, {
    userId,
    email: `${userId}@test.com`,
    role: identityRole,
  })
  return request
}

function createEmptyDb() {
  return {
    prepare() {
      return {
        bind() {
          return {
            async all() {
              return { results: [] }
            },
            async first() {
              return null
            },
          }
        },
      }
    },
  }
}

function createSeasonDb() {
  return createCatalogueAuthDb()
}

/** @param {{ archivedSeason?: boolean, allowDelete?: boolean }} [opts] */
function createCatalogueAuthDb(opts = {}) {
  const membershipsByUser = {
    'u-1': [membershipRow(DEFAULT_ADMIN_SEASON_ID, 'owner', 'active')],
    'u-mixed': [
      membershipRow(DEFAULT_ADMIN_SEASON_ID, 'super_admin', 'active'),
      membershipRow(SEASON_2027, 'admin', 'active'),
    ],
    'u-archived': [membershipRow(ARCHIVED_SEASON, 'owner', opts.archivedSeason ? 'archived' : 'active')],
    'u-del': [membershipRow(DEFAULT_ADMIN_SEASON_ID, 'owner', 'active')],
    'u-super-del': [membershipRow(DEFAULT_ADMIN_SEASON_ID, 'super_admin', 'active')],
  }

  return {
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async all() {
              if (normalized.includes('FROM season_members sm')) {
                const userId = String(params[0])
                return { results: membershipsByUser[userId] ?? [] }
              }
              if (normalized.includes('FROM categories') && normalized.includes('season_id = ?')) {
                return {
                  results: [
                    {
                      slug: 'others',
                      label: 'Others',
                      sort_order: 0,
                      created_at: '',
                      updated_at: '',
                    },
                  ],
                }
              }
              return { results: [] }
            },
            async first() {
              if (normalized.includes('FROM platform_admins')) {
                return null
              }
              if (
                normalized.includes('FROM products') &&
                String(params[0]) === 'P001' &&
                (normalized.includes('season_id = ?') || normalized.includes('WHERE id = ?'))
              ) {
                return productRow()
              }
              if (normalized.includes('FROM private_rates') && normalized.includes('effective_to IS NULL')) {
                return {
                  id: 1,
                  product_id: 'P001',
                  unit_rate_paise: 12000,
                  effective_to: null,
                  notes: null,
                }
              }
              if (normalized.includes('SELECT COUNT(*)') && normalized.includes('customer_request_items')) {
                return { n: 0 }
              }
              return null
            },
            async run() {
              if (opts.allowDelete && normalized.includes('DELETE FROM products')) {
                return { meta: { changes: 1 } }
              }
              return { meta: { changes: 1 } }
            },
          }
        },
      }
    },
  }
}

function productRow() {
  return {
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
    created_at: '',
    updated_at: '',
  }
}

function membershipRow(seasonId, role, status) {
  return {
    season_id: seasonId,
    role,
    disabled_at: null,
    created_at: '2026-01-01',
    code: seasonId.replace('season-', ''),
    label: seasonId,
    status,
  }
}
