import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import worker from '../src/index.js'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'
import {
  isValidFamilyPackSlug,
  normalizeFamilyPackImages,
  validateFamilyPackPayload,
} from '../src/lib/familyPackValidation.js'
import {
  createAdminFamilyPack,
  deleteAdminFamilyPack,
  getAdminFamilyPackById,
  setAdminFamilyPackActive,
  updateAdminFamilyPack,
} from '../src/services/adminFamilyPacks.js'
import { getPublicFamilyPackBySlug, listPublicFamilyPacks } from '../src/services/publicFamilyPacks.js'
import { validateCustomerRequestBody } from '../src/lib/customerRequestValidation.js'
import { resolveRequestLines } from '../src/services/publicCustomerRequests.js'

const LOCAL_SECRET = 'local-dev-secret-at-least-32-characters-long'
const ALLOWED_EMAIL = 'owner@example.com'

function localEnv(db) {
  return {
    DB: db,
    ADMIN_LOCAL_DEV_AUTH: '1',
    ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET,
    ADMIN_LOCAL_DEV_EMAIL: ALLOWED_EMAIL,
  }
}

async function adminFetch(path, { method = 'GET', body, db } = {}) {
  const token = await signLocalDevAdminJwt(
    { ADMIN_LOCAL_DEV_SECRET: LOCAL_SECRET, ADMIN_LOCAL_DEV_EMAIL: ALLOWED_EMAIL },
    { email: ALLOWED_EMAIL },
  )
  const init = {
    method,
    headers: {
      'Cf-Access-Jwt-Assertion': token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }
  return worker.fetch(new Request(`http://127.0.0.1${path}`, init), localEnv(db), {})
}

describe('family pack validation', () => {
  it('allows empty items on create for draft packs', () => {
    const draft = validateFamilyPackPayload(
      { name: 'Draft', slug: 'draft-pack', sellingPriceInr: 500, items: [], active: false },
      { isCreate: true },
    )
    assert.equal(draft.ok, true)

    const updateEmpty = validateFamilyPackPayload(
      { name: 'Draft', slug: 'draft-pack', sellingPriceInr: 500, items: [] },
      { isCreate: false },
    )
    assert.equal(updateEmpty.ok, false)
  })

  it('accepts slug and rejects invalid price or quantity', () => {
    assert.equal(isValidFamilyPackSlug('budget-family'), true)
    assert.equal(isValidFamilyPackSlug('Bad Slug'), false)

    const bad = validateFamilyPackPayload(
      { name: 'Test', slug: 'test', sellingPriceInr: 0, items: [{ productId: 'P001', quantity: 1 }] },
      { isCreate: true },
    )
    assert.equal(bad.ok, false)

    const imgs = normalizeFamilyPackImages([{ url: 'https://cdn.example/a.jpg', isCover: true }])
    assert.equal(imgs.ok, true)
    if (imgs.ok) assert.equal(imgs.images[0].isCover, true)
  })
})

describe('family pack service (mock D1)', () => {
  it('creates draft pack with no items then persists images via update', async () => {
    const db = createFamilyPackMockDb()
    const created = await createAdminFamilyPack(db, {
      name: 'Photos First',
      slug: 'photos-first',
      sellingPriceInr: 250,
      active: false,
      items: [],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    assert.equal(created.pack.items.length, 0)

    const imageA = 'https://res.cloudinary.com/demo/image/upload/v1/a.jpg'
    const updated = await updateAdminFamilyPack(db, created.pack.id, {
      name: 'Photos First',
      slug: 'photos-first',
      sellingPriceInr: 250,
      active: false,
      images: [{ url: imageA, isCover: true, sortOrder: 0 }],
    })
    assert.equal(updated.ok, true)
    if (!updated.ok) return
    assert.equal(updated.pack.images.length, 1)
    assert.equal(updated.pack.images[0].url, imageA)
  })

  it('creates pack, lists public active only, and hides inactive', async () => {
    const db = createFamilyPackMockDb()
    const created = await createAdminFamilyPack(db, {
      name: 'Happy Family',
      slug: 'happy-family',
      sellingPriceInr: 999,
      active: true,
      images: [{ url: 'https://res.cloudinary.com/demo/a.jpg', isCover: true }],
      items: [{ productId: 'P001', quantity: 2, unitLabel: 'Box' }],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    assert.match(created.pack.id, /^FP\d+$/)

    const publicList = await listPublicFamilyPacks(db)
    assert.equal(publicList.length, 1)
    assert.equal(publicList[0].slug, 'happy-family')

    const detail = await getPublicFamilyPackBySlug(db, 'happy-family')
    assert.ok(detail)
    assert.equal(detail.items.length, 1)

    await setAdminFamilyPackActive(db, created.pack.id, false)
    const hidden = await listPublicFamilyPacks(db)
    assert.equal(hidden.length, 0)
    const missing = await getPublicFamilyPackBySlug(db, 'happy-family')
    assert.equal(missing, null)

    const adminView = await getAdminFamilyPackById(db, created.pack.id)
    assert.ok(adminView)
    assert.equal(adminView.active, false)
  })

  it('persists multiple images on update and exposes cover plus order on public API', async () => {
    const db = createFamilyPackMockDb()
    const created = await createAdminFamilyPack(db, {
      name: 'Budget Mix Pack',
      slug: 'budget-mix-pack',
      sellingPriceInr: 499,
      active: true,
      items: [{ productId: 'P001', quantity: 1, unitLabel: 'Box' }],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    const id = created.pack.id

    const imageA = 'https://res.cloudinary.com/demo/image/upload/v1/family-packs/fp-a.jpg'
    const imageB = 'https://res.cloudinary.com/demo/image/upload/v1/family-packs/fp-b.jpg'
    const updated = await updateAdminFamilyPack(db, id, {
      name: 'Budget Mix Pack',
      slug: 'budget-mix-pack',
      sellingPriceInr: 499,
      active: true,
      images: [
        { url: imageA, sortOrder: 0, isCover: false },
        { url: imageB, sortOrder: 1, isCover: true },
      ],
      items: [{ productId: 'P001', quantity: 1, unitLabel: 'Box' }],
    })
    assert.equal(updated.ok, true)
    if (!updated.ok) return

    const adminView = await getAdminFamilyPackById(db, id)
    assert.ok(adminView)
    assert.equal(adminView.images.length, 2)
    assert.equal(adminView.images[0].url, imageA)
    assert.equal(adminView.images[1].url, imageB)
    assert.equal(adminView.images[1].isCover, true)

    const publicDetail = await getPublicFamilyPackBySlug(db, 'budget-mix-pack')
    assert.ok(publicDetail)
    assert.equal(publicDetail.coverImageUrl, imageB)
    assert.equal(publicDetail.images.length, 2)
    assert.deepEqual(
      publicDetail.images.map((img) => img.url),
      [imageA, imageB],
    )
    assert.equal(publicDetail.images[1].isCover, true)
  })

  it('deactivated pack rejects customer request lines', async () => {
    const db = createFamilyPackMockDb()
    const created = await createAdminFamilyPack(db, {
      name: 'Inactive Me',
      slug: 'inactive-me',
      sellingPriceInr: 500,
      active: true,
      items: [{ productId: 'P001', quantity: 1 }],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return

    await setAdminFamilyPackActive(db, created.pack.id, false)
    const lines = await resolveRequestLines(db, [{ familyPackId: created.pack.id, quantity: 1 }])
    assert.equal(lines.ok, false)
  })

  it('accepts family pack lines in customer request validation', () => {
    const body = validateCustomerRequestBody({
      customer: { name: 'Ravi Kumar', mobile: '9876543210' },
      items: [{ familyPackId: 'FP001', quantity: 1 }],
    })
    assert.equal(body.ok, true)
  })

  it('updates name, price, images, and items without duplicating children', async () => {
    const db = createFamilyPackMockDb()
    const created = await createAdminFamilyPack(db, {
      name: 'Original',
      slug: 'original',
      sellingPriceInr: 100,
      active: false,
      images: [{ url: 'https://res.cloudinary.com/demo/old.jpg', isCover: true }],
      items: [{ productId: 'P001', quantity: 1, unitLabel: 'Box' }],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    const id = created.pack.id

    const updated = await updateAdminFamilyPack(db, id, {
      name: 'Renamed Pack',
      slug: 'renamed-pack',
      sellingPriceInr: 250,
      active: true,
      images: [
        { url: 'https://res.cloudinary.com/demo/a.jpg', isCover: false },
        { url: 'https://res.cloudinary.com/demo/b.jpg', isCover: true },
      ],
      items: [
        { productId: 'P001', quantity: 3, unitLabel: 'Pkt' },
      ],
    })
    assert.equal(updated.ok, true)
    if (!updated.ok) return
    assert.equal(updated.pack.name, 'Renamed Pack')
    assert.equal(updated.pack.sellingPriceInr, 250)
    assert.equal(updated.pack.images.length, 2)
    assert.equal(updated.pack.images.find((img) => img.isCover)?.url.includes('/b.jpg'), true)
    assert.equal(updated.pack.items.length, 1)
    assert.equal(updated.pack.items[0].quantity, 3)

    const again = await getAdminFamilyPackById(db, id)
    assert.equal(again?.items.length, 1)
    assert.equal(again?.images.length, 2)
  })

  it('reactivates a deactivated pack', async () => {
    const db = createFamilyPackMockDb()
    const created = await createAdminFamilyPack(db, {
      name: 'Toggle Me',
      slug: 'toggle-me',
      sellingPriceInr: 400,
      active: true,
      items: [{ productId: 'P001', quantity: 1 }],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    await setAdminFamilyPackActive(db, created.pack.id, false)
    await setAdminFamilyPackActive(db, created.pack.id, true)
    const pack = await getAdminFamilyPackById(db, created.pack.id)
    assert.equal(pack?.active, true)
  })

  it('deletes unreferenced pack and removes child rows', async () => {
    const db = createFamilyPackMockDb()
    const created = await createAdminFamilyPack(db, {
      name: 'Disposable',
      slug: 'disposable',
      sellingPriceInr: 50,
      active: true,
      images: [{ url: 'https://res.cloudinary.com/demo/x.jpg', isCover: true }],
      items: [{ productId: 'P001', quantity: 2 }],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    const id = created.pack.id
    const deleted = await deleteAdminFamilyPack(db, id)
    assert.equal(deleted.ok, true)
    assert.equal(await getAdminFamilyPackById(db, id), null)
  })

  it('blocks delete when customer request lines reference the pack', async () => {
    const db = createFamilyPackMockDb()
    const created = await createAdminFamilyPack(db, {
      name: 'Referenced',
      slug: 'referenced',
      sellingPriceInr: 50,
      active: true,
      items: [{ productId: 'P001', quantity: 1 }],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    db.addCustomerRequestReference(created.pack.id)
    const blocked = await deleteAdminFamilyPack(db, created.pack.id)
    assert.equal(blocked.ok, false)
    if (blocked.ok) return
    assert.equal(blocked.status, 409)
    assert.ok(await getAdminFamilyPackById(db, created.pack.id))
  })
})

describe('family pack admin HTTP (mock D1)', () => {
  it('creates, reads, updates, and deletes through worker routes', async () => {
    const db = createFamilyPackMockDb()
    const createRes = await adminFetch('/api/admin/family-packs', {
      method: 'POST',
      db,
      body: {
        name: 'HTTP Pack',
        slug: 'http-pack',
        sellingPriceInr: 799,
        active: true,
        images: [{ url: 'https://res.cloudinary.com/demo/http.jpg', isCover: true }],
        items: [{ productId: 'P001', quantity: 1, unitLabel: 'Box' }],
      },
    })
    assert.equal(createRes.status, 201)
    const createdBody = await createRes.json()
    const id = createdBody.familyPack.id

    const getRes = await adminFetch(`/api/admin/family-packs/${id}`, { db })
    assert.equal(getRes.status, 200)
    const getBody = await getRes.json()
    assert.equal(getBody.familyPack.slug, 'http-pack')

    const putRes = await adminFetch(`/api/admin/family-packs/${id}`, {
      method: 'PUT',
      db,
      body: {
        name: 'HTTP Pack Updated',
        slug: 'http-pack',
        sellingPriceInr: 899,
        active: true,
        items: [{ productId: 'P001', quantity: 2 }],
        images: [{ url: 'https://res.cloudinary.com/demo/http2.jpg', isCover: true }],
      },
    })
    assert.equal(putRes.status, 200)
    const putBody = await putRes.json()
    assert.equal(putBody.familyPack.name, 'HTTP Pack Updated')

    const delRes = await adminFetch(`/api/admin/family-packs/${id}`, { method: 'DELETE', db })
    assert.equal(delRes.status, 200)
    const missing = await adminFetch(`/api/admin/family-packs/${id}`, { db })
    assert.equal(missing.status, 404)
  })

  it('create-without-images then PUT images matches new-pack upload persist flow', async () => {
    const db = createFamilyPackMockDb()
    const createRes = await adminFetch('/api/admin/family-packs', {
      method: 'POST',
      db,
      body: {
        name: 'New Pack Draft',
        slug: 'new-pack-draft',
        sellingPriceInr: 499,
        active: false,
        items: [{ productId: 'P001', quantity: 1, unitLabel: 'Box' }],
      },
    })
    assert.equal(createRes.status, 201)
    const createdBody = await createRes.json()
    const id = createdBody.familyPack.id
    assert.match(id, /^FP\d+$/)

    const imageA = 'https://res.cloudinary.com/demo/image/upload/v1/new-a.jpg'
    const imageB = 'https://res.cloudinary.com/demo/image/upload/v1/new-b.jpg'
    const imageC = 'https://res.cloudinary.com/demo/image/upload/v1/new-c.jpg'
    const putRes = await adminFetch(`/api/admin/family-packs/${id}`, {
      method: 'PUT',
      db,
      body: {
        name: 'New Pack Draft',
        slug: 'new-pack-draft',
        sellingPriceInr: 499,
        active: false,
        items: [{ productId: 'P001', quantity: 1, unitLabel: 'Box' }],
        images: [
          { url: imageA, sortOrder: 0, isCover: false },
          { url: imageB, sortOrder: 1, isCover: false },
          { url: imageC, sortOrder: 2, isCover: true },
        ],
      },
    })
    assert.equal(putRes.status, 200)

    const getRes = await adminFetch(`/api/admin/family-packs/${id}`, { db })
    assert.equal(getRes.status, 200)
    const getBody = await getRes.json()
    assert.equal(getBody.familyPack.images.length, 3)
    assert.equal(getBody.familyPack.images[0].url, imageA)
    assert.equal(getBody.familyPack.images[1].url, imageB)
    assert.equal(getBody.familyPack.images[2].url, imageC)
    assert.equal(getBody.familyPack.images[2].isCover, true)

    await setAdminFamilyPackActive(db, id, true)
    const publicDetail = await getPublicFamilyPackBySlug(db, 'new-pack-draft')
    assert.ok(publicDetail)
    assert.equal(publicDetail.coverImageUrl, imageC)
    assert.equal(publicDetail.images.length, 3)
  })

  it('returns 409 when delete is blocked by customer request references', async () => {
    const db = createFamilyPackMockDb()
    const created = await createAdminFamilyPack(db, {
      name: 'Blocked',
      slug: 'blocked',
      sellingPriceInr: 100,
      active: true,
      items: [{ productId: 'P001', quantity: 1 }],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    db.addCustomerRequestReference(created.pack.id)
    const res = await adminFetch(`/api/admin/family-packs/${created.pack.id}`, { method: 'DELETE', db })
    assert.equal(res.status, 409)
    const body = await res.json()
    assert.match(body.message, /Archive/i)
  })
})

describe('family pack HTTP auth', () => {
  it('admin family pack routes require auth', async () => {
    const env = { DB: createFamilyPackMockDb() }
    const paths = [
      ['GET', '/api/admin/family-packs'],
      ['POST', '/api/admin/family-packs'],
      ['GET', '/api/admin/family-packs/FP001'],
      ['PUT', '/api/admin/family-packs/FP001'],
      ['PATCH', '/api/admin/family-packs/FP001/status'],
      ['DELETE', '/api/admin/family-packs/FP001'],
    ]
    for (const [method, path] of paths) {
      const res = await worker.fetch(new Request(`https://example.com${path}`, { method }), env, {})
      assert.equal(res.status, 401, `${method} ${path}`)
    }
  })

  it('public family pack list does not require auth', async () => {
    const res = await worker.fetch(
      new Request('https://example.com/api/public/family-packs'),
      { DB: createFamilyPackMockDb() },
      {},
    )
    assert.notEqual(res.status, 401)
  })
})

function createFamilyPackMockDb() {
  /** @type {Map<string, Record<string, unknown>>} */
  const products = new Map([['P001', { id: 'P001', name: 'Demo', active: 1, stock_status: 'available' }]])
  /** @type {Map<string, Record<string, unknown>>} */
  const packs = new Map()
  /** @type {Map<string, Record<string, unknown>[]>} */
  const images = new Map()
  /** @type {Map<string, Record<string, unknown>[]>} */
  const items = new Map()
  let nextImageId = 1
  let nextItemId = 1
  let nextFpNum = 1
  /** @type {Map<string, number>} */
  const requestRefsByPack = new Map()

  const db = {
    addCustomerRequestReference(packId) {
      const key = String(packId)
      requestRefsByPack.set(key, (requestRefsByPack.get(key) ?? 0) + 1)
    },
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM admin_users')) {
                const email = String(params[0]).toLowerCase()
                if (email === ALLOWED_EMAIL.toLowerCase()) return { ok: 1 }
                return null
              }
              if (normalized.includes('FROM products WHERE id')) {
                return products.get(String(params[0])) ?? null
              }
              if (normalized.includes('FROM family_packs WHERE slug = ? AND id !=')) {
                for (const pack of packs.values()) {
                  if (pack.slug === params[0] && pack.id !== params[1]) return { id: pack.id }
                }
                return null
              }
              if (normalized.includes('FROM family_packs WHERE slug = ?')) {
                for (const pack of packs.values()) {
                  if (pack.slug === params[0]) return pack
                }
                return null
              }
              if (normalized.includes('FROM family_packs WHERE id GLOB')) {
                let max = 0
                for (const pack of packs.values()) {
                  const n = Number(String(pack.id).slice(2))
                  if (n > max) max = n
                }
                return max ? { id: `FP${String(max).padStart(3, '0')}` } : null
              }
              if (normalized.includes('FROM family_packs fp WHERE fp.id = ?')) {
                return packs.get(String(params[0])) ?? null
              }
              if (normalized.includes('FROM family_packs fp WHERE fp.slug = ?')) {
                for (const pack of packs.values()) {
                  if (pack.slug === params[0] && pack.active === 1) {
                    return pack
                  }
                }
                return null
              }
              if (normalized.includes('SELECT id, name, active, archived, selling_price_paise FROM family_packs')) {
                return packs.get(String(params[0])) ?? null
              }
              if (normalized.includes('SELECT 1 FROM family_packs WHERE slug = ?')) {
                for (const pack of packs.values()) {
                  if (pack.slug === params[0]) return { ok: 1 }
                }
                return null
              }
              if (normalized.includes('SELECT id, slug FROM family_packs WHERE id = ?')) {
                const pack = packs.get(String(params[0]))
                return pack ? { id: pack.id, slug: pack.slug } : null
              }
              if (normalized.includes('SELECT archived FROM family_packs WHERE id = ?')) {
                const pack = packs.get(String(params[0]))
                return pack ? { archived: pack.archived } : null
              }
              if (normalized.includes('SELECT id, name FROM family_packs WHERE id = ?')) {
                const pack = packs.get(String(params[0]))
                return pack ? { id: pack.id, name: pack.name } : null
              }
              if (normalized.includes('COUNT(*) AS total FROM customer_request_items WHERE family_pack_id = ?')) {
                return { total: requestRefsByPack.get(String(params[0])) ?? 0 }
              }
              return null
            },
            async all() {
              if (normalized.includes('FROM family_packs fp') && normalized.includes('active = 1') && !normalized.includes('WHERE fp.slug')) {
                return {
                  results: [...packs.values()]
                    .filter((p) => p.active === 1)
                    .map((p) => ({ ...p })),
                }
              }
              if (normalized.includes('FROM family_packs fp') && !normalized.includes('WHERE fp.slug')) {
                return { results: [...packs.values()].map((p) => ({ ...p })) }
              }
              if (normalized.includes('FROM family_pack_images')) {
                const packId = params.length === 1 ? String(params[0]) : null
                if (packId) return { results: [...(images.get(packId) ?? [])] }
                const ids = params
                const out = []
                for (const id of ids) {
                  out.push(...(images.get(String(id)) ?? []))
                }
                return { results: out }
              }
              if (normalized.includes('FROM family_pack_items fpi')) {
                return { results: [...(items.get(String(params[0])) ?? [])] }
              }
              return { results: [] }
            },
            async run() {
              if (normalized.startsWith('UPDATE family_packs SET active')) {
                const pack = packs.get(String(params[1]))
                if (!pack) return { meta: { changes: 0 } }
                pack.active = params[0]
                pack.updated_at = 'now'
                return { meta: { changes: 1 } }
              }
              if (normalized.startsWith('UPDATE family_packs SET') && normalized.includes('archived')) {
                const pack = packs.get(String(params[2]))
                if (!pack) return { meta: { changes: 0 } }
                pack.archived = params[0]
                if (params[1] === 1) pack.active = 0
                return { meta: { changes: 1 } }
              }
              if (normalized.startsWith('UPDATE family_packs SET')) {
                const id = params[params.length - 1]
                const pack = packs.get(String(id))
                if (!pack) return { meta: { changes: 0 } }
                Object.assign(pack, {
                  slug: params[0],
                  name: params[1],
                  short_description: params[2],
                  selling_price_paise: params[3],
                  pack_label: params[4],
                  sort_order: params[5],
                  active: params[6],
                  updated_at: 'now',
                })
                return { meta: { changes: 1 } }
              }
              if (normalized.startsWith('DELETE FROM family_pack_images')) {
                images.set(String(params[0]), [])
                return { meta: { changes: 1 } }
              }
              if (normalized.startsWith('DELETE FROM family_pack_items')) {
                items.set(String(params[0]), [])
                return { meta: { changes: 1 } }
              }
              if (normalized.startsWith('DELETE FROM family_packs WHERE id = ?')) {
                const id = String(params[0])
                if (!packs.has(id)) return { meta: { changes: 0 } }
                packs.delete(id)
                images.delete(id)
                items.delete(id)
                return { meta: { changes: 1 } }
              }
              return { meta: { changes: 1 } }
            },
          }
        },
      }
    },
    async batch(statements) {
      for (const stmt of statements) {
        const sql = stmt._sql ?? stmt.bind?.()._sql
        const params = stmt._params
        if (!sql) continue
        const normalized = sql.replace(/\s+/g, ' ').trim()
        if (normalized.startsWith('INSERT INTO family_packs')) {
          const id = params[0] ?? `FP${String(nextFpNum++).padStart(3, '0')}`
          packs.set(id, {
            id,
            slug: params[1],
            name: params[2],
            short_description: params[3],
            selling_price_paise: params[4],
            pack_label: params[5],
            sort_order: params[6],
            active: params[7],
            archived: params[8] ?? 0,
            created_at: 'now',
            updated_at: 'now',
          })
          if (!images.has(id)) images.set(id, [])
          if (!items.has(id)) items.set(id, [])
        } else if (normalized.includes('INSERT INTO family_pack_images')) {
          const packId = String(params[0])
          const list = images.get(packId) ?? []
          list.push({
            id: nextImageId++,
            family_pack_id: packId,
            sort_order: params[1],
            url: params[2],
            is_cover: params[3],
          })
          images.set(packId, list)
        } else if (normalized.includes('INSERT INTO family_pack_items')) {
          const packId = String(params[0])
          const list = items.get(packId) ?? []
          const product = products.get(String(params[1]))
          list.push({
            id: nextItemId++,
            family_pack_id: packId,
            product_id: params[1],
            quantity: params[2],
            unit_label: params[3],
            sort_order: params[4],
            product_name: product?.name ?? 'Product',
            product_pack: '',
          })
          items.set(packId, list)
        } else {
          await db.prepare(normalized).bind(...params).run()
        }
      }
    },
  }

  // attach sql to batch statements from service
  const origPrepare = db.prepare.bind(db)
  db.prepare = (sql) => {
    const prepared = origPrepare(sql)
    const origBind = prepared.bind.bind(prepared)
    prepared.bind = (...params) => {
      const bound = origBind(...params)
      bound._sql = sql.replace(/\s+/g, ' ').trim()
      bound._params = params
      return bound
    }
    return prepared
  }

  return db
}
