import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { catalogueCloudinaryByPath } from '../data/catalogueCloudinaryByPath.js'
import { normalizeProductImageUrl } from './productImage.js'

describe('productImage local catalogue resolution', () => {
  it('keeps a known catalogue path on local /images/... when a file exists', () => {
    const local = '/images/products/images-mobile-webp/100_DLX.webp'
    assert.ok(catalogueCloudinaryByPath[local]?.startsWith('https://res.cloudinary.com/'))
    assert.equal(normalizeProductImageUrl(local), local)
  })

  it('aliases legacy DB paths to existing catalogue assets', () => {
    const legacy = '/images/products/images-mobile-webp/GANGA_JAMUNA_AJN.webp'
    const canonical = '/images/products/images-mobile-webp/GANGA_JAMUNA.webp'
    assert.equal(catalogueCloudinaryByPath[legacy], undefined)
    assert.equal(normalizeProductImageUrl(legacy), canonical)
    assert.equal(
      normalizeProductImageUrl('/images/products/images-mobile-webp/GC_SPECIAL_AJN.webp'),
      '/images/products/images-mobile-webp/GC_SPECIAL_AJN.jpg',
    )
  })

  it('maps stored Cloudinary delivery URLs back to local catalogue paths', () => {
    const local = '/images/products/images-mobile-webp/100_DLX.webp'
    const cloudUrl = catalogueCloudinaryByPath[local]
    assert.equal(normalizeProductImageUrl(cloudUrl), local)
  })

  it('maps supplemental Cloudinary URLs (P114, P163, family packs) to local paths', () => {
    const cases = [
      [
        'https://res.cloudinary.com/dn0puzofw/image/upload/v1792769924/diwali/products/P114/1.webp',
        '/images/products/images-mobile-webp/dora-dora.webp',
      ],
      [
        'https://res.cloudinary.com/dn0puzofw/image/upload/v1792769824/diwali/products/P163/1.webp',
        '/images/products/images-mobile-webp/1_lakh_box.webp',
      ],
      [
        'https://res.cloudinary.com/dn0puzofw/image/upload/v1792769836/diwali/products/P163/2.webp',
        '/images/products/images-mobile-webp/1_lakh_in.webp',
      ],
      [
        'https://res.cloudinary.com/dn0puzofw/image/upload/v1792591244/diwali/family-packs/FP001/1.png',
        '/images/family-packs/pocket_budget_pack.webp',
      ],
      [
        'https://res.cloudinary.com/dn0puzofw/image/upload/v1792591278/diwali/family-packs/FP001/2.webp',
        '/images/products/images-mobile-webp/pocket_budget_pack.webp',
      ],
      [
        'https://res.cloudinary.com/dn0puzofw/image/upload/v1792634681/diwali/family-packs/FP002/1.webp',
        '/images/family-packs/budget_mix_pack.webp',
      ],
      [
        'https://res.cloudinary.com/dn0puzofw/image/upload/v1792634693/diwali/family-packs/FP002/2.webp',
        '/images/products/images-mobile-webp/budget_mix_pack.webp',
      ],
      [
        'https://res.cloudinary.com/dn0puzofw/image/upload/v1792634931/diwali/family-packs/FP003/1.webp',
        '/images/family-packs/Budget_Family_Pack.webp',
      ],
      [
        'https://res.cloudinary.com/dn0puzofw/image/upload/v1792635227/diwali/family-packs/FP004/1.webp',
        '/images/family-packs/Mini_Starter_Pack.webp',
      ],
      [
        'https://res.cloudinary.com/dn0puzofw/image/upload/v1792635434/diwali/family-packs/FP005/1.webp',
        '/images/family-packs/Mini_Family_Pack.webp',
      ],
      [
        'https://res.cloudinary.com/dn0puzofw/image/upload/v1792635781/diwali/family-packs/FP006/1.webp',
        '/images/family-packs/Happy_Family_Pack.webp',
      ],
    ]
    for (const [cloudUrl, localPath] of cases) {
      assert.equal(normalizeProductImageUrl(cloudUrl), localPath, cloudUrl)
    }
  })

  it('passes through non-Cloudinary https URLs unchanged', () => {
    const url = 'https://example.com/x.webp'
    assert.equal(normalizeProductImageUrl(url), url)
  })
})
