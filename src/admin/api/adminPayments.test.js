import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchRequestPayments, recordRequestPayment } from './adminPayments.js'

test('payment API forwards operation ID, method/mode and revision without amount coercion', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const body = { operationId: 'operation-123', amountPaise: 1234, recordingMode: 'ONLINE', paymentMethod: 'CASH' }
  globalThis.fetch = async (url, init) => {
    assert.ok(url.includes('/customer-requests/r1/payments'))
    assert.equal(new Headers(init.headers).get('If-Match'), '7')
    assert.ok(new Headers(init.headers).get('X-Device-Id').startsWith('browser-'))
    assert.deepEqual(JSON.parse(init.body), body)
    return Response.json({ ok: true, entry: { paymentId: 'p1' }, summary: { receivedPaise: 1234 } })
  }
  assert.equal((await recordRequestPayment('r1', body, { revision: 7 })).entry.paymentId, 'p1')
})

test('ambiguous payment failures are surfaced once; caller can retry with the same operation ID', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const ids = []
  globalThis.fetch = async (url, init) => {
    ids.push(JSON.parse(init.body).operationId)
    if (ids.length === 1) throw Error('network lost')
    return Response.json({ ok: true, idempotentReplay: true, entry: { paymentId: 'original' }, summary: {} })
  }
  const body = { operationId: 'stable-operation', amountPaise: 1000 }
  assert.equal((await recordRequestPayment('r1', body, { revision: 7 })).ok, false)
  assert.equal(ids.length, 1)
  assert.equal((await recordRequestPayment('r1', body, { revision: 8 })).idempotentReplay, true)
  assert.deepEqual(ids, ['stable-operation', 'stable-operation'])
})

test('payment history uses a bounded cursor and preserves server summary/status', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async url => {
    assert.ok(url.includes('afterSequence=20')); assert.ok(url.includes('limit=50'))
    return Response.json({ ok: true, summary: { paymentStatus: 'PARTIAL', outstandingPaise: 1000 }, entries: [] })
  }
  assert.equal((await fetchRequestPayments('r1', { afterSequence: 20 })).summary.paymentStatus, 'PARTIAL')
})
