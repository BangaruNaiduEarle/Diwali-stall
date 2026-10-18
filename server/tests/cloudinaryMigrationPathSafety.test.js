import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import {
  isApprovedCloudinaryDeliveryHost,
  resolveManifestLocalImageFile,
  validateCloudinaryDeliveryPathname,
  validateCloudinarySecureUrl,
  validateStoredMappingRecord,
} from '../src/lib/cloudinaryMigrationPathSafety.js'
import { saveUploadMap, loadUploadMap } from '../src/lib/cloudinaryUploadMapStore.js'

describe('cloudinary migration path safety', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diwali-path-safety-'))
  const repoRoot = tmp

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function writeProduct(relName, content = 'x') {
    const rel = `public/images/products/${relName}`
    const abs = path.join(repoRoot, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
    return rel.replace(/\\/g, '/')
  }

  it('approves res.cloudinary.com and res-N.cloudinary.com hosts', () => {
    assert.equal(isApprovedCloudinaryDeliveryHost('res.cloudinary.com'), true)
    assert.equal(isApprovedCloudinaryDeliveryHost('res-5.cloudinary.com'), true)
    assert.equal(isApprovedCloudinaryDeliveryHost('evil.com'), false)
  })

  it('binds delivery URLs to the configured cloud name', () => {
    const cloud = 'my-diwali-cloud'
    const valid = validateCloudinarySecureUrl(
      `https://res.cloudinary.com/${cloud}/image/upload/v1/diwali/products/P1/1.webp`,
      cloud,
    )
    assert.equal(valid.ok, true)

    const wrongAccount = validateCloudinarySecureUrl(
      'https://res.cloudinary.com/other-account/image/upload/v1/diwali/products/P1/1.webp',
      cloud,
    )
    assert.equal(wrongAccount.ok, false)
    assert.equal(wrongAccount.error, 'cloud_name_mismatch')

    const malformed = validateCloudinarySecureUrl(
      `https://res.cloudinary.com/${cloud}/image/private/v1/x.webp`,
      cloud,
    )
    assert.equal(malformed.ok, false)
    assert.equal(malformed.error, 'malformed_delivery_path')

    assert.equal(validateCloudinaryDeliveryPathname('/my-diwali-cloud/image/upload/x', cloud).ok, true)
    assert.equal(validateCloudinaryDeliveryPathname('/other/image/upload/x', cloud).ok, false)
  })

  it('rejects path traversal and files outside public/images/products', () => {
    writeProduct('ok.webp')
    const outside = path.join(repoRoot, 'secret.txt')
    fs.writeFileSync(outside, 'nope')

    const traversal = resolveManifestLocalImageFile(
      {
        cataloguePath: '/images/products/ok.webp',
        localFilePath: 'public/images/products/../secret.txt',
      },
      repoRoot,
    )
    assert.equal(traversal.ok, false)

    const outsideTask = resolveManifestLocalImageFile(
      {
        cataloguePath: '/images/products/ok.webp',
        localFilePath: 'public/secret.txt',
      },
      repoRoot,
    )
    assert.equal(outsideTask.ok, false)

    const mismatch = resolveManifestLocalImageFile(
      {
        cataloguePath: '/images/products/ok.webp',
        localFilePath: 'public/images/products/other.webp',
      },
      repoRoot,
    )
    assert.equal(mismatch.ok, false)
  })

  it('rejects unsupported image extensions', () => {
    const rel = writeProduct('bad.exe')
    const result = resolveManifestLocalImageFile(
      {
        cataloguePath: '/images/products/bad.exe',
        localFilePath: rel,
      },
      repoRoot,
    )
    assert.equal(result.ok, false)
    assert.equal(result.error, 'unsupported_image_extension')
  })

  it('rejects symlink escape when symlink support is available', () => {
    const outsideDir = path.join(tmp, 'outside')
    fs.mkdirSync(outsideDir, { recursive: true })
    const outsideFile = path.join(outsideDir, 'escaped.webp')
    fs.writeFileSync(outsideFile, 'escaped')

    const linkPath = path.join(repoRoot, 'public/images/products/link-out.webp')
    try {
      fs.symlinkSync(outsideFile, linkPath)
    } catch {
      return
    }

    const result = resolveManifestLocalImageFile(
      {
        cataloguePath: '/images/products/link-out.webp',
        localFilePath: 'public/images/products/link-out.webp',
      },
      repoRoot,
    )
    assert.equal(result.ok, false)
    assert.equal(result.error, 'symlink_escapes_products_dir')
  })

  it('validates stored mapping records and rejects tampered URLs', () => {
    const task = {
      cataloguePath: '/images/products/a.webp',
      localFilePath: 'public/images/products/a.webp',
      uploadTaskId: 't1',
      canonicalCloudinaryPublicId: 'P001/1',
      cloudinaryFolder: 'diwali/products',
    }
    const cloud = 'test-cloud'
    const good = validateStoredMappingRecord(
      {
        cataloguePath: task.cataloguePath,
        localFilePath: task.localFilePath,
        uploadTaskId: task.uploadTaskId,
        canonicalCloudinaryPublicId: task.canonicalCloudinaryPublicId,
        cloudinaryPublicId: 'diwali/products/P001/1',
        secureUrl: 'https://res.cloudinary.com/test-cloud/image/upload/v1/y.webp',
        uploadedAt: '2026-01-01T00:00:00.000Z',
      },
      task,
      cloud,
    )
    assert.equal(good.ok, true)

    const badHost = validateStoredMappingRecord(
      {
        cataloguePath: task.cataloguePath,
        localFilePath: task.localFilePath,
        uploadTaskId: task.uploadTaskId,
        canonicalCloudinaryPublicId: task.canonicalCloudinaryPublicId,
        cloudinaryPublicId: 'diwali/products/P001/1',
        secureUrl: 'https://evil.example/x.webp',
        uploadedAt: '2026-01-01T00:00:00.000Z',
      },
      task,
      cloud,
    )
    assert.equal(badHost.ok, false)

    const wrongCloud = validateStoredMappingRecord(
      {
        cataloguePath: task.cataloguePath,
        localFilePath: task.localFilePath,
        uploadTaskId: task.uploadTaskId,
        canonicalCloudinaryPublicId: task.canonicalCloudinaryPublicId,
        cloudinaryPublicId: 'diwali/products/P001/1',
        secureUrl: 'https://res.cloudinary.com/other-cloud/image/upload/v1/y.webp',
        uploadedAt: '2026-01-01T00:00:00.000Z',
      },
      task,
      cloud,
    )
    assert.equal(wrongCloud.ok, false)
    assert.equal(wrongCloud.error, 'cloud_name_mismatch')
  })

  it('saveUploadMap keeps prior file when rename fails', () => {
    const mapDir = path.join(tmp, 'map-dir')
    fs.mkdirSync(mapDir, { recursive: true })
    const mapPath = path.join(mapDir, 'mapping.json')
    saveUploadMap(mapPath, {
      version: 1,
      updatedAt: null,
      byCataloguePath: {},
      byProductSlot: {},
    })
    const before = fs.readFileSync(mapPath, 'utf8')
    assert.equal(JSON.parse(before).version, 1)

    fs.chmodSync(mapPath, 0o444)
    assert.throws(() => {
      saveUploadMap(mapPath, {
        version: 2,
        updatedAt: null,
        byCataloguePath: {},
        byProductSlot: {},
      })
    })
    fs.chmodSync(mapPath, 0o644)
    assert.equal(JSON.parse(fs.readFileSync(mapPath, 'utf8')).version, 1)
  })
})
