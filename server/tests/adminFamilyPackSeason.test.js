import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { attachAdminSeasonContext } from '../src/middleware/requireAdmin.js'
import { handleAdminFamilyPackRoutes } from '../src/routes/adminFamilyPacks.js'
import { DEFAULT_ADMIN_SEASON_ID } from '../src/services/adminSeasonContext.js'
import { bindAdminServiceMode } from '../src/lib/adminServiceMode.js'
import {
  createAdminFamilyPack,
  deleteAdminFamilyPack,
  getAdminFamilyPackById,
  updateAdminFamilyPack,
} from '../src/services/adminFamilyPacks.js'

const OTHER_SEASON_ID = 'season-2099'
const ARCHIVED_SEASON_ID = 'season-archived'
const PACK_ID = 'FP001'

describe('admin family pack season authorization', () => {
  it('returns 403 when season membership is missing', async () => {
    const db = createFamilyPackSeasonDb({ memberships: [] })
    const request = new Request('https://example.com/api/admin/family-packs', {
      headers: { 'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID },
    })
    await attachAdminSeasonContext(request, db, {
      userId: 'u-none',
      email: 'none@test.com',
      role: 'owner',
    })
    const res = await handleAdminFamilyPackRoutes(request, { DB: db }, new URL(request.url))
    assert.equal(res?.status, 403)
  })

  it('platform admin without membership cannot access family packs', async () => {
    const db = createFamilyPackSeasonDb({ memberships: [], platformAdminUserIds: new Set(['u-platform']) })
    const request = new Request('https://example.com/api/admin/family-packs', {
      headers: { 'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID },
    })
    await attachAdminSeasonContext(request, db, {
      userId: 'u-platform',
      email: 'platform@test.com',
      role: 'owner',
    })
    const res = await handleAdminFamilyPackRoutes(request, { DB: db }, new URL(request.url))
    assert.equal(res?.status, 403)
  })

  it('allows archived season reads but blocks writes', async () => {
    const db = createFamilyPackSeasonDb({
      packSeasonId: ARCHIVED_SEASON_ID,
      memberships: [membershipRow(ARCHIVED_SEASON_ID, 'owner', 'archived')],
    })
    const getReq = new Request(`https://example.com/api/admin/family-packs/${PACK_ID}`, {
      headers: { 'X-Admin-Season-Id': ARCHIVED_SEASON_ID },
    })
    await attachAdminSeasonContext(getReq, db, {
      userId: 'u-archived',
      email: 'archived@test.com',
      role: 'owner',
    })
    const getRes = await handleAdminFamilyPackRoutes(getReq, { DB: db }, new URL(getReq.url))
    assert.equal(getRes?.status, 200)

    const postReq = new Request('https://example.com/api/admin/family-packs', {
      method: 'POST',
      headers: {
        'X-Admin-Season-Id': ARCHIVED_SEASON_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Blocked',
        slug: 'blocked',
        sellingPriceInr: 10,
        active: true,
        items: [{ productId: 'P001', quantity: 1 }],
      }),
    })
    await attachAdminSeasonContext(postReq, db, {
      userId: 'u-archived',
      email: 'archived@test.com',
      role: 'owner',
    })
    const postRes = await handleAdminFamilyPackRoutes(postReq, { DB: db }, new URL(postReq.url))
    assert.equal(postRes?.status, 403)
    const postBody = await postRes.json()
    assert.match(postBody.message, /archived/i)
  })

  it('owner super_admin and admin can list on active season', async () => {
    for (const role of ['owner', 'super_admin', 'admin']) {
      const db = createFamilyPackSeasonDb({
        memberships: [membershipRow(DEFAULT_ADMIN_SEASON_ID, role, 'active')],
      })
      const request = new Request('https://example.com/api/admin/family-packs', {
        headers: { 'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID },
      })
      await attachAdminSeasonContext(request, db, {
        userId: `u-${role}`,
        email: `${role}@test.com`,
        role: role === 'admin' ? 'owner' : 'admin',
      })
      const res = await handleAdminFamilyPackRoutes(request, { DB: db }, new URL(request.url))
      assert.equal(res?.status, 200, role)
    }
  })

  it('uses season membership not global identity for write access', async () => {
    const db = createFamilyPackSeasonDb({
      memberships: [membershipRow(DEFAULT_ADMIN_SEASON_ID, 'admin', 'active')],
    })
    const request = new Request(`https://example.com/api/admin/family-packs/${PACK_ID}/status`, {
      method: 'PATCH',
      headers: {
        'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ active: false }),
    })
    await attachAdminSeasonContext(request, db, {
      userId: 'u-admin',
      email: 'admin@test.com',
      role: 'owner',
    })
    const res = await handleAdminFamilyPackRoutes(request, { DB: db }, new URL(request.url))
    assert.equal(res?.status, 200)
  })
})

describe('admin family pack season isolation', () => {
  it('returns 403 on admin routes when active season is missing', async () => {
    const db = createFamilyPackSeasonDb()
    for (const [method, path] of [
      ['GET', '/api/admin/family-packs'],
      ['GET', `/api/admin/family-packs/${PACK_ID}`],
    ]) {
      const request = new Request(`https://example.com${path}`, { method })
      const res = await handleAdminFamilyPackRoutes(request, { DB: db }, new URL(request.url))
      assert.equal(res?.status, 403, `${method} ${path}`)
      const body = await res.json()
      assert.equal(body.error, 'forbidden')
    }
  })

  it('returns not_found for detail when pack belongs to another season', async () => {
    const db = createFamilyPackSeasonDb()
    const request = new Request(`https://example.com/api/admin/family-packs/${PACK_ID}`, {
      headers: { 'X-Admin-Season-Id': OTHER_SEASON_ID },
    })
    await attachAdminSeasonContext(request, db, {
      userId: 'admin-u-1',
      email: 'owner@test.com',
      role: 'owner',
    })
    const res = await handleAdminFamilyPackRoutes(request, { DB: db }, new URL(request.url))
    assert.equal(res?.status, 404)
  })

  it('lists only packs in the active season', async () => {
    const db = createFamilyPackSeasonDb()
    const request = new Request('https://example.com/api/admin/family-packs', {
      headers: { 'X-Admin-Season-Id': DEFAULT_ADMIN_SEASON_ID },
    })
    await attachAdminSeasonContext(request, db, {
      userId: 'admin-u-1',
      email: 'owner@test.com',
      role: 'owner',
    })
    const res = await handleAdminFamilyPackRoutes(request, { DB: db }, new URL(request.url))
    assert.equal(res?.status, 200)
    const body = await res.json()
    assert.equal(body.familyPacks.length, 1)
    assert.equal(body.familyPacks[0].id, PACK_ID)
  })

  it('rejects product references outside the active season on create', async () => {
    const db = createFamilyPackSeasonDb({ productSeasonId: OTHER_SEASON_ID })
    const result = await createAdminFamilyPack(db, DEFAULT_ADMIN_SEASON_ID, {
      name: 'Season Pack',
      slug: 'season-pack',
      sellingPriceInr: 100,
      active: true,
      items: [{ productId: 'P001', quantity: 1 }],
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(String(result.errors?.items ?? ''), /P001/)
  })

  it('returns not_found when updating a pack in another season', async () => {
    const db = createFamilyPackSeasonDb()
    const result = await updateAdminFamilyPack(db, PACK_ID, OTHER_SEASON_ID, {
      name: 'Nope',
      slug: 'nope',
      sellingPriceInr: 100,
      active: true,
      items: [{ productId: 'P001', quantity: 1 }],
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 404)
  })

  it('returns not_found when deleting a pack in another season', async () => {
    const db = createFamilyPackSeasonDb()
    const result = await deleteAdminFamilyPack(db, PACK_ID, OTHER_SEASON_ID)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 404)
    assert.ok(await getAdminFamilyPackById(db, PACK_ID, DEFAULT_ADMIN_SEASON_ID))
  })
})

function membershipRow(seasonId, role, status) {
  return {
    season_id: seasonId,
    role,
    disabled_at: null,
    created_at: '',
    code: seasonId.replace('season-', ''),
    label: seasonId,
    status,
  }
}

/** @param {{
 *   productSeasonId?: string,
 *   packSeasonId?: string,
 *   memberships?: Record<string, unknown>[],
 *   platformAdminUserIds?: Set<string>,
 * }} [opts] */
function createFamilyPackSeasonDb(opts = {}) {
  const productSeasonId = opts.productSeasonId ?? DEFAULT_ADMIN_SEASON_ID
  const packSeasonId = opts.packSeasonId ?? DEFAULT_ADMIN_SEASON_ID
  const defaultMemberships = [
    membershipRow(DEFAULT_ADMIN_SEASON_ID, 'owner', 'active'),
    membershipRow(OTHER_SEASON_ID, 'owner', 'active'),
  ]
  const membershipRows = opts.memberships ?? defaultMemberships
  const platformAdminUserIds = opts.platformAdminUserIds ?? new Set()
  const pack = {
    id: PACK_ID,
    slug: 'iso-pack',
    name: 'Iso Pack',
    short_description: '',
    selling_price_paise: 10000,
    pack_label: null,
    sort_order: 0,
    active: 1,
    archived: 0,
    created_at: '2026-10-18 00:00:00',
    updated_at: '2026-10-18 00:00:00',
    season_id: packSeasonId,
  }
  const product = {
    id: 'P001',
    name: 'Demo',
    pack: 'Box',
    active: 1,
    season_id: productSeasonId,
  }

  return bindAdminServiceMode({
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM platform_admins')) {
                const uid = String(params[0])
                return platformAdminUserIds.has(uid) ? { ok: 1 } : null
              }
              if (normalized.includes('FROM season_members sm')) {
                return null
              }
              if (normalized.includes('FROM products') && normalized.includes('season_id = ?')) {
                const productId = String(params[0])
                const seasonId = String(params[1])
                if (productId === product.id && seasonId === productSeasonId) return { ok: 1 }
                return null
              }
              if (normalized.includes('FROM family_packs') && normalized.includes('season_id = ?')) {
                const id = String(params[0])
                const seasonId = String(params[1])
                if (id === pack.id && seasonId === pack.season_id) {
                  if (normalized.includes('SELECT id, slug')) return { id: pack.id, slug: pack.slug }
                  if (normalized.includes('SELECT id, name')) return { id: pack.id, name: pack.name }
                  if (normalized.includes('SELECT id FROM family_packs')) return { id: pack.id }
                  return pack
                }
                return null
              }
              if (normalized.includes('FROM family_packs fp WHERE fp.id = ? AND fp.season_id = ?')) {
                const id = String(params[0])
                const seasonId = String(params[1])
                return id === pack.id && seasonId === pack.season_id ? pack : null
              }
              if (normalized.includes('FROM family_packs WHERE slug = ?')) {
                return null
              }
              if (normalized.includes('FROM family_packs') && normalized.includes('id GLOB')) {
                return { id: PACK_ID }
              }
              if (normalized.includes('COUNT(*) AS total') && normalized.includes('customer_request_items cri')) {
                return { total: 0 }
              }
              return null
            },
            async all() {
              if (normalized.includes('FROM season_members sm')) {
                return { results: membershipRows }
              }
              if (normalized.includes('FROM family_packs fp') && normalized.includes('fp.season_id = ?')) {
                const seasonId = String(params[0])
                return seasonId === pack.season_id ? { results: [{ ...pack }] } : { results: [] }
              }
              if (normalized.includes('FROM family_pack_images')) {
                return { results: [] }
              }
              if (normalized.includes('FROM family_pack_items fpi')) {
                return { results: [] }
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
    async batch() {},
  },{ADMIN_LOCATION_MODE:false})
}
