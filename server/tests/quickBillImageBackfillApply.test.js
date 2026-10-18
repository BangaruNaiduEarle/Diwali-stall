import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildApplyTransactionSql,
  buildImageUpdatePlan,
  preflightImagesMatchAudit,
  verifyLocalApplyResult,
  PHASE2A_UNMATCHED_PRODUCT_IDS,
} from '../src/lib/quickBillImageBackfillApply.js'
import { parseImagesJsonArray } from '../src/lib/quickBillImageBackfillAudit.js'

describe('quickBillImageBackfillApply', () => {
  const auditProducts = [
    {
      productId: 'P001',
      wouldChange: true,
      currentImages: ['/images/a.webp'],
      proposedImages: ['https://res.cloudinary.com/dn0puzofw/image/upload/v1/diwali/products/P001/1.webp'],
    },
    {
      productId: 'P006',
      wouldChange: false,
      currentImages: ['/images/unmapped.webp'],
      proposedImages: ['/images/unmapped.webp'],
    },
    {
      productId: 'P099',
      wouldChange: false,
      currentImages: [],
      proposedImages: [],
    },
  ]

  it('aborts preflight when live images drift from audit', () => {
    const dbRows = [
      { id: 'P001', images_json: '["/images/different.webp"]' },
      { id: 'P006', images_json: '["/images/unmapped.webp"]' },
      { id: 'P099', images_json: '[]' },
    ]
    const pre = preflightImagesMatchAudit(dbRows, auditProducts)
    assert.equal(pre.ok, false)
    assert.ok(pre.mismatches.some((m) => m.productId === 'P001' && m.reason === 'images_drift'))
  })

  it('builds optimistic UPDATE transaction SQL', () => {
    const plan = buildImageUpdatePlan(auditProducts)
    assert.equal(plan.length, 1)
    const rowsById = new Map([
      ['P001', { id: 'P001', images_json: '["/images/a.webp"]' }],
    ])
    const sql = buildApplyTransactionSql(rowsById, plan)
    assert.match(sql, /UPDATE products SET images_json/)
    assert.match(sql, /WHERE id = 'P001' AND images_json = '\["\/images\/a.webp"\]'/)
    assert.match(sql, /res\.cloudinary\.com/)
  })

  it('verifies apply result and preserves unmatched product ids', () => {
    assert.deepEqual(PHASE2A_UNMATCHED_PRODUCT_IDS, ['P006', 'P010', 'P063', 'P124'])
    const beforeRows = [
      {
        id: 'P001',
        name: 'A',
        pack: '',
        description: '',
        featured: 0,
        stock_status: 'available',
        active: 1,
        sort_order: 1,
        company: null,
        selling_price_paise: null,
        category_slug: 'gift-boxes',
        created_at: '2026-01-01',
        images_json: '["/images/a.webp"]',
      },
      {
        id: 'P006',
        name: 'U',
        pack: '',
        description: '',
        featured: 0,
        stock_status: 'available',
        active: 1,
        sort_order: 2,
        company: null,
        selling_price_paise: null,
        category_slug: 'gift-boxes',
        created_at: '2026-01-01',
        images_json: '["/images/unmapped.webp"]',
      },
    ]
    const cloudUrl = 'https://res.cloudinary.com/dn0puzofw/image/upload/v1/diwali/products/P001/1.webp'
    const afterRows = [
      { ...beforeRows[0], images_json: JSON.stringify([cloudUrl]) },
      beforeRows[1],
    ]
    const pathChanges = [{ productId: 'P001', slotIndex: 0, before: '/images/a.webp', after: cloudUrl }]
    const updatePlan = buildImageUpdatePlan(auditProducts.slice(0, 2))
    const verify = verifyLocalApplyResult({
      beforeRows,
      afterRows,
      auditProducts: auditProducts.slice(0, 2),
      pathChanges,
      updatePlan,
    })
    assert.equal(verify.ok, true)
    assert.equal(verify.cloudinarySlots, 1)
    assert.equal(verify.replacementsVerified, 1)
    assert.equal(parseImagesJsonArray(afterRows[1].images_json)[0], '/images/unmapped.webp')
  })
})
