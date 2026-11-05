import assert from 'node:assert/strict'
import { test } from 'node:test'
import { patchRequestPaymentPreferences } from './adminApi.js'

test('payment preferences API sends separate metadata JSON with revision and session credentials', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const body = { status: 'paid', mode: 'offline', receivedAmountPaise: null }
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/admin/customer-requests/request-1/payment-preferences')
    assert.equal(init.method, 'PATCH')
    assert.equal(init.credentials, 'include')
    assert.equal(new Headers(init.headers).get('if-match'), '7')
    assert.match(new Headers(init.headers).get('content-type'), /application\/json/)
    assert.deepEqual(JSON.parse(init.body), body)
    return Response.json({ request: { id: 'request-1', paymentPreferences: body } })
  }
  const result = await patchRequestPaymentPreferences('request-1', body, { revision: 7 })
  assert.equal(result.ok, true)
  assert.deepEqual(result.request.paymentPreferences, body)
  globalThis.fetch = async () => Response.json({ message: 'Request locked.' }, { status: 409 })
  assert.equal((await patchRequestPaymentPreferences('request-1', body)).message, 'Request locked.')
})
