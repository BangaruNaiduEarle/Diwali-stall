import assert from 'node:assert/strict'
import { test } from 'node:test'
import { patchAdminCustomerRequestAdjustBill, previewAdminCustomerRequestAdjustBill, patchAdminCustomerRequestAssign, patchAdminCustomerRequestFinalize, patchQuotationCustomerAgreedAmount, checkoutQuickBill } from './adminApi.js'

test('adjustment, assignment, finalize and agreed-amount APIs send the displayed revision unchanged', async t => {
  const original = globalThis.fetch, calls = []
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return Response.json({ request: { id: 'r1', revision: 8 }, quotation: { id: 'q1', requestRevision: 8 }, preview: { totalPaise: 10000 } })
  }
  const body = { items: [{ productId: 'P001', quantity: 3 }] }
  await patchAdminCustomerRequestAdjustBill('r1', body, { revision: 7 })
  await previewAdminCustomerRequestAdjustBill('r1', body, { revision: 7 })
  await patchAdminCustomerRequestAssign('r1', { assigneeUserId: 'super' }, { revision: 7 })
  await patchAdminCustomerRequestFinalize('r1', { revision: 7 })
  await patchQuotationCustomerAgreedAmount('r1', { acceptedAmountInr: '100' }, { revision: 7 })
  assert.ok(calls.every(call => new Headers(call.init.headers).get('If-Match') === '7'))
  assert.deepEqual(JSON.parse(calls[0].init.body), body)
})

test('stale adjustment responses are surfaced without an automatic overwrite/retry', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let calls = 0
  globalThis.fetch = async () => { calls++; return Response.json({ error: 'revision_conflict', message: 'Request changed.' }, { status: 409 }) }
  const result = await patchAdminCustomerRequestAdjustBill('r1', { items: [] }, { revision: 4 })
  assert.equal(result.ok, false); assert.equal(result.status, 409); assert.equal(calls, 1)
})

test('checkout sends the recipient in the same idempotent request and returns the assignment', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let calls = 0
  globalThis.fetch = async (url, init) => {
    calls++
    assert.equal(JSON.parse(init.body).assigneeUserId, 'super')
    assert.equal(new Headers(init.headers).get('Idempotency-Key'), 'stable-key')
    return Response.json({ request: { id: 'r1', assignedToEmail: 'super@test.com', revision: 8 }, quotation: { id: 'q1', totalPaise: 10000 }, idempotentReplay: true })
  }
  const result = await checkoutQuickBill({ items: [], assigneeUserId: 'super' }, { idempotencyKey: 'stable-key' })
  assert.equal(result.request.assignedToEmail, 'super@test.com'); assert.equal(result.idempotentReplay, true); assert.equal(calls, 1)
})
