import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  showAdminProductCatalogueReferenceColumn,
  showAdminProductMappingColumn,
  showAdminProductSellingPriceColumn,
  showAdminProductSensitiveColumns,
  showAdminProductUnitColumn,
} from './adminProductTableColumns.js'

describe('adminProductTableColumns', () => {
  it('shows catalogue selling price column for every admin role', () => {
    assert.equal(showAdminProductSellingPriceColumn(), true)
  })

  it('restricts purchase, unit, and mapping to owner and super_admin', () => {
    for (const role of ['owner', 'super_admin']) {
      assert.equal(showAdminProductSensitiveColumns(role), true)
      assert.equal(showAdminProductUnitColumn(role), true)
      assert.equal(showAdminProductMappingColumn(role), true)
    }
    for (const role of ['admin', undefined, 'guest']) {
      assert.equal(showAdminProductSensitiveColumns(role), false)
      assert.equal(showAdminProductUnitColumn(role), false)
      assert.equal(showAdminProductMappingColumn(role), false)
    }
  })

  it('shows Catalogue Reference table column for owner only', () => {
    assert.equal(showAdminProductCatalogueReferenceColumn('owner'), true)
    assert.equal(showAdminProductCatalogueReferenceColumn('super_admin'), false)
    assert.equal(showAdminProductCatalogueReferenceColumn('admin'), false)
    assert.equal(showAdminProductCatalogueReferenceColumn(undefined), false)
  })
})
