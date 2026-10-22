import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const artefactPath = join(repoRoot, 'src', 'data', 'catalogue-public-prices.json')

describe('catalogue public prices artefact (Vercel build)', () => {
  it('exists with a non-empty price map for delivery threshold', () => {
    const raw = readFileSync(artefactPath, 'utf8')
    const doc = JSON.parse(raw)
    assert.ok(doc.prices && typeof doc.prices === 'object')
    assert.ok(Object.keys(doc.prices).length >= 100, 'expected catalogue prices from products.js')
    assert.equal(typeof doc.prices.P001, 'number')
  })
})
