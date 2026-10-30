import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { customerRequestWorkflowAuditRows } from './adminCustomerRequestWorkflowAuditDisplay.js'

describe('customerRequestWorkflowAuditRows', () => {
  it('shows only persisted fields without inferring actors', () => {
    assert.deepEqual(
      customerRequestWorkflowAuditRows({
        status: 'received',
        assignedToEmail: 'owner@example.com',
      }),
      [{ label: 'Assigned to', value: 'owner@example.com' }],
    )
  })

  it('includes assignment and closure audit when stored', () => {
    const rows = customerRequestWorkflowAuditRows({
      status: 'closed',
      assignedToEmail: 'super@example.com',
      assignedByEmail: 'owner@example.com',
      assignedAt: '2026-01-15 10:00:00',
      closedByEmail: 'owner@example.com',
      closedAt: '2026-01-16 12:00:00',
    })
    assert.ok(rows.some((r) => r.label === 'Assigned by'))
    assert.ok(rows.some((r) => r.label === 'Closed by'))
    assert.ok(rows.some((r) => r.label === 'Closed at'))
  })

  it('does not show closed audit for non-closed status', () => {
    const rows = customerRequestWorkflowAuditRows({
      status: 'quoted',
      closedByEmail: 'ghost@example.com',
      closedAt: '2026-01-16 12:00:00',
    })
    assert.equal(rows.some((r) => r.label === 'Closed by'), false)
  })
})
