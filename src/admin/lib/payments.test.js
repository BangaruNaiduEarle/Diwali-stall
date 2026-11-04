import assert from 'node:assert/strict'
import { test } from 'node:test'
import { paymentPayload, paymentSummaryDisplay, formatPaymentPaise, createPaymentOperationKeys } from './payments.js'

test('payment amount conversion uses exact integer paise and rejects extra decimals', () => {
  assert.equal(paymentPayload({ amountInr: '12.34' }).body.amountPaise, 1234)
  assert.equal(paymentPayload({ amountInr: '0.01' }).body.amountPaise, 1)
  assert.equal(paymentPayload({ amountInr: '90071992547409.91' }).body.amountPaise, Number.MAX_SAFE_INTEGER)
  for (const amountInr of ['1.001', '-1', '0', '1e3', 'Infinity', '90071992547409.92']) assert.equal(paymentPayload({ amountInr }).ok, false)
  assert.equal(formatPaymentPaise(1234), '₹12.34')
  assert.equal(formatPaymentPaise(Number.MAX_SAFE_INTEGER).endsWith('.91'), true)
  assert.equal(formatPaymentPaise(null), '—')
})

test('mode, method and hold actions remain distinct in payment payloads', () => {
  const data = paymentPayload({ amountInr: '10', recordingMode: 'OFFLINE', paymentMethod: 'UPI', reference: ' UPI-1 ', occurredAt: '2026-11-01T12:00:00Z' })
  assert.equal(data.ok, true); assert.equal(data.body.paymentMethod, 'UPI'); assert.equal(data.body.recordingMode, 'OFFLINE'); assert.equal(Object.hasOwn(data.body, 'paymentStatus'), false)
  assert.deepEqual(paymentPayload({ entryType: 'HOLD', paymentMethod: 'CARD', amountInr: '999', reference: 'hidden-reference' }).body, { entryType: 'HOLD', amountPaise: 0, recordingMode: 'ONLINE' })
  assert.equal(paymentPayload({ amountInr: '10', recordingMode: 'OFFLINE' }).ok, false)
  assert.equal(paymentPayload({ amountInr: '10', paymentMethod: 'BANK' }).ok, false)
})

test('summary distinguishes payment hold, received and outstanding amounts without private pricing', () => {
  const display = paymentSummaryDisplay({ paymentStatus: 'HOLD', amountDuePaise: 10000, receivedPaise: 2500, outstandingPaise: 7500 })
  assert.deepEqual(display, { status: 'HOLD', label: 'Payment hold', due: '₹100.00', received: '₹25.00', outstanding: '₹75.00' })
  assert.equal(paymentSummaryDisplay(null), null)
})

test('operation IDs survive ambiguous retries and revision refreshes but rotate on changed intent/scope or confirmed completion', () => {
  let next = 0
  const keys = createPaymentOperationKeys(() => String(++next)), payload = paymentPayload({ amountInr: '10' }).body
  const first = keys.forEntry(payload, 'scope-a:request-1')
  assert.equal(keys.forEntry(payload, 'scope-a:request-1'), first)
  assert.notEqual(keys.forEntry({ ...payload, amountPaise: 1001 }, 'scope-a:request-1'), first)
  const changedScope = keys.forEntry(payload, 'scope-b:request-1')
  assert.notEqual(changedScope, first)
  keys.complete(); assert.notEqual(keys.forEntry(payload, 'scope-b:request-1'), changedScope)
})
