import assert from 'node:assert/strict'
import { afterEach, before, describe, it } from 'node:test'
import { installMemoryLocalStorage } from './helpers/memoryLocalStorage.js'
import {
  ESTIMATE_STORAGE_KEY,
  clearEstimateLocalStorage,
  getEstimateDisplayRows,
  loadEstimateFromStorage,
  persistDraftEstimateItems,
  setEstimateCatalogueProducts,
} from '../src/utils/estimateHelpers.js'

const sampleProduct = {
  id: 'P001',
  name: 'Demo cracker',
  category: 'Demo',
  pack: 'Box',
  stockStatus: 'available',
}

describe('public estimate draft (session-only)', () => {
  before(() => {
    installMemoryLocalStorage()
  })

  afterEach(() => {
    clearEstimateLocalStorage()
    setEstimateCatalogueProducts([])
  })

  it('does not persist or reload draft lines from localStorage', () => {
    const saved = persistDraftEstimateItems([{ productId: 'P001', quantity: 2 }])
    assert.deepEqual(saved, [{ productId: 'P001', quantity: 2 }])
    assert.deepEqual(loadEstimateFromStorage(), [])
    assert.equal(localStorage.getItem(ESTIMATE_STORAGE_KEY), null)
  })

  it('clears legacy localStorage draft on clearEstimateLocalStorage', () => {
    localStorage.setItem(
      ESTIMATE_STORAGE_KEY,
      JSON.stringify([{ productId: 'P001', quantity: 2 }]),
    )
    clearEstimateLocalStorage()
    assert.equal(localStorage.getItem(ESTIMATE_STORAGE_KEY), null)
    assert.deepEqual(loadEstimateFromStorage(), [])
  })

  it('builds display rows from in-memory lines after catalogue hydration', () => {
    const draft = persistDraftEstimateItems([{ productId: 'P001', quantity: 2 }])
    setEstimateCatalogueProducts([sampleProduct])
    const rows = getEstimateDisplayRows(draft)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].productId, 'P001')
    assert.equal(rows[0].quantity, 2)
  })
})
