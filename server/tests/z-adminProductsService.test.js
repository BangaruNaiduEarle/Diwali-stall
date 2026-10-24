import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  archiveAdminProduct,
  createAdminProduct,
  getAdminProductById,
  listAdminProducts,
  restoreAdminProduct,
  updateAdminProduct,
} from '../src/services/adminProducts.js'
import { listPublicProducts } from '../src/services/publicProducts.js'
import { createLocalD1Database } from './helpers/localD1Database.js'
import { d1QueryLocal } from './helpers/d1Local.js'
import {
  ADMIN_ARCHIVE_PRODUCT_ID,
  ADMIN_IMAGE_ORDER_PRODUCT_ID,
  ADMIN_UPDATE_PRODUCT_ID,
  deleteTestProductsById,
} from './helpers/testDbCleanup.js'

before(() => {
  deleteTestProductsById([ADMIN_ARCHIVE_PRODUCT_ID, ADMIN_UPDATE_PRODUCT_ID, ADMIN_IMAGE_ORDER_PRODUCT_ID])
})

after(() => {
  deleteTestProductsById([ADMIN_ARCHIVE_PRODUCT_ID, ADMIN_UPDATE_PRODUCT_ID, ADMIN_IMAGE_ORDER_PRODUCT_ID])
})

describe('admin product service', { concurrency: 1 }, () => {
  it('rejects invalid validation on create', async () => {
    const db = createLocalD1Database()
    const result = await createAdminProduct(db, {
      id: 'bad',
      name: 'X',
      categorySlug: 'others',
      images: [],
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.errors.id)
  })

  it('creates, deactivates, and reactivates product', async () => {
    deleteTestProductsById([ADMIN_ARCHIVE_PRODUCT_ID])
    const db = createLocalD1Database()
    const created = await createAdminProduct(db, {
      id: ADMIN_ARCHIVE_PRODUCT_ID,
      name: 'Admin Archive Product',
      categorySlug: 'others',
      pack: '',
      description: 'test',
      featured: false,
      stockStatus: 'available',
      active: true,
      sortOrder: 9999,
      images: ['/images/products/test.webp'],
    })
    if (!created.ok) {
      assert.fail(`create failed: ${JSON.stringify(created.errors)}`)
    }
    assert.equal(created.ok, true)

    const archived = await archiveAdminProduct(db, ADMIN_ARCHIVE_PRODUCT_ID)
    if (!archived.ok) {
      assert.fail(`archive failed: ${JSON.stringify(archived)}`)
    }
    const activeRow = d1QueryLocal(
      `SELECT active FROM products WHERE id = '${ADMIN_ARCHIVE_PRODUCT_ID}'`,
    )[0]
    assert.equal(Number(activeRow?.active), 0)
    const listed = await listAdminProducts(db, { includeArchived: false })
    assert.ok(!listed.some((p) => p.id === ADMIN_ARCHIVE_PRODUCT_ID))

    const restored = await restoreAdminProduct(db, ADMIN_ARCHIVE_PRODUCT_ID)
    assert.equal(restored.ok, true)
    if (restored.ok) assert.equal(restored.product.active, true)
  })

  it('persists sellingPriceInr on the product row for admin list display', async () => {
    deleteTestProductsById([ADMIN_UPDATE_PRODUCT_ID])
    const db = createLocalD1Database()
    const created = await createAdminProduct(db, {
      id: ADMIN_UPDATE_PRODUCT_ID,
      name: 'Priced product',
      categorySlug: 'others',
      images: [],
      stockStatus: 'available',
      sellingPriceInr: 163,
    })
    assert.equal(created.ok, true, JSON.stringify(created))
    if (created.ok) {
      assert.equal(created.product?.sellingPriceInr, 163)
    }
    const listed = await listAdminProducts(db, { includeArchived: true })
    const row = listed.find((p) => p.id === ADMIN_UPDATE_PRODUCT_ID)
    assert.equal(row?.sellingPriceInr, 163)
  })

  it('updates fields', async () => {
    deleteTestProductsById([ADMIN_UPDATE_PRODUCT_ID])
    const db = createLocalD1Database()
    const created = await createAdminProduct(db, {
      id: ADMIN_UPDATE_PRODUCT_ID,
      name: 'Before',
      categorySlug: 'others',
      images: [],
      stockStatus: 'available',
    })
    assert.equal(created.ok, true, JSON.stringify(created))
    const updated = await updateAdminProduct(db, ADMIN_UPDATE_PRODUCT_ID, { name: 'After' })
    assert.equal(updated.ok, true)
    if (updated.ok) assert.equal(updated.product?.name, 'After')
    const row = await getAdminProductById(db, ADMIN_UPDATE_PRODUCT_ID)
    assert.equal(row?.name, 'After')
  })

  it('preserves ordered Cloudinary image URLs on update', async () => {
    deleteTestProductsById([ADMIN_IMAGE_ORDER_PRODUCT_ID])
    const db = createLocalD1Database()
    const urls = [
      'https://res.cloudinary.com/demo/image/upload/v1/diwali/products/P903/1.webp',
      'https://res.cloudinary.com/demo/image/upload/v1/diwali/products/P903/2.webp',
    ]
    const created = await createAdminProduct(db, {
      id: ADMIN_IMAGE_ORDER_PRODUCT_ID,
      name: 'Image order',
      categorySlug: 'others',
      images: [urls[0]],
      stockStatus: 'available',
    })
    assert.equal(created.ok, true, JSON.stringify(created))

    const updated = await updateAdminProduct(db, ADMIN_IMAGE_ORDER_PRODUCT_ID, { images: urls })
    assert.equal(updated.ok, true)
    if (updated.ok) {
      assert.deepEqual(updated.product.images, urls)
    }
    const row = await getAdminProductById(db, ADMIN_IMAGE_ORDER_PRODUCT_ID)
    assert.deepEqual(row?.images, urls)

    const publicRows = await listPublicProducts(db, { limit: 100, offset: 0 })
    const pub = publicRows.find((p) => p.id === ADMIN_IMAGE_ORDER_PRODUCT_ID)
    assert.ok(pub)
    assert.deepEqual(pub.images, urls)
    assert.equal(pub.coverImageUrl, urls[0])
  })
})
