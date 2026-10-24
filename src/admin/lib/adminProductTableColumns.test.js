import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  showAdminProductMappingColumn,
  showAdminProductSellingPriceColumn,
  showAdminProductSensitiveColumns,
  showAdminProductUnitColumn,
} from './adminProductTableColumns.js'

describe('adminProductTableColumns', () => {
  it('shows D1 selling price column for every admin role', () => {
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

})
