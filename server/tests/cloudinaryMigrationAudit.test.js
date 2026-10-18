import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import {
  buildCloudinaryMigrationAudit,
  buildUploadTasksForExistingPaths,
  cataloguePathToPublicFile,
  cataloguePathToUploadTaskId,
  listProductImageFilesOnDisk,
  pickCanonicalUploadReference,
} from '../src/lib/cloudinaryMigrationAudit.js'

describe('cloudinary migration audit', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diwali-audit-'))
  const publicRoot = path.join(tmp, 'public')
  const repoRoot = tmp
  const productsDir = path.join(publicRoot, 'images', 'products')

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function resetProductsDir() {
    fs.rmSync(productsDir, { recursive: true, force: true })
    fs.mkdirSync(productsDir, { recursive: true })
  }

  it('maps catalogue paths to public files exactly', () => {
    resetProductsDir()
    fs.mkdirSync(path.join(productsDir, 'sub'), { recursive: true })
    fs.writeFileSync(path.join(productsDir, 'sub', 'a.webp'), 'x')
    const mapped = cataloguePathToPublicFile('/images/products/sub/a.webp', publicRoot)
    assert.equal(mapped.ok, true)
    assert.equal(fs.existsSync(mapped.absolutePath), true)
    assert.equal(cataloguePathToPublicFile('images/products/sub/a.webp', publicRoot).ok, false)
    assert.equal(cataloguePathToPublicFile('/images/products/../etc/passwd', publicRoot).ok, false)
  })

  it('reports missing files and empty image arrays', () => {
    resetProductsDir()
    fs.writeFileSync(path.join(productsDir, 'ok.webp'), '1')
    const audit = buildCloudinaryMigrationAudit(
      [
        { id: 'P001', images: ['/images/products/ok.webp', '/images/products/missing.webp'] },
        { id: 'P002', images: [] },
      ],
      { publicRoot, repoRoot },
    )
    assert.equal(audit.summary.productCount, 2)
    assert.equal(audit.summary.totalImageReferences, 2)
    assert.equal(audit.summary.existingReferencedFiles, 1)
    assert.equal(audit.summary.missingReferencedFiles, 1)
    assert.deepEqual(audit.missingReferencedFiles, ['/images/products/missing.webp'])
    assert.deepEqual(audit.emptyImageProductIds, ['P002'])
    assert.equal(audit.manifest.length, 1)
    assert.equal(audit.manifest[0].cloudinaryPublicId, 'P001/1')
    assert.equal(audit.manifest[0].eligibleForAutomatedUpload, true)
    assert.equal(audit.uploadTasks.length, 1)
  })

  it('dedupes shared local files into one upload task and reuses canonical Cloudinary public ID', () => {
    resetProductsDir()
    fs.writeFileSync(path.join(productsDir, 'shared.webp'), '1')
    const audit = buildCloudinaryMigrationAudit(
      [
        { id: 'P006', images: ['/images/products/shared.webp'] },
        { id: 'P063', images: ['/images/products/shared.webp'] },
      ],
      { publicRoot, repoRoot },
    )
    assert.equal(audit.sharedAcrossProducts.length, 1)
    assert.deepEqual(audit.sharedAcrossProducts[0].productIds, ['P006', 'P063'])
    assert.equal(audit.uploadTasks.length, 1)
    assert.equal(audit.uploadTasks[0].canonicalCloudinaryPublicId, 'P006/1')
    assert.equal(audit.manifest.length, 2)
    assert.equal(audit.manifest.every((e) => e.sharedLocalFile === true), true)
    assert.equal(audit.manifest.every((e) => e.cloudinaryPublicId === 'P006/1'), true)
    const canonical = audit.manifest.find((e) => e.productId === 'P006')
    const reuse = audit.manifest.find((e) => e.productId === 'P063')
    assert.equal(canonical?.eligibleForAutomatedUpload, true)
    assert.equal(canonical?.isCanonicalUpload, true)
    assert.equal(reuse?.eligibleForAutomatedUpload, false)
    assert.equal(reuse?.reusesCanonicalUploadFrom?.cloudinaryPublicId, 'P006/1')
    assert.equal(
      audit.uploadTasks[0].uploadTaskId,
      cataloguePathToUploadTaskId('/images/products/shared.webp'),
    )
  })

  it('does not substitute a similar unreferenced file when the catalogue path is missing', () => {
    resetProductsDir()
    fs.writeFileSync(path.join(productsDir, 'COLOUR_KOTI_DLX_AJN.webp'), '1')
    const audit = buildCloudinaryMigrationAudit(
      [{ id: 'P010', images: ['/images/products/COLOUR_KOTI_DLX.webp'] }],
      { publicRoot, repoRoot },
    )
    assert.deepEqual(audit.missingReferencedFiles, ['/images/products/COLOUR_KOTI_DLX.webp'])
    assert.equal(audit.manifest.length, 0)
    assert.equal(audit.uploadTasks.length, 0)
    assert.deepEqual(audit.unreferencedFilesOnDisk, [
      '/images/products/COLOUR_KOTI_DLX_AJN.webp',
    ])
  })

  it('honours corrected nachiyar paths under images-mobile-webp', () => {
    resetProductsDir()
    const sub = path.join(productsDir, 'images-mobile-webp')
    fs.mkdirSync(sub, { recursive: true })
    fs.writeFileSync(path.join(sub, 'nachiyar-gift-box-1.webp'), '1')
    fs.writeFileSync(path.join(sub, 'nachiyar-gift-box.webp'), '2')
    const audit = buildCloudinaryMigrationAudit(
      [
        {
          id: 'P039',
          images: [
            '/images/products/images-mobile-webp/nachiyar-gift-box-1.webp',
            '/images/products/images-mobile-webp/nachiyar-gift-box.webp',
          ],
        },
      ],
      { publicRoot, repoRoot },
    )
    assert.equal(audit.summary.missingReferencedFiles, 0)
    assert.equal(audit.uploadTasks.length, 2)
    assert.equal(audit.manifest.length, 2)
    assert.deepEqual(
      audit.manifest.map((e) => e.cataloguePath),
      [
        '/images/products/images-mobile-webp/nachiyar-gift-box-1.webp',
        '/images/products/images-mobile-webp/nachiyar-gift-box.webp',
      ],
    )
  })

  it('pickCanonicalUploadReference prefers lowest product id', () => {
    assert.deepEqual(
      pickCanonicalUploadReference([
        { productId: 'P063', slot: 1 },
        { productId: 'P006', slot: 1 },
      ]),
      { productId: 'P006', slot: 1 },
    )
  })

  it('lists unreferenced files on disk under images/products', () => {
    resetProductsDir()
    fs.writeFileSync(path.join(productsDir, 'used.webp'), '1')
    fs.writeFileSync(path.join(productsDir, 'orphan.webp'), '2')
    const audit = buildCloudinaryMigrationAudit(
      [{ id: 'P001', images: ['/images/products/used.webp'] }],
      { publicRoot, repoRoot },
    )
    assert.deepEqual(audit.unreferencedFilesOnDisk, ['/images/products/orphan.webp'])
    assert.equal(listProductImageFilesOnDisk(productsDir).length, 2)
  })

  it('produces deterministic sorted manifest output', () => {
    resetProductsDir()
    fs.writeFileSync(path.join(productsDir, 'b.webp'), '1')
    fs.writeFileSync(path.join(productsDir, 'a.webp'), '2')
    const products = [
      { id: 'P002', images: ['/images/products/b.webp'] },
      { id: 'P001', images: ['/images/products/a.webp', '/images/products/b.webp'] },
    ]
    const a1 = buildCloudinaryMigrationAudit(products, { publicRoot, repoRoot })
    const a2 = buildCloudinaryMigrationAudit(products, { publicRoot, repoRoot })
    assert.deepEqual(a1.manifest, a2.manifest)
    assert.deepEqual(
      a1.manifest.map((e) => e.cloudinaryPublicId),
      ['P001/1', 'P001/2', 'P001/2'],
    )
    assert.equal(a1.manifest.find((e) => e.productId === 'P002')?.reusesCanonicalUploadFrom?.productId, 'P001')
    assert.equal(a1.duplicateReferences.length, 1)
    assert.equal(a1.uploadTasks.length, 2)
    assert.deepEqual(
      a1.uploadTasks.map((t) => t.canonicalCloudinaryPublicId).sort(),
      ['P001/1', 'P001/2'],
    )
  })

  it('buildUploadTasksForExistingPaths is deterministic', () => {
    const map = new Map([
      [
        '/images/products/a.webp',
        [
          {
            productId: 'P002',
            slot: 1,
            cataloguePath: '/images/products/a.webp',
            localFilePath: 'public/images/products/a.webp',
          },
        ],
      ],
    ])
    assert.deepEqual(
      buildUploadTasksForExistingPaths(map),
      buildUploadTasksForExistingPaths(map),
    )
  })
})
