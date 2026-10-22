import assert from 'node:assert/strict'
import { afterEach, before, describe, it } from 'node:test'
import { installMemoryLocalStorage } from './helpers/memoryLocalStorage.js'
import {
  ESTIMATE_STORAGE_KEY,
  getEstimateDisplayRows,
  getEstimateProducts,
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

describe('public estimate draft persistence', () => {
  before(() => {
    installMemoryLocalStorage()
  })

  afterEach(() => {
    try {
      localStorage.removeItem(ESTIMATE_STORAGE_KEY)
    } catch {
      /* ignore */
    }
    setEstimateCatalogueProducts([])
  })

  it('persists added products and reloads them from localStorage', () => {
    const saved = persistDraftEstimateItems([{ productId: 'P001', quantity: 2 }])
    assert.deepEqual(saved, [{ productId: 'P001', quantity: 2 }])
    assert.deepEqual(loadEstimateFromStorage(), saved)
  })

  it('persists quantity updates and removals', () => {
    persistDraftEstimateItems([{ productId: 'P001', quantity: 1 }, { productId: 'P002', quantity: 3 }])
    persistDraftEstimateItems([{ productId: 'P001', quantity: 4 }])
    assert.deepEqual(loadEstimateFromStorage(), [{ productId: 'P001', quantity: 4 }])
  })

  it('restores display rows after catalogue hydration (refresh simulation)', () => {
    persistDraftEstimateItems([{ productId: 'P001', quantity: 2 }])
    setEstimateCatalogueProducts([])
    assert.equal(getEstimateDisplayRows(loadEstimateFromStorage()).length, 0)

    setEstimateCatalogueProducts([sampleProduct])
    const rows = getEstimateDisplayRows(loadEstimateFromStorage())
    assert.equal(rows.length, 1)
    assert.equal(rows[0].productId, 'P001')
    assert.equal(rows[0].quantity, 2)
  })

  it('clears persisted draft after a successful submit handoff', () => {
    const draft = [{ productId: 'P001', quantity: 2 }]
    persistDraftEstimateItems(draft)
    persistDraftEstimateItems([])
    assert.deepEqual(loadEstimateFromStorage(), [])
  })

  it('keeps persisted draft when submit fails before clearing', () => {
    const draft = [{ productId: 'P001', quantity: 2 }]
    persistDraftEstimateItems(draft)
    assert.deepEqual(loadEstimateFromStorage(), draft)
  })

  it('clears persisted draft only when explicitly saved empty', () => {
    persistDraftEstimateItems([{ productId: 'P001', quantity: 1 }])
    persistDraftEstimateItems([])
    assert.deepEqual(loadEstimateFromStorage(), [])
  })

  it('drops invalid storage entries but keeps valid product lines', () => {
    localStorage.setItem(
      ESTIMATE_STORAGE_KEY,
      JSON.stringify([
        { productId: 'P001', quantity: 2 },
        { productId: 404, quantity: 1 },
        { productId: 'P002', quantity: 0 },
        null,
      ]),
    )
    assert.deepEqual(loadEstimateFromStorage(), [{ productId: 'P001', quantity: 2 }])
  })

  it('keeps draft lines when catalogue no longer lists the product', () => {
    persistDraftEstimateItems([{ productId: 'P999', quantity: 1 }])
    setEstimateCatalogueProducts([sampleProduct])
    assert.equal(getEstimateProducts(loadEstimateFromStorage()).length, 0)
    assert.deepEqual(loadEstimateFromStorage(), [{ productId: 'P999', quantity: 1 }])
  })

  it('keeps draft in storage when product is sold out but hides it from display rows', () => {
    persistDraftEstimateItems([{ productId: 'P001', quantity: 1 }])
    setEstimateCatalogueProducts([{ ...sampleProduct, stockStatus: 'soldout' }])
    assert.equal(getEstimateProducts(loadEstimateFromStorage()).length, 0)
    assert.deepEqual(loadEstimateFromStorage(), [{ productId: 'P001', quantity: 1 }])
  })
})
