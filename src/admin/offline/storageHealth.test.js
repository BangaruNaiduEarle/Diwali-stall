import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readStorageHealth, storageWarning } from './storageHealth.js'

test('unsupported or rejected storage APIs do not block offline preparation', async () => {
  for (const storage of [{}, { persisted: async () => { throw Error('denied') }, persist: async () => { throw Error('denied') }, estimate: async () => { throw Error('denied') } }]) {
    assert.deepEqual(await readStorageHealth(storage, true), { persistent: null, usage: null, quota: null, low: false })
  }
})
test('requests persistence only during preparation and warns on eviction or pressure', async () => {
  let requests = 0
  const storage = { persisted: async () => false, persist: async () => { requests++; return true }, estimate: async () => ({ usage: 850 * 1024 * 1024, quota: 1024 * 1024 * 1024 }) }
  assert.equal((await readStorageHealth(storage)).persistent, false)
  assert.equal(requests, 0)
  const health = await readStorageHealth(storage, true)
  assert.equal(requests, 1); assert.equal(health.persistent, true); assert.equal(health.low, true)
  assert.match(storageWarning(health), /Do not clear/)
  assert.match(storageWarning({ persistent: false }), /evict/)
  assert.equal(storageWarning({ persistent: true, low: false }), null)
})
