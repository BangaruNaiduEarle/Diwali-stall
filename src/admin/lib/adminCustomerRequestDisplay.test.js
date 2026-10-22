import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatAdminPublicReference } from './adminCustomerRequestDisplay.js'
import {
  mapAdminCustomerRequestDetail,
  mapAdminCustomerRequestListRow,
} from '../../../server/src/services/adminCustomerRequests.js'

describe('formatAdminPublicReference', () => {
  it('shows em dash for missing values', () => {
    assert.equal(formatAdminPublicReference(null), '—')
    assert.equal(formatAdminPublicReference(''), '—')
    assert.equal(formatAdminPublicReference('DWL-23456789'), 'DWL-23456789')
  })
})

describe('admin customer request publicReference mapping', () => {
  it('maps null public_reference to null publicReference', () => {
    const list = mapAdminCustomerRequestListRow({
      id: 'cr-abc',
      public_reference: null,
      status: 'received',
      source: 'web',
      customer_name: 'A',
      customer_phone: '9876543210',
      customer_area: null,
      created_at: '2026-01-01',
      item_count: 1,
    })
    assert.equal(list.publicReference, null)

    const detail = mapAdminCustomerRequestDetail(
      {
        id: 'cr-abc',
        public_reference: null,
        status: 'received',
        source: 'web',
        customer_name: 'A',
        customer_phone: '9876543210',
        customer_area: null,
        pickup_preference: null,
        customer_note: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
      [],
    )
    assert.equal(detail.publicReference, null)
  })

  it('maps stored public_reference to publicReference', () => {
    const list = mapAdminCustomerRequestListRow({
      id: 'cr-abc',
      public_reference: 'DWL-ABCDEFGH',
      status: 'received',
      source: 'web',
      customer_name: 'A',
      customer_phone: '9876543210',
      customer_area: null,
      created_at: '2026-01-01',
      item_count: 2,
    })
    assert.equal(list.publicReference, 'DWL-ABCDEFGH')
  })
})
