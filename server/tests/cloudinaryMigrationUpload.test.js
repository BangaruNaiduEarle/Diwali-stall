import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import {
  parseCloudinaryUploadResponse,
  runCloudinaryMigrationUpload,
  uploadLocalFileToCloudinary,
} from '../src/lib/cloudinaryMigrationUpload.js'
import { parseMigrationManifest } from '../src/lib/cloudinaryMigrationManifest.js'
import { loadUploadMap, saveUploadMap, getCataloguePathRecord } from '../src/lib/cloudinaryUploadMapStore.js'

describe('cloudinary migration upload', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diwali-upload-'))
  const repoRoot = tmp
  const mapPath = path.join(tmp, 'map.json')

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function writeProduct(relName, content = 'x') {
    const rel = `public/images/products/${relName}`.replace(/\\/g, '/')
    const abs = path.join(repoRoot, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
    return rel
  }

  function baseManifest(tasks, entries, extra = {}) {
    return {
      generatedAt: '2026-01-01T00:00:00.000Z',
      dryRun: true,
      cloudinaryFolder: 'diwali/products',
      uploadTasks: tasks,
      entries,
      ...extra,
    }
  }

  const env = {
    CLOUDINARY_CLOUD_NAME: 'test-cloud',
    CLOUDINARY_API_KEY: 'key',
    CLOUDINARY_API_SECRET: 'secret',
  }
  const config = {
    cloudName: 'test-cloud',
    apiKey: 'key',
    apiSecret: 'secret',
  }

  it('validates manifest entries against uploadTasks', () => {
    const bad = parseMigrationManifest({
      uploadTasks: [
        {
          uploadTaskId: 't1',
          cataloguePath: '/images/products/a.webp',
          localFilePath: 'public/images/products/a.webp',
          canonicalCloudinaryPublicId: 'P001/1',
        },
      ],
      entries: [
        {
          productId: 'P001',
          slot: 1,
          cataloguePath: '/images/products/b.webp',
          uploadTaskId: 't1',
          cloudinaryPublicId: 'P001/1',
        },
      ],
    })
    assert.equal(bad.ok, false)
  })

  it('dry-run does not call fetch or write the mapping file', async () => {
    const local = writeProduct('one.webp')
    const manifest = baseManifest(
      [
        {
          uploadTaskId: 't-one',
          cataloguePath: '/images/products/one.webp',
          localFilePath: local,
          cloudinaryFolder: 'diwali/products',
          canonicalCloudinaryPublicId: 'P001/1',
        },
      ],
      [
        {
          productId: 'P001',
          slot: 1,
          cataloguePath: '/images/products/one.webp',
          localFilePath: local,
          uploadTaskId: 't-one',
          cloudinaryPublicId: 'P001/1',
        },
      ],
    )
    let fetchCalls = 0
    const result = await runCloudinaryMigrationUpload({
      manifest: parseMigrationManifest(manifest).manifest,
      repoRoot,
      map: loadUploadMap(mapPath).map,
      mapPath,
      execute: false,
      force: false,
      env,
      fetchImpl: async () => {
        fetchCalls += 1
        return new Response('{}')
      },
    })
    assert.equal(fetchCalls, 0)
    assert.equal(result.report.summary.wouldUpload, 1)
    assert.equal(fs.existsSync(mapPath), false)
  })

  it('rejects unsafe local paths with zero upload requests', async () => {
    writeProduct('safe.webp')
    fs.writeFileSync(path.join(repoRoot, 'public/outside.webp'), 'x')
    let fetchCalls = 0
    const manifest = parseMigrationManifest(
      baseManifest(
        [
          {
            uploadTaskId: 't-bad',
            cataloguePath: '/images/products/safe.webp',
            localFilePath: 'public/outside.webp',
            canonicalCloudinaryPublicId: 'P001/1',
          },
        ],
        [
          {
            productId: 'P001',
            slot: 1,
            cataloguePath: '/images/products/safe.webp',
            localFilePath: 'public/outside.webp',
            uploadTaskId: 't-bad',
            cloudinaryPublicId: 'P001/1',
          },
        ],
      ),
    ).manifest
    const result = await runCloudinaryMigrationUpload({
      manifest,
      repoRoot,
      map: loadUploadMap(mapPath).map,
      mapPath,
      execute: true,
      force: false,
      env,
      fetchImpl: async () => {
        fetchCalls += 1
        return Response.json({
          secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/y.webp',
          public_id: 'diwali/products/P001/1',
        })
      },
    })
    assert.equal(fetchCalls, 0)
    assert.equal(result.report.summary.rejectedUnsafeLocalPath, 1)
  })

  it('skips missing local files without upload (shared path)', async () => {
    const manifest = baseManifest(
      [
        {
          uploadTaskId: 't-shared',
          cataloguePath: '/images/products/images-mobile-webp/GC_SPECIAL_AJN.webp',
          localFilePath: 'public/images/products/images-mobile-webp/GC_SPECIAL_AJN.webp',
          cloudinaryFolder: 'diwali/products',
          canonicalCloudinaryPublicId: 'P006/1',
          sharedAcrossProducts: true,
        },
      ],
      [
        {
          productId: 'P006',
          slot: 1,
          cataloguePath: '/images/products/images-mobile-webp/GC_SPECIAL_AJN.webp',
          localFilePath: 'public/images/products/images-mobile-webp/GC_SPECIAL_AJN.webp',
          uploadTaskId: 't-shared',
          cloudinaryPublicId: 'P006/1',
        },
        {
          productId: 'P063',
          slot: 1,
          cataloguePath: '/images/products/images-mobile-webp/GC_SPECIAL_AJN.webp',
          localFilePath: 'public/images/products/images-mobile-webp/GC_SPECIAL_AJN.webp',
          uploadTaskId: 't-shared',
          cloudinaryPublicId: 'P006/1',
          reusesCanonicalUploadFrom: { productId: 'P006', slot: 1, cloudinaryPublicId: 'P006/1' },
        },
      ],
    )
    const result = await runCloudinaryMigrationUpload({
      manifest: parseMigrationManifest(manifest).manifest,
      repoRoot,
      map: loadUploadMap(mapPath).map,
      mapPath,
      execute: false,
      force: false,
      env,
    })
    assert.equal(result.report.summary.skippedMissingLocalFile, 1)
    assert.equal(result.report.summary.wouldUpload, 0)
  })

  it('dedupes shared source to one upload and maps both product slots', async () => {
    const local = writeProduct('shared.webp', 'shared-bytes')
    const manifest = baseManifest(
      [
        {
          uploadTaskId: 't-shared',
          cataloguePath: '/images/products/shared.webp',
          localFilePath: local,
          cloudinaryFolder: 'diwali/products',
          canonicalCloudinaryPublicId: 'P006/1',
          sharedAcrossProducts: true,
        },
      ],
      [
        {
          productId: 'P006',
          slot: 1,
          cataloguePath: '/images/products/shared.webp',
          localFilePath: local,
          uploadTaskId: 't-shared',
          cloudinaryPublicId: 'P006/1',
        },
        {
          productId: 'P063',
          slot: 1,
          cataloguePath: '/images/products/shared.webp',
          localFilePath: local,
          uploadTaskId: 't-shared',
          cloudinaryPublicId: 'P006/1',
          reusesCanonicalUploadFrom: { productId: 'P006', slot: 1, cloudinaryPublicId: 'P006/1' },
        },
      ],
    )
    let fetchCalls = 0
    const result = await runCloudinaryMigrationUpload({
      manifest: parseMigrationManifest(manifest).manifest,
      repoRoot,
      map: loadUploadMap(mapPath).map,
      mapPath,
      execute: true,
      force: false,
      env,
      fetchImpl: async () => {
        fetchCalls += 1
        return Response.json({
          secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/diwali/products/P006/1.webp',
          public_id: 'diwali/products/P006/1',
        })
      },
    })
    assert.equal(fetchCalls, 1)
    assert.equal(result.report.summary.uploaded, 1)
    const saved = loadUploadMap(mapPath).map
    const url = getCataloguePathRecord(saved, '/images/products/shared.webp')?.secureUrl
    assert.ok(url?.startsWith('https://res.cloudinary.com/'))
    assert.equal(saved.byProductSlot['P006/1'].secureUrl, url)
    assert.equal(saved.byProductSlot['P063/1'].secureUrl, url)
  })

  it('retries skip already mapped catalogue paths when mapping is valid', async () => {
    const local = writeProduct('retry.webp')
    const manifest = parseMigrationManifest(
      baseManifest(
        [
          {
            uploadTaskId: 't-retry',
            cataloguePath: '/images/products/retry.webp',
            localFilePath: local,
            cloudinaryFolder: 'diwali/products',
            canonicalCloudinaryPublicId: 'P010/1',
          },
        ],
        [
          {
            productId: 'P010',
            slot: 1,
            cataloguePath: '/images/products/retry.webp',
            localFilePath: local,
            uploadTaskId: 't-retry',
            cloudinaryPublicId: 'P010/1',
          },
        ],
      ),
    ).manifest

    saveUploadMap(mapPath, {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      byCataloguePath: {
        '/images/products/retry.webp': {
          cataloguePath: '/images/products/retry.webp',
          localFilePath: local,
          uploadTaskId: 't-retry',
          canonicalCloudinaryPublicId: 'P010/1',
          cloudinaryPublicId: 'diwali/products/P010/1',
          secureUrl: 'https://res.cloudinary.com/test-cloud/image/upload/v1/x.webp',
          uploadedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      byProductSlot: {},
    })

    let fetchCalls = 0
    const result = await runCloudinaryMigrationUpload({
      manifest,
      repoRoot,
      map: loadUploadMap(mapPath).map,
      mapPath,
      execute: true,
      force: false,
      env,
      fetchImpl: async () => {
        fetchCalls += 1
        return Response.json({
          secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/y.webp',
          public_id: 'diwali/products/P010/1',
        })
      },
    })
    assert.equal(fetchCalls, 0)
    assert.equal(result.report.summary.skippedAlreadyMapped, 1)
  })

  it('re-uploads when stored mapping uses another Cloudinary account URL', async () => {
    const local = writeProduct('wrong-cloud.webp')
    const manifest = parseMigrationManifest(
      baseManifest(
        [
          {
            uploadTaskId: 't-wc',
            cataloguePath: '/images/products/wrong-cloud.webp',
            localFilePath: local,
            cloudinaryFolder: 'diwali/products',
            canonicalCloudinaryPublicId: 'P010/1',
          },
        ],
        [
          {
            productId: 'P010',
            slot: 1,
            cataloguePath: '/images/products/wrong-cloud.webp',
            localFilePath: local,
            uploadTaskId: 't-wc',
            cloudinaryPublicId: 'P010/1',
          },
        ],
      ),
    ).manifest

    saveUploadMap(mapPath, {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      byCataloguePath: {
        '/images/products/wrong-cloud.webp': {
          cataloguePath: '/images/products/wrong-cloud.webp',
          localFilePath: local,
          uploadTaskId: 't-wc',
          canonicalCloudinaryPublicId: 'P010/1',
          cloudinaryPublicId: 'diwali/products/P010/1',
          secureUrl: 'https://res.cloudinary.com/other-cloud/image/upload/v1/x.webp',
          uploadedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      byProductSlot: {},
    })

    let fetchCalls = 0
    const result = await runCloudinaryMigrationUpload({
      manifest,
      repoRoot,
      map: loadUploadMap(mapPath).map,
      mapPath,
      execute: true,
      force: false,
      env,
      fetchImpl: async () => {
        fetchCalls += 1
        return Response.json({
          secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/x.webp',
          public_id: 'diwali/products/P010/1',
        })
      },
    })
    assert.equal(fetchCalls, 1)
    assert.equal(result.report.summary.rejectedInvalidStoredMapping, 1)
    assert.equal(result.report.summary.uploaded, 1)
  })

  it('re-uploads when stored mapping is tampered instead of skipping', async () => {
    const local = writeProduct('tampered.webp')
    const manifest = parseMigrationManifest(
      baseManifest(
        [
          {
            uploadTaskId: 't-tamp',
            cataloguePath: '/images/products/tampered.webp',
            localFilePath: local,
            cloudinaryFolder: 'diwali/products',
            canonicalCloudinaryPublicId: 'P010/1',
          },
        ],
        [
          {
            productId: 'P010',
            slot: 1,
            cataloguePath: '/images/products/tampered.webp',
            localFilePath: local,
            uploadTaskId: 't-tamp',
            cloudinaryPublicId: 'P010/1',
          },
        ],
      ),
    ).manifest

    saveUploadMap(mapPath, {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      byCataloguePath: {
        '/images/products/tampered.webp': {
          cataloguePath: '/images/products/tampered.webp',
          localFilePath: local,
          uploadTaskId: 't-tamp',
          canonicalCloudinaryPublicId: 'P010/1',
          cloudinaryPublicId: 'diwali/products/P010/1',
          secureUrl: 'https://evil.example/tampered.webp',
          uploadedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      byProductSlot: {},
    })

    let fetchCalls = 0
    const result = await runCloudinaryMigrationUpload({
      manifest,
      repoRoot,
      map: loadUploadMap(mapPath).map,
      mapPath,
      execute: true,
      force: false,
      env,
      fetchImpl: async () => {
        fetchCalls += 1
        return Response.json({
          secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/t.webp',
          public_id: 'diwali/products/P010/1',
        })
      },
    })
    assert.equal(fetchCalls, 1)
    assert.equal(result.report.summary.rejectedInvalidStoredMapping, 1)
    assert.equal(result.report.summary.uploaded, 1)
  })

  it('fails safely on HTTP errors without updating the map', async () => {
    const local = writeProduct('fail.webp')
    const manifest = parseMigrationManifest(
      baseManifest(
        [
          {
            uploadTaskId: 't-fail',
            cataloguePath: '/images/products/fail.webp',
            localFilePath: local,
            cloudinaryFolder: 'diwali/products',
            canonicalCloudinaryPublicId: 'P124/1',
          },
        ],
        [
          {
            productId: 'P124',
            slot: 1,
            cataloguePath: '/images/products/fail.webp',
            localFilePath: local,
            uploadTaskId: 't-fail',
            cloudinaryPublicId: 'P124/1',
          },
        ],
      ),
    ).manifest

    const emptyMapPath = path.join(tmp, 'fail-map.json')
    let fetchCalls = 0
    const result = await runCloudinaryMigrationUpload({
      manifest,
      repoRoot,
      map: loadUploadMap(emptyMapPath).map,
      mapPath: emptyMapPath,
      execute: true,
      force: false,
      env,
      fetchImpl: async () => {
        fetchCalls += 1
        return Response.json({ error: { message: 'Invalid' } }, { status: 400 })
      },
    })
    assert.equal(fetchCalls, 1)
    assert.equal(result.ok, false)
    assert.equal(result.report.summary.failed, 1)
    assert.equal(Object.keys(loadUploadMap(emptyMapPath).map.byCataloguePath).length, 0)
  })

  it('parseCloudinaryUploadResponse rejects malformed payloads and bad hosts', () => {
    const cloud = 'test-cloud'
    assert.equal(parseCloudinaryUploadResponse({}).ok, false)
    assert.equal(
      parseCloudinaryUploadResponse({ secure_url: 'http://insecure', public_id: 'a' }, { cloudName: cloud })
        .ok,
      false,
    )
    assert.equal(
      parseCloudinaryUploadResponse(
        {
          secure_url: 'https://evil.example/y.webp',
          public_id: 'diwali/products/P1/1',
        },
        { cloudName: cloud },
      ).ok,
      false,
    )
    assert.equal(
      parseCloudinaryUploadResponse(
        {
          secure_url: 'https://res.cloudinary.com/other-cloud/image/upload/v1/y.webp',
          public_id: 'diwali/products/P1/1',
        },
        { cloudName: cloud, expectedFullPublicId: 'diwali/products/P1/1' },
      ).ok,
      false,
    )
    assert.equal(
      parseCloudinaryUploadResponse(
        {
          secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/y.webp',
          public_id: 'diwali/products/P1/2',
        },
        { cloudName: cloud, expectedFullPublicId: 'diwali/products/P1/1' },
      ).ok,
      false,
    )
    assert.equal(
      parseCloudinaryUploadResponse(
        {
          secure_url: 'https://res-2.cloudinary.com/test-cloud/image/upload/v1/y.webp',
          public_id: 'diwali/products/P1/1',
        },
        { cloudName: cloud, expectedFullPublicId: 'diwali/products/P1/1' },
      ).ok,
      true,
    )
  })

  it('uploadLocalFileToCloudinary rejects unexpected public_id without mapping success', async () => {
    const local = writeProduct('up.webp', 'data')
    const res = await uploadLocalFileToCloudinary({
      config,
      absoluteFilePath: path.join(repoRoot, local),
      folder: 'diwali/products',
      publicId: 'P001/1',
      fetchImpl: async () =>
        Response.json({
          secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/a.webp',
          public_id: 'diwali/products/WRONG/1',
        }),
    })
    assert.equal(res.ok, false)
    assert.equal(res.error, 'unexpected_public_id')
  })

  it('uploadLocalFileToCloudinary uses fetch mock and never returns apiSecret', async () => {
    const local = writeProduct('up2.webp', 'data')
    const res = await uploadLocalFileToCloudinary({
      config,
      absoluteFilePath: path.join(repoRoot, local),
      folder: 'diwali/products',
      publicId: 'P001/1',
      fetchImpl: async (_url, init) => {
        const body = init?.body
        assert.ok(body instanceof FormData)
        assert.equal(String(body.get('api_key')), 'key')
        assert.equal(body.has('file'), true)
        return Response.json({
          secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/a.webp',
          public_id: 'diwali/products/P001/1',
        })
      },
      now: () => 1_700_000_000_000,
    })
    assert.equal(res.ok, true)
    assert.ok(!JSON.stringify(res).includes('secret'))
  })

  it('checkpoints map after each successful upload', async () => {
    const mapCheckpoint = path.join(tmp, 'checkpoint.json')
    const local1 = writeProduct('c1.webp')
    const local2 = writeProduct('c2.webp')
    const manifest = parseMigrationManifest(
      baseManifest(
        [
          {
            uploadTaskId: 't1',
            cataloguePath: '/images/products/c1.webp',
            localFilePath: local1,
            canonicalCloudinaryPublicId: 'P001/1',
          },
          {
            uploadTaskId: 't2',
            cataloguePath: '/images/products/c2.webp',
            localFilePath: local2,
            canonicalCloudinaryPublicId: 'P002/1',
          },
        ],
        [
          {
            productId: 'P001',
            slot: 1,
            cataloguePath: '/images/products/c1.webp',
            localFilePath: local1,
            uploadTaskId: 't1',
            cloudinaryPublicId: 'P001/1',
          },
          {
            productId: 'P002',
            slot: 1,
            cataloguePath: '/images/products/c2.webp',
            localFilePath: local2,
            uploadTaskId: 't2',
            cloudinaryPublicId: 'P002/1',
          },
        ],
      ),
    ).manifest

    let call = 0
    await runCloudinaryMigrationUpload({
      manifest,
      repoRoot,
      map: loadUploadMap(mapCheckpoint).map,
      mapPath: mapCheckpoint,
      execute: true,
      force: false,
      env,
      fetchImpl: async () => {
        call += 1
        if (call === 1) {
          return Response.json({
            secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/c1.webp',
            public_id: 'diwali/products/P001/1',
          })
        }
        return Response.json({ error: { message: 'fail' } }, { status: 500 })
      },
    })

    const partial = loadUploadMap(mapCheckpoint).map
    assert.equal(Object.keys(partial.byCataloguePath).length, 1)
    assert.ok(partial.byCataloguePath['/images/products/c1.webp'])
  })
})
