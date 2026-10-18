import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CUSTOMER_REQUEST_STATUSES,
  TERMINAL_CUSTOMER_REQUEST_STATUSES,
  customerRequestStatusBadgeClass,
  customerRequestStatusLabel,
  isTerminalCustomerRequestStatus,
  isValidCustomerRequestStatus,
} from './customerRequestStatus.js'

describe('customerRequestStatus', () => {
  it('lists the five server-allowed statuses', () => {
    assert.deepEqual(CUSTOMER_REQUEST_STATUSES, [
      'received',
      'reviewing',
      'quoted',
      'closed',
      'void',
    ])
  })

  it('validates status values', () => {
    assert.equal(isValidCustomerRequestStatus('received'), true)
    assert.equal(isValidCustomerRequestStatus('shipped'), false)
  })

  it('marks closed and void as terminal', () => {
    assert.deepEqual(TERMINAL_CUSTOMER_REQUEST_STATUSES, ['closed', 'void'])
    assert.equal(isTerminalCustomerRequestStatus('closed'), true)
    assert.equal(isTerminalCustomerRequestStatus('void'), true)
    assert.equal(isTerminalCustomerRequestStatus('quoted'), false)
    assert.equal(isTerminalCustomerRequestStatus('reviewing'), false)
  })

  it('provides readable labels', () => {
    assert.equal(customerRequestStatusLabel('reviewing'), 'Reviewing')
    assert.equal(customerRequestStatusLabel('unknown'), 'unknown')
  })

  it('assigns badge classes without breaking layout', () => {
    assert.match(customerRequestStatusBadgeClass('received'), /admin-badge/)
    assert.match(customerRequestStatusBadgeClass('closed'), /admin-badge--muted/)
  })
})
