import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workflowDb } from './helpers/workflowSqlite.js'
import { attachAdminRequestContext } from '../src/middleware/requireAdmin.js'
import { customerRequestDb, validateTransactionCatalogueReferences } from '../src/lib/adminCustomerRequestScope.js'
import { previewQuickBill } from '../src/services/adminQuickBill.js'
import { listAdminProductsPage } from '../src/services/adminProducts.js'
import { billPurchaseSummary } from '../src/lib/billPurchaseSummary.js'

test('performance: bounded cart, ownership, purchase reads and unchanged flex search', async t => {
  const db = await workflowDb(t)
  await db.script(Array.from({ length: 20 }, (_, i) => `INSERT INTO products
    (id,category_slug,name,company,selling_price_paise,final_price_paise,pieces_per_pack,allow_loose_sale,season_id,location_id)
    VALUES('P${100 + i}','cat-a','Flower Pot ${i}','Maker',10001,8000,3,1,'season-2026','loc-a');
    INSERT INTO product_purchase_rates(product_id,unit_rate_paise,effective_from,season_id,location_id)
    VALUES('P${100 + i}',5000,'2026-01-01','season-2026','loc-a');`).join('\n'))
  const attached = await attachAdminRequestContext(new Request('https://example.test/api/admin/quick-bill/preview', {
    headers: { 'X-Admin-Season-Id': 'season-2026', 'X-Admin-Location-Id': 'loc-a' },
  }), db, { userId: 'owner', email: 'owner@test.com' }, { ADMIN_LOCATION_MODE: true })
  assert.equal(attached.ok, true)
  const context = attached.adminContext
  const calls = [], prepare = db.prepare.bind(db)
  db.prepare = sql => { calls.push(sql); return prepare(sql) }
  const scoped = customerRequestDb(db, 'season-2026', context)
  const items = Array.from({ length: 20 }, (_, i) => ({ productId: `P${100 + i}`, quantity: 1, unitType: 'box' }))
  items.push({ productId: 'P100', quantity: 2, unitType: 'piece' })
  const preview = await previewQuickBill(scoped, items, { seasonId: 'season-2026' })
  assert.equal(preview.ok, true)
  assert.equal(preview.preview.totalPaise, 20 * 10001 + 2 * 3333)
  assert.equal(calls.length, 1)
  await validateTransactionCatalogueReferences(scoped, items)
  const validated = calls.length
  await validateTransactionCatalogueReferences(scoped, items)
  assert.equal(calls.length, validated)
  await assert.rejects(validateTransactionCatalogueReferences(scoped, [{ productId: 'P002' }]), { code: 'request_ownership_mismatch' })
  const foreign = await previewQuickBill(scoped, [{ productId: 'P002', quantity: 1 }], { seasonId: 'season-2026' })
  assert.equal(foreign.ok, false)
  const before = calls.length
  const summary = await billPurchaseSummary(scoped, { id: 'missing', items: items.map(item => ({ ...item, packSnapshot: { piecesPerPack: 3 } })) }, { totalPaise: 1 }, 'owner', 'season-2026')
  assert.equal(calls.length - before, 2)
  assert.deepEqual(summary, { basis: 'current_purchase_estimate', purchaseSubtotalPaise: 20 * 5000 + 2 * 1666 })
  const missing = await billPurchaseSummary(scoped, { id: 'missing', items: [{ productId: 'P001', quantity: 1 }] }, {}, 'owner', 'season-2026')
  assert.equal(missing.purchaseSubtotalPaise, null)
  const searchStart = calls.length
  const page = await listAdminProductsPage(db, { seasonId: 'season-2026', context, flexSearch: true,
    q: 'maker pot flower', categorySlug: 'cat-a', activeFilter: 'active', limit: 12, offset: 0 })
  assert.equal(page.total, 20)
  assert.deepEqual(page.products.map(row => row.id), items.slice(0, 12).map(row => row.productId))
  assert.equal(calls.length - searchStart, 2)
  assert.match(calls[searchStart], /^SELECT p.id, p.name, p.company /)
  assert.ok(!calls[searchStart].includes('p.description'))
  assert.ok(page.products.every(row => row.stockStatus === 'available' && row.hasSellingPrice))
})
