import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { jsonHealth } from '../src/routes/health.js'

describe('health route helpers', () => {
  it('jsonHealth returns 200 JSON with no-store cache', async () => {
    const res = jsonHealth({ ok: true, service: 'diwali-api', phase: '2b' })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Cache-Control'), 'no-store')
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.service, 'diwali-api')
    assert.equal(body.phase, '2b')
  })
})
