import assert from 'node:assert/strict'
import { test } from 'node:test'
import { customerErrors, posSummary } from './posPresentation.js'
import { downloadProductPhotos } from './productPhotos.js'

const item = { productId: 'P301', quantity: 1, unitType: 'box' }
const product = { id: 'P301', name: 'Stall B product', selling_price_paise: 55000 }
const baseDraft = { draftId: 'draft-b', body: { customer: {}, items: [item] }, discountInr: '' }
const row = (kind, body, state, revision, order = 1) => ({ draftId: 'draft-b', order, state,
  payload: { kind, body }, acknowledgement: state === 'synced' ? { revision } : null })

test('POS balances distinguish queued money from the server snapshot and never double-count acknowledged payments', () => {
  const creation = row('CREATE', { items: [item], acceptedAmountPaise: 55000 }, 'synced', 0)
  const payment = row('PAYMENT', { entryType: 'PAYMENT', amountPaise: 20000 }, 'synced', 2, 2)
  const draft = { ...baseDraft, lastAcknowledgement: { revision: 2 },
    serverSnapshot: { request: { revision: 2, items: [item] }, acceptedAmountPaise: 55000,
      paymentSummary: { receivedPaise: 20000, onHold: false } } }
  let result = posSummary(draft, [product], [payment,creation])
  assert.equal(result.received, 20000); assert.equal(result.outstanding, 35000); assert.equal(result.confirmed, true)
  assert.equal(posSummary({ ...draft, body: { ...draft.body, items: [{ ...item, quantity: 2 }] } }, [product], [payment,creation]).confirmed, false, 'unqueued local edits are not server-confirmed')
  const pending = row('PAYMENT', { entryType: 'PAYMENT', amountPaise: 10000 }, 'pending', null, 3)
  result = posSummary(draft, [product], [pending,payment,creation])
  assert.equal(result.received, 30000); assert.equal(result.outstanding, 25000); assert.equal(result.confirmed, false)
  result = posSummary(draft, [product], [{ ...pending, state: 'failed' },payment,creation])
  assert.equal(result.received, 20000); assert.equal(result.failed, true)
})

test('POS requires item changes to be saved and uses the latest queued agreement in stored order', () => {
  const creation = row('CREATE', { items: [item], acceptedAmountPaise: 55000 }, 'pending', null, 1)
  const agreement = row('AGREEMENT', { acceptedAmountPaise: 50000 }, 'pending', null, 2)
  const result = posSummary(baseDraft, [product], [agreement,creation])
  assert.equal(result.amount, 50000); assert.equal(result.itemsSaved, true)
  assert.equal(posSummary({ ...baseDraft, body: { items: [{ ...item, quantity: 2 }] } }, [product], [creation]).itemsSaved, false)
  assert.equal(posSummary({ ...baseDraft, discountInr: '10' }, [product], [creation]).itemsSaved, false)
  assert.ok(customerErrors({ name: 'R', mobile: '123' }).mobile)
  assert.deepEqual(customerErrors({ name: 'Rajesh', mobile: '9876543210' }), {})
})

test('optional photo caching stores only bounded images and tolerates missing, oversized and non-image responses', async () => {
  const calls = []
  const photos = await downloadProductPhotos({ good: '/images/good.png', missing: '/images/missing.png', huge: '/images/huge.png', invalid: 'javascript:alert(1)' }, async url => {
    calls.push(url)
    if (url.includes('missing')) return new Response('not found', { status: 404 })
    if (url.includes('huge')) return new Response('oversized', { headers: { 'Content-Type': 'image/png', 'Content-Length': '999999' } })
    return new Response('test-image', { headers: { 'Content-Type': 'image/png' } })
  })
  assert.deepEqual(Object.keys(photos), ['good'])
  assert.equal(photos.good instanceof Blob, true)
  assert.equal(calls.some(url => url.startsWith('javascript:')), false)
})
