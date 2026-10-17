import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildCustomerRequestBodyFromParts,
  buildSubmissionFingerprintFromParts,
  createSubmitGuard,
  idempotencyKeyFromFingerprint,
} from './storefrontCustomerRequestPayload.js'

const sampleCustomer = {
  name: 'Ravi Kumar',
  mobile: '9876543210',
  area: 'Velachery',
  pickupDate: 'November 7, 2026',
  note: 'Evening pickup',
}

const sampleItems = [
  { productId: 'P002', quantity: 2 },
  { productId: 'P001', quantity: 1 },
]

describe('storefrontCustomerRequestPayload (frontend)', () => {
  it('sorts items by productId and normalizes customer fields', () => {
    const body = buildCustomerRequestBodyFromParts(sampleCustomer, sampleItems)
    assert.deepEqual(body.items, [
      { productId: 'P001', quantity: 1 },
      { productId: 'P002', quantity: 2 },
    ])
    assert.equal(body.customer.mobile, '9876543210')
    assert.equal(body.customer.pickupDate, 'November 7, 2026')
  })

  it('uses a stable fingerprint and idempotency key for the same submission', async () => {
    const fp1 = buildSubmissionFingerprintFromParts(sampleCustomer, sampleItems)
    const fp2 = buildSubmissionFingerprintFromParts(sampleCustomer, [...sampleItems].reverse())
    assert.equal(fp1, fp2)

    const key1 = await idempotencyKeyFromFingerprint(fp1)
    const key2 = await idempotencyKeyFromFingerprint(fp1)
    assert.equal(key1, key2)
    assert.ok(key1.startsWith('est_'))
    assert.equal(key1.length, 4 + 48)
  })

  it('changes fingerprint when cart or customer changes', () => {
    const base = buildSubmissionFingerprintFromParts(sampleCustomer, sampleItems)
    const changedQty = buildSubmissionFingerprintFromParts(sampleCustomer, [{ productId: 'P001', quantity: 2 }])
    const changedMobile = buildSubmissionFingerprintFromParts({ ...sampleCustomer, mobile: '9000000000' }, sampleItems)
    assert.notEqual(base, changedQty)
    assert.notEqual(base, changedMobile)
  })

  it('submit guard blocks overlapping submits', () => {
    const guard = createSubmitGuard()
    assert.equal(guard.tryBegin(), true)
    assert.equal(guard.tryBegin(), false)
    guard.end()
    assert.equal(guard.tryBegin(), true)
    guard.end()
  })
})
