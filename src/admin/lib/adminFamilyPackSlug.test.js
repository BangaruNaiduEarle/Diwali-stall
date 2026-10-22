import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { suggestFamilyPackSlugFromName } from './adminFamilyPackSlug.js'

describe('suggestFamilyPackSlugFromName', () => {
  it('derives a lowercase hyphenated slug from pack name', () => {
    assert.equal(suggestFamilyPackSlugFromName('Budget Family Pack'), 'budget-family-pack')
  })

  it('returns empty for blank input', () => {
    assert.equal(suggestFamilyPackSlugFromName('   '), '')
  })
})
