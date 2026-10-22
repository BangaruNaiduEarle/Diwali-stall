import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  createAdminProduct,
  deleteAdminProduct,
  setAdminProductActive,
} from '../src/services/adminProducts.js'
import { createLocalD1Database } from './helpers/localD1Database.js'
import { d1ExecLocal } from './helpers/d1Local.js'
import {
  ADMIN_DELETE_REF_PRODUCT_ID,
  ADMIN_DELETE_SAFE_PRODUCT_ID,
  deleteTestProductsById,
} from './helpers/testDbCleanup.js'

const DELETE_SAFE_ID = ADMIN_DELETE_SAFE_PRODUCT_ID
const DELETE_REF_ID = ADMIN_DELETE_REF_PRODUCT_ID
const DELETE_REF_REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaa0906'

function cleanupDeleteRefFixture() {
  d1ExecLocal(
    `DELETE FROM customer_request_items WHERE request_id = '${DELETE_REF_REQUEST_ID}'`,
  )
  d1ExecLocal(`DELETE FROM customer_requests WHERE id = '${DELETE_REF_REQUEST_ID}'`)
  deleteTestProductsById([DELETE_SAFE_ID, DELETE_REF_ID])
}

before(() => {
  cleanupDeleteRefFixture()
})

after(() => {
  cleanupDeleteRefFixture()
})

describe('admin product delete and active', () => {
  it('deactivates and reactivates without removing the row', async () => {
    deleteTestProductsById([DELETE_SAFE_ID])
    const db = createLocalD1Database()
    const created = await createAdminProduct(db, {
      id: DELETE_SAFE_ID,
      name: 'Toggle product',
      categorySlug: 'others',
      images: [],
      stockStatus: 'available',
      active: true,
    })
    assert.equal(created.ok, true, JSON.stringify(created))

    const off = await setAdminProductActive(db, DELETE_SAFE_ID, false)
    assert.equal(off.ok, true)
    const on = await setAdminProductActive(db, DELETE_SAFE_ID, true)
    assert.equal(on.ok, true)
    if (on.ok) assert.equal(on.product.active, true)
  })

  it('blocks delete when referenced by customer request items', async () => {
    deleteTestProductsById([DELETE_REF_ID])
    const db = createLocalD1Database()
    const created = await createAdminProduct(db, {
      id: DELETE_REF_ID,
      name: 'Referenced product',
      categorySlug: 'others',
      images: [],
      stockStatus: 'available',
    })
    assert.equal(created.ok, true, JSON.stringify(created))

    d1ExecLocal(
      `INSERT INTO customer_requests (id, status, customer_name, customer_phone)
       VALUES ('${DELETE_REF_REQUEST_ID}', 'received', 'Test', '9876543210')`,
    )
    d1ExecLocal(
      `INSERT INTO customer_request_items (request_id, line_number, product_id, product_name, quantity)
       VALUES ('${DELETE_REF_REQUEST_ID}', 1, '${DELETE_REF_ID}', 'Referenced product', 1)`,
    )

    const blocked = await deleteAdminProduct(db, DELETE_REF_ID)
    assert.equal(blocked.ok, false)
    if (!blocked.ok) {
      assert.equal(blocked.status, 409)
      assert.match(String(blocked.message), /customer requests/i)
    }
  })

  it('deletes product when nothing references it', async () => {
    deleteTestProductsById([DELETE_SAFE_ID])
    const db = createLocalD1Database()
    const created = await createAdminProduct(db, {
      id: DELETE_SAFE_ID,
      name: 'Disposable product',
      categorySlug: 'others',
      images: [],
      stockStatus: 'available',
    })
    assert.equal(created.ok, true, JSON.stringify(created))

    const deleted = await deleteAdminProduct(db, DELETE_SAFE_ID)
    assert.equal(deleted.ok, true)
    const row = await db.prepare('SELECT id FROM products WHERE id = ?').bind(DELETE_SAFE_ID).first()
    assert.equal(row, null)
  })
})
