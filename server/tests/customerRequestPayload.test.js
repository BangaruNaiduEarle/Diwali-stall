import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { submitPublicCustomerRequest } from '../../src/api/publicCustomerRequests.js'
import {
  buildCustomerRequestBodyFromParts,
  buildSubmissionFingerprintFromParts,
  createSubmitGuard,
  idempotencyKeyFromFingerprint,
} from '../src/lib/storefrontCustomerRequestPayload.js'
import { normalizeIdempotencyKey, validateCustomerRequestBody } from '../src/lib/customerRequestValidation.js'

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

describe('storefront customer request payload', () => {
  it('maps fields to API body accepted by server validation', () => {
    const body = buildCustomerRequestBodyFromParts(sampleCustomer, sampleItems)
    assert.deepEqual(body.items, [
      { productId: 'P001', quantity: 1 },
      { productId: 'P002', quantity: 2 },
    ])
    assert.equal(body.customer.pickupDate, 'November 7, 2026')

    const validated = validateCustomerRequestBody(body)
    assert.equal(validated.ok, true)
  })

  it('uses a stable fingerprint and idempotency key for the same submission', async () => {
    const fp1 = buildSubmissionFingerprintFromParts(sampleCustomer, sampleItems)
    const fp2 = buildSubmissionFingerprintFromParts(sampleCustomer, [...sampleItems].reverse())
    assert.equal(fp1, fp2)

    const key1 = await idempotencyKeyFromFingerprint(fp1)
    const key2 = await idempotencyKeyFromFingerprint(fp1)
    assert.equal(key1, key2)
    assert.ok(normalizeIdempotencyKey(key1))
    assert.ok(key1.startsWith('est_'))
  })

  it('changes idempotency fingerprint when cart or customer changes', () => {
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

describe('submitPublicCustomerRequest client', () => {
  it('returns success on 201 and idempotent replay on 200', async () => {
    const fetchMock = async (_url, init) => {
      const headers = new Headers(init?.headers)
      const lastKey = headers.get('Idempotency-Key') ?? ''
      const body = JSON.parse(String(init?.body))
      assert.equal(body.customer.mobile, '9876543210')
      if (lastKey === 'est_replay') {
        return new Response(JSON.stringify({ request: { id: 'cr-test' }, idempotentReplay: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ request: { id: 'cr-new' }, idempotentReplay: false }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body = buildCustomerRequestBodyFromParts(sampleCustomer, sampleItems)
    const created = await submitPublicCustomerRequest(body, 'est_new', fetchMock)
    assert.equal(created.ok, true)
    if (created.ok) {
      assert.equal(created.status, 201)
      assert.equal(created.idempotentReplay, false)
    }

    const replay = await submitPublicCustomerRequest(body, 'est_replay', fetchMock)
    assert.equal(replay.ok, true)
    if (replay.ok) {
      assert.equal(replay.status, 200)
      assert.equal(replay.idempotentReplay, true)
    }
  })

  it('surfaces API and network failures without success shape', async () => {
    const failFetch = async () =>
      new Response(JSON.stringify({ error: 'validation_error', message: 'Bad request.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })

    const body = buildCustomerRequestBodyFromParts(sampleCustomer, sampleItems)
    const result = await submitPublicCustomerRequest(body, 'est_fail', failFetch)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.status, 400)
      assert.match(result.message, /Bad request/)
    }

    const networkFetch = async () => {
      throw new Error('offline')
    }
    const offline = await submitPublicCustomerRequest(body, 'est_fail', networkFetch)
    assert.equal(offline.ok, false)
    if (!offline.ok) {
      assert.equal(offline.error, 'network_error')
    }
  })
})
