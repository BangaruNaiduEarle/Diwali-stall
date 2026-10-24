import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  ESTIMATE_STORAGE_KEY,
  loadEstimateFromStorage,
  persistDraftEstimateItems,
} from './estimateHelpers.js'

describe('persistDraftEstimateItems', () => {
  afterEach(() => {
    try {
      localStorage.removeItem(ESTIMATE_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  })

  it('normalizes to empty array without localStorage persistence', () => {
    persistDraftEstimateItems([{ productId: 'P001', quantity: 2 }])
    const cleared = persistDraftEstimateItems([])
    assert.deepEqual(cleared, [])
    assert.deepEqual(loadEstimateFromStorage(), [])
  })

  it('normalizes quantities and dedupes product ids', () => {
    const saved = persistDraftEstimateItems([
      { productId: 'P002', quantity: 1.9 },
      { productId: 'P002', quantity: 3 },
    ])
    assert.equal(saved.length, 1)
    assert.equal(saved[0].quantity, 1)
  })
})
