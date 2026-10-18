import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { suggestUnreferencedCandidates } from '../src/lib/cloudinaryMigrationReview.js'

describe('cloudinary migration review', () => {
  it('lists unreferenced candidates without auto-mapping missing paths', () => {
    const unreferenced = [
      '/images/products/images-mobile-webp/GC_SPECIAL_AJN.jpg',
      '/images/products/images-mobile-webp/GB-WONDERFULL-40-ITEMS-1_UNKNOWN.webp',
      '/images/products/images-mobile-webp/nachiyar-gift-box.webp',
    ]
    const gc = suggestUnreferencedCandidates(
      '/images/products/images-mobile-webp/GC_SPECIAL_AJN.webp',
      unreferenced,
    )
    assert.equal(gc.length, 1)
    assert.equal(gc[0].reason, 'same_filename_stem_different_extension_or_suffix')

    const gb = suggestUnreferencedCandidates(
      '/images/products/images-mobile-webp/GB-WONDERFULL-40-ITEMS-1.webp',
      unreferenced,
    )
    assert.equal(gb.length, 1)
    assert.equal(gb[0].reason, 'unreferenced_unknown_suffix_variant')
  })
})
