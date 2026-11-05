import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildApplyPhaseSql,
  buildCategoryUpsertSql,
  buildRollbackSql,
  planCategorySync,
  verifyReplaceAgainstLocal,
} from './replace-products-local-to-remote.mjs'

describe('replace-products-local-to-remote SQL planners', () => {
  it('buildCategoryUpsertSql uses ON CONFLICT and preserves slug PK', () => {
    const sql = buildCategoryUpsertSql([
      { slug: 'pencil', label: 'Pencil', sort_order: 11, created_at: '2026-01-01', updated_at: '2026-01-02' },
    ]).join('\n')
    assert.match(sql, /INSERT INTO categories/)
    assert.match(sql, /'pencil'/)
    assert.match(sql, /ON CONFLICT\(slug\) DO UPDATE SET/)
    assert.match(sql, /sort_order = excluded\.sort_order/)
    assert.doesNotMatch(sql, /DELETE FROM categories/)
  })

  it('planCategorySync detects inserts, updates, and preserved remote-only slugs', () => {
    const local = [
      { slug: 'others', label: 'Others', sort_order: 10 },
      { slug: 'pencil', label: 'Pencil', sort_order: 11 },
      { slug: 'tim', label: 'Tim', sort_order: 12 },
      { slug: 'matches', label: 'Matches', sort_order: 13 },
    ]
    const remote = [
      { slug: 'others', label: 'Others', sort_order: 10 },
      { slug: 'legacy-only', label: 'Legacy', sort_order: 99 },
    ]
    const plan = planCategorySync(local, remote)
    assert.deepEqual(
      plan.insertOnRemote.map((c) => c.slug).sort(),
      ['matches', 'pencil', 'tim'],
    )
    assert.equal(plan.updateFromLocal.length, 0)
    assert.deepEqual(plan.preservedRemoteOnly, ['legacy-only'])
    assert.equal(plan.upsertCount, 4)
  })

  it('buildRollbackSql restores products before categories and deletes inserted slugs', () => {
    const sql = buildRollbackSql(
      [{ slug: 'others', label: 'Others', sort_order: 10, created_at: 'a', updated_at: 'a' }],
      [{ id: 'P001', category_slug: 'others', name: 'X', stock_status: 'available', active: 1, sort_order: 0 }],
      [],
      ['pencil', 'tim'],
    )
    const prodIdx = sql.indexOf('INSERT INTO products')
    const catIdx = sql.indexOf('INSERT INTO categories')
    const delIdx = sql.indexOf('DELETE FROM categories')
    assert.ok(prodIdx >= 0 && catIdx > prodIdx && delIdx > catIdx)
    assert.match(sql, /'pencil'/)
    assert.match(sql, /NOT EXISTS \(SELECT 1 FROM products/)
    assert.match(sql, /created_at = excluded\.created_at/)
  })

  it('buildRollbackSql removes apply-inserted products and restores rate rows with effective_to', () => {
    const sql = buildRollbackSql(
      [],
      [{ id: 'P001', category_slug: 'others', name: 'X', stock_status: 'available', active: 1, sort_order: 0, created_at: 'c1', updated_at: 'u1' }],
      [
        {
          id: 9,
          product_id: 'P001',
          unit_rate_paise: 50,
          effective_from: '2026-01-01',
          effective_to: null,
          notes: 'n',
          created_at: 'c1',
          updated_at: 'u1',
        },
      ],
      [],
      ['P777'],
    )
    assert.match(sql, /DELETE FROM product_purchase_rates WHERE product_id IN \(\'P777\'\)/)
    assert.match(sql, /DELETE FROM products WHERE id IN \(\'P777\'\)/)
    assert.match(sql, /INSERT INTO product_purchase_rates \(id, product_id, unit_rate_paise, effective_from, effective_to/)
    assert.match(sql, /'2026-01-01',\s*\n\s*NULL,\s*\n\s*'n'/)
  })

  it('verifyReplaceAgainstLocal checks categories, products, and retained count', () => {
    const localCategories = [{ slug: 'pencil', label: 'Pencil', sort_order: 14 }]
    const localProducts = [
      {
        id: 'P001',
        category_slug: 'pencil',
        name: 'A',
        pack: '',
        description: '',
        featured: 0,
        stock_status: 'available',
        active: 1,
        sort_order: 0,
        images_json: '[]',
        company: null,
        selling_price_paise: 100,
      },
    ]
    const ok = verifyReplaceAgainstLocal({
      localCategories,
      localProducts,
      localRateMap: new Map([['P001', { unit_rate_paise: 50 }]]),
      preservedRemoteOnlySlugs: [],
      retainedProductIds: ['P999'],
      remoteCategories: [{ slug: 'pencil', label: 'Pencil', sort_order: 14 }],
      remoteProducts: [
        ...localProducts,
        { id: 'P999', category_slug: 'others', name: 'Old', stock_status: 'available', active: 1, sort_order: 1 },
      ],
      remoteCurrentRates: new Map([['P001', 50]]),
    })
    assert.equal(ok.ok, true)

    const priceMismatch = verifyReplaceAgainstLocal({
      localCategories,
      localProducts,
      localRateMap: new Map(),
      preservedRemoteOnlySlugs: [],
      retainedProductIds: [],
      remoteCategories: [{ slug: 'pencil', label: 'Pencil', sort_order: 14 }],
      remoteProducts: [{ ...localProducts[0], selling_price_paise: '100' }],
      remoteCurrentRates: new Map(),
    })
    assert.equal(priceMismatch.ok, true)

    const bad = verifyReplaceAgainstLocal({
      localCategories,
      localProducts,
      localRateMap: new Map(),
      preservedRemoteOnlySlugs: [],
      retainedProductIds: [],
      remoteCategories: [],
      remoteProducts: [],
      remoteCurrentRates: new Map(),
    })
    assert.equal(bad.ok, false)
    assert.ok(bad.problems.some((p) => p.includes('category COUNT')))
    assert.ok(bad.problems.some((p) => p.includes('P001')))
  })

  it('buildApplyPhaseSql orders categories before products', () => {
    const phases = buildApplyPhaseSql(
      [{ slug: 'pencil', label: 'Pencil', sort_order: 1 }],
      [{ id: 'P001', category_slug: 'pencil', name: 'X', stock_status: 'available', active: 1, sort_order: 0 }],
      new Map(),
      [],
    )
    const catIdx = phases.combined.indexOf('-- Phase 1: categories')
    const prodIdx = phases.combined.indexOf('-- Phase 2: products')
    const ratesIdx = phases.combined.indexOf('-- Phase 3: purchase rates')
    const delIdx = phases.combined.indexOf('-- Phase 4: deletes')
    assert.ok(catIdx >= 0 && prodIdx > catIdx && ratesIdx > prodIdx && delIdx > ratesIdx)
    assert.match(phases.categories, /Phase 1: category upserts/)
    assert.match(phases.products, /Phase 2: product upserts/)
  })
})
