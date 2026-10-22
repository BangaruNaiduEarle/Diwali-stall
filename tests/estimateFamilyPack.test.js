import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setFamilyPackCatalogue } from '../src/utils/familyPackCatalogue.js'
import {
  buildFamilyPackEstimateSnapshot,
  getFamilyPackEstimateRows,
  normalizeEstimateItem,
  persistDraftEstimateItems,
} from '../src/utils/estimateHelpers.js'
import { buildCustomerRequestBodyFromParts } from '../src/utils/storefrontCustomerRequestPayload.js'
describe('family pack estimate lines', () => {
  it('stores price snapshot and keeps it after catalogue price changes', () => {
    setFamilyPackCatalogue([
      {
        id: 'FP001',
        slug: 'demo',
        name: 'Demo Pack',
        sellingPricePaise: 50_000,
        sellingPriceInr: 500,
      },
    ])

    const snapshot = buildFamilyPackEstimateSnapshot('FP001')
    assert.ok(snapshot)
    const items = persistDraftEstimateItems([
      { familyPackId: 'FP001', quantity: 2, snapshotName: snapshot.snapshotName, snapshotPricePaise: snapshot.snapshotPricePaise },
    ])
    assert.equal(items.length, 1)

    setFamilyPackCatalogue([
      {
        id: 'FP001',
        slug: 'demo',
        name: 'Demo Pack',
        sellingPricePaise: 60_000,
        sellingPriceInr: 600,
      },
    ])

    const rows = getFamilyPackEstimateRows(items)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].unitPricePaise, 50_000)
    assert.equal(rows[0].lineTotalPaise, 100_000)
  })

  it('builds customer request body with family pack line', () => {
    setFamilyPackCatalogue([
      { id: 'FP001', slug: 'demo', name: 'Demo Pack', sellingPricePaise: 25_000, sellingPriceInr: 250 },
    ])
    const items = [
      normalizeEstimateItem({
        familyPackId: 'FP001',
        quantity: 1,
        snapshotName: 'Demo Pack',
        snapshotPricePaise: 25_000,
      }),
    ]
    const body = buildCustomerRequestBodyFromParts({ name: 'A', mobile: '9876543210' }, items)
    assert.equal(body.items[0].familyPackId, 'FP001')

  })

  it('builds mixed cart payload without client prices', () => {
    const items = [
      normalizeEstimateItem({ productId: 'P001', quantity: 2 }),
      normalizeEstimateItem({
        familyPackId: 'FP001',
        quantity: 1,
        snapshotName: 'Demo Pack',
        snapshotPricePaise: 25_000,
      }),
    ]
    const body = buildCustomerRequestBodyFromParts({ name: 'A', mobile: '9876543210' }, items)
    assert.equal(body.items.length, 2)
    assert.ok(body.items.some((l) => l.productId === 'P001'))
    assert.ok(body.items.some((l) => l.familyPackId === 'FP001'))
    for (const line of body.items) {
      assert.equal('snapshotPricePaise' in line, false)
      assert.equal('price' in line, false)
    }
  })
})
