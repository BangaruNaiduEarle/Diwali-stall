import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  auditQuickBillImageBackfill,
  buildCloudinaryPathLookup,
  findDuplicateCloudinaryMappings,
  isStoredCloudinaryHttpsUrl,
  proposeImagesJsonAfterBackfill,
} from '../src/lib/quickBillImageBackfillAudit.js'

describe('quickBillImageBackfillAudit', () => {
  const uploadMapping = {
    byCataloguePath: {
      '/images/products/a.webp': {
        secureUrl: 'https://res.cloudinary.com/dn0puzofw/image/upload/v1/diwali/products/P001/1.webp',
      },
      '/images/products/shared.webp': {
        secureUrl: 'https://res.cloudinary.com/dn0puzofw/image/upload/v1/diwali/products/P006/1.webp',
      },
    },
  }

  it('preserves order and existing Cloudinary URLs', () => {
    const lookup = buildCloudinaryPathLookup(uploadMapping, {})
    const existing = 'https://res.cloudinary.com/dn0puzofw/image/upload/v1/diwali/products/P099/2.webp'
    const proposal = proposeImagesJsonAfterBackfill(
      [existing, '/images/products/a.webp', '/images/products/missing.webp'],
      lookup,
    )
    assert.deepEqual(proposal.proposedImages, [
      existing,
      'https://res.cloudinary.com/dn0puzofw/image/upload/v1/diwali/products/P001/1.webp',
      '/images/products/missing.webp',
    ])
    assert.equal(proposal.missingMappingPaths.length, 1)
    assert.equal(proposal.wouldChange, true)
  })

  it('audits products without rate or pricing fields', () => {
    const lookup = buildCloudinaryPathLookup(uploadMapping, {})
    const audit = auditQuickBillImageBackfill(
      [
        { id: 'P001', images_json: '["/images/products/a.webp"]' },
        { id: 'P002', images_json: '[]' },
        {
          id: 'P003',
          images_json:
            '["https://res.cloudinary.com/dn0puzofw/image/upload/v1/diwali/products/P003/1.webp"]',
        },
      ],
      lookup,
    )
    assert.equal(audit.summary.productCount, 3)
    assert.deepEqual(audit.matchedProductIds, ['P001'])
    assert.deepEqual(audit.emptyProductIds, ['P002'])
    assert.deepEqual(audit.alreadyCloudinaryProductIds, ['P003'])
    assert.equal(audit.pathChanges.length, 1)
    assert.ok(!JSON.stringify(audit).includes('private_rates'))
    assert.ok(!JSON.stringify(audit).includes('unit_rate_paise'))
  })

  it('detects duplicate Cloudinary URLs across catalogue paths', () => {
    const lookup = buildCloudinaryPathLookup(
      {
        byCataloguePath: {
          '/images/products/x.webp': { secureUrl: 'https://res.cloudinary.com/dn0puzofw/image/upload/v1/same.webp' },
          '/images/products/y.webp': { secureUrl: 'https://res.cloudinary.com/dn0puzofw/image/upload/v1/same.webp' },
        },
      },
      {},
    )
    const { duplicateUrls } = findDuplicateCloudinaryMappings(lookup)
    assert.equal(duplicateUrls.length, 1)
    assert.equal(duplicateUrls[0].cataloguePaths.length, 2)
  })

  it('recognizes stored Cloudinary HTTPS URLs', () => {
    assert.equal(
      isStoredCloudinaryHttpsUrl('https://res.cloudinary.com/dn0puzofw/image/upload/v1/x.webp'),
      true,
    )
    assert.equal(isStoredCloudinaryHttpsUrl('/images/products/a.webp'), false)
  })
})
