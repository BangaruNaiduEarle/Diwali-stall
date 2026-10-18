import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { copyTextToClipboard } from './copyToClipboard.js'

describe('copyTextToClipboard', () => {
  it('copies text when clipboard API succeeds', async () => {
    let written = ''
    const result = await copyTextToClipboard('hello', {
      writeText: async (value) => {
        written = value
      },
    })
    assert.equal(result.ok, true)
    assert.equal(written, 'hello')
  })

  it('does not report success when writeText fails', async () => {
    const result = await copyTextToClipboard('hello', {
      writeText: async () => {
        throw new Error('denied')
      },
    })
    assert.equal(result.ok, false)
    assert.match(result.message ?? '', /denied/)
  })

  it('rejects empty text', async () => {
    const result = await copyTextToClipboard('', { writeText: async () => {} })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'empty')
  })
})
