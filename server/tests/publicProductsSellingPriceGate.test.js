import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createAdminProduct, listAdminProducts } from '../src/services/adminProducts.js'
import { getPublicProductById, listPublicProducts } from '../src/services/publicProducts.js'
import { createLocalD1Database } from './helpers/localD1Database.js'
import { d1ExecLocal } from './helpers/d1Local.js'
import { deleteTestProductsById } from './helpers/testDbCleanup.js'

const PRICED_ID = 'P907'
const NULL_PRICE_ID = 'P908'
const ZERO_PRICE_ID = 'P909'
const INACTIVE_PRICED_ID = 'P910'

const ALL_IDS = [PRICED_ID, NULL_PRICE_ID, ZERO_PRICE_ID, INACTIVE_PRICED_ID]

before(() => {
  deleteTestProductsById(ALL_IDS)
})

after(() => {
  deleteTestProductsById(ALL_IDS)
})

describe('public catalogue selling price gate', { concurrency: 1 }, () => {
  it('lists and returns by id only for active products with selling_price_paise > 0', async () => {
    const db = createLocalD1Database()

    for (const [id, sellingPriceInr] of [
      [PRICED_ID, 99],
      [NULL_PRICE_ID, undefined],
      [ZERO_PRICE_ID, 1],
      [INACTIVE_PRICED_ID, 120],
    ]) {
      const created = await createAdminProduct(db, {
        id,
        name: `Gate ${id}`,
        categorySlug: 'others',
        images: [],
        stockStatus: 'available',
        ...(sellingPriceInr !== undefined ? { sellingPriceInr } : {}),
      })
      assert.equal(created.ok, true, JSON.stringify(created))
    }

    d1ExecLocal(`UPDATE products SET selling_price_paise = 0 WHERE id = '${ZERO_PRICE_ID}'`)
    d1ExecLocal(`UPDATE products SET active = 0 WHERE id = '${INACTIVE_PRICED_ID}'`)

    const adminRows = await listAdminProducts(db, { includeArchived: true })
    for (const id of ALL_IDS) {
      assert.ok(adminRows.some((p) => p.id === id), `admin should still list ${id}`)
    }

    const publicList = await listPublicProducts(db, { limit: 200, offset: 0 })
    const publicIds = new Set(publicList.map((p) => p.id))
    assert.ok(publicIds.has(PRICED_ID))
    assert.equal(publicIds.has(NULL_PRICE_ID), false)
    assert.equal(publicIds.has(ZERO_PRICE_ID), false)
    assert.equal(publicIds.has(INACTIVE_PRICED_ID), false)

    const priced = await getPublicProductById(db, PRICED_ID)
    assert.ok(priced)
    assert.equal(priced.sellingPricePaise, 9900)

    assert.equal(await getPublicProductById(db, NULL_PRICE_ID), null)
    assert.equal(await getPublicProductById(db, ZERO_PRICE_ID), null)
    assert.equal(await getPublicProductById(db, INACTIVE_PRICED_ID), null)
  })
})
