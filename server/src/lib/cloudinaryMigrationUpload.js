/**
 * Phase 3D Cloudinary migration upload runner (dry-run default). No D1 writes.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  signCloudinaryParams,
  readCloudinaryConfig,
  readCloudinaryCloudName,
} from './cloudinarySign.js'
import {
  buildExpectedCloudinaryFullPublicId,
  publicIdMatchesExpected,
  resolveManifestLocalImageFile,
  validateCloudinarySecureUrl,
  validateStoredMappingRecord,
} from './cloudinaryMigrationPathSafety.js'
import {
  getCataloguePathRecord,
  saveUploadMap,
  createEmptyUploadMap,
} from './cloudinaryUploadMapStore.js'

/**
 * @param {unknown} body
 * @param {{ expectedFullPublicId?: string, cloudName?: string }} [opts]
 */
export function parseCloudinaryUploadResponse(body, opts = {}) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'response_not_object' }
  }
  const obj = /** @type {Record<string, unknown>} */ (body)
  if (obj.error) {
    return { ok: false, error: 'cloudinary_error', message: String(obj.error) }
  }
  const publicId = String(obj.public_id ?? '').trim()
  if (!publicId) {
    return { ok: false, error: 'missing_public_id' }
  }
  const cloudName = String(opts.cloudName ?? '').trim()
  if (!cloudName) {
    return { ok: false, error: 'cloud_name_not_configured' }
  }
  const urlCheck = validateCloudinarySecureUrl(String(obj.secure_url ?? ''), cloudName)
  if (!urlCheck.ok) {
    return { ok: false, error: urlCheck.error }
  }
  if (opts.expectedFullPublicId) {
    if (!publicIdMatchesExpected(publicId, opts.expectedFullPublicId)) {
      return { ok: false, error: 'unexpected_public_id', publicId }
    }
  }
  return { ok: true, secureUrl: urlCheck.secureUrl, publicId, raw: obj }
}

/**
 * @param {import('./cloudinaryMigrationManifest.js').MigrationManifestEntry[]} entries
 * @param {string} cataloguePath
 */
function applyManifestEntriesForCataloguePath(map, entries, cataloguePath) {
  for (const entry of entries) {
    if (entry.cataloguePath !== cataloguePath) continue
    const record = getCataloguePathRecord(map, cataloguePath)
    if (!record) continue
    const slotKey = `${entry.productId}/${entry.slot}`
    map.byProductSlot[slotKey] = {
      productId: entry.productId,
      slot: entry.slot,
      cataloguePath,
      secureUrl: record.secureUrl,
      cloudinaryPublicId: entry.cloudinaryPublicId,
      ...(entry.reusesCanonicalUploadFrom
        ? { reusesCanonicalPublicId: entry.reusesCanonicalUploadFrom.cloudinaryPublicId }
        : {}),
    }
  }
  return map
}

/**
 * Server-side signed upload (Node or Worker). apiSecret stays in this process only.
 * @param {{
 *   config: { cloudName: string, apiKey: string, apiSecret: string },
 *   absoluteFilePath: string,
 *   folder: string,
 *   publicId: string,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 * }} opts
 */
export async function uploadLocalFileToCloudinary(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? (() => Date.now())
  const expectedFullPublicId = buildExpectedCloudinaryFullPublicId(opts.folder, opts.publicId)

  const timestamp = Math.floor(now() / 1000)
  const paramsToSign = {
    folder: opts.folder,
    overwrite: true,
    public_id: opts.publicId,
    timestamp,
  }
  const signature = await signCloudinaryParams(paramsToSign, opts.config.apiSecret)

  const form = new FormData()
  form.append('file', new Blob([fs.readFileSync(opts.absoluteFilePath)]), path.basename(opts.absoluteFilePath))
  form.append('api_key', opts.config.apiKey)
  form.append('timestamp', String(timestamp))
  form.append('signature', signature)
  form.append('folder', opts.folder)
  form.append('public_id', opts.publicId)
  form.append('overwrite', 'true')

  const url = `https://api.cloudinary.com/v1_1/${opts.config.cloudName}/image/upload`
  let response
  try {
    response = await fetchImpl(url, { method: 'POST', body: form })
  } catch (err) {
    return {
      ok: false,
      error: 'network_error',
      message: err instanceof Error ? err.message : String(err),
    }
  }

  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    return {
      ok: false,
      error: 'invalid_json_response',
      httpStatus: response.status,
      bodyPreview: text.slice(0, 200),
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      error: 'http_error',
      httpStatus: response.status,
      cloudinary: parseCloudinaryUploadResponse(json, {
        expectedFullPublicId,
        cloudName: opts.config.cloudName,
      }),
    }
  }

  const parsed = parseCloudinaryUploadResponse(json, {
    expectedFullPublicId,
    cloudName: opts.config.cloudName,
  })
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, httpStatus: response.status, cloudinary: parsed }
  }
  return { ok: true, secureUrl: parsed.secureUrl, publicId: parsed.publicId }
}

/**
 * @param {import('./cloudinaryMigrationManifest.js').MigrationManifest} manifest
 * @param {import('./cloudinaryUploadMapStore.js').CloudinaryUploadMap} map
 * @param {import('./cloudinaryMigrationManifest.js').MigrationManifestEntry[]} entries
 */
export function applyManifestEntriesToMap(manifest, map, entries) {
  for (const entry of entries) {
    applyManifestEntriesForCataloguePath(map, entries, entry.cataloguePath)
  }
  return map
}

/**
 * @param {{
 *   manifest: import('./cloudinaryMigrationManifest.js').MigrationManifest,
 *   repoRoot: string,
 *   map: import('./cloudinaryUploadMapStore.js').CloudinaryUploadMap,
 *   mapPath: string,
 *   execute: boolean,
 *   force: boolean,
 *   env: Record<string, unknown>,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 *   saveMap?: typeof saveUploadMap,
 * }} opts
 */
export async function runCloudinaryMigrationUpload(opts) {
  const fetchImpl = opts.fetchImpl
  const persistMap = opts.saveMap ?? saveUploadMap
  const tasks = [...opts.manifest.uploadTasks].sort((a, b) =>
    a.uploadTaskId.localeCompare(b.uploadTaskId),
  )

  /** @type {import('./cloudinaryMigrationUpload.js').UploadRunReport} */
  const report = {
    dryRun: !opts.execute,
    execute: opts.execute,
    force: opts.force,
    startedAt: new Date().toISOString(),
    summary: {
      uploadTasksInManifest: tasks.length,
      wouldUpload: 0,
      uploaded: 0,
      skippedAlreadyMapped: 0,
      skippedMissingLocalFile: 0,
      rejectedUnsafeLocalPath: 0,
      rejectedInvalidStoredMapping: 0,
      failed: 0,
    },
    tasks: [],
    mapPath: opts.mapPath,
  }

  const configuredCloudName = readCloudinaryCloudName(opts.env)

  let config = null
  if (opts.execute) {
    config = readCloudinaryConfig(opts.env)
    if (!config) {
      return {
        ok: false,
        error: 'cloudinary_not_configured',
        message: 'Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET (e.g. server/.dev.vars).',
        report,
      }
    }
  }

  const map = opts.map ?? createEmptyUploadMap()

  for (const task of tasks) {
    const folder = task.cloudinaryFolder || opts.manifest.cloudinaryFolder
    const existing = getCataloguePathRecord(map, task.cataloguePath)
    /** @type {import('./cloudinaryMigrationUpload.js').UploadTaskRunResult} */
    const row = {
      uploadTaskId: task.uploadTaskId,
      cataloguePath: task.cataloguePath,
      localFilePath: task.localFilePath,
      canonicalCloudinaryPublicId: task.canonicalCloudinaryPublicId,
      sharedAcrossProducts: Boolean(task.sharedAcrossProducts),
      status: 'pending',
    }

    const resolved = resolveManifestLocalImageFile(task, opts.repoRoot)
    if (!resolved.ok) {
      if (resolved.error === 'missing_local_file') {
        row.status = 'skipped_missing_local_file'
        report.summary.skippedMissingLocalFile += 1
      } else {
        row.status = 'rejected_unsafe_local_path'
        row.error = resolved.error
        report.summary.rejectedUnsafeLocalPath += 1
      }
      report.tasks.push(row)
      continue
    }

    const absoluteFilePath = resolved.absolutePath

    if (existing && !opts.force) {
      const stored = validateStoredMappingRecord(
        existing,
        {
          cataloguePath: task.cataloguePath,
          localFilePath: task.localFilePath,
          uploadTaskId: task.uploadTaskId,
          canonicalCloudinaryPublicId: task.canonicalCloudinaryPublicId,
          cloudinaryFolder: folder,
        },
        configuredCloudName ?? '',
      )
      if (stored.ok) {
        row.status = 'skipped_already_mapped'
        row.secureUrl = stored.secureUrl
        report.summary.skippedAlreadyMapped += 1
        report.tasks.push(row)
        continue
      }
      row.details = { storedMappingError: stored.error }
      report.summary.rejectedInvalidStoredMapping += 1
    }

    if (!opts.execute) {
      row.status = 'would_upload'
      report.summary.wouldUpload += 1
      report.tasks.push(row)
      continue
    }

    const publicId = task.canonicalCloudinaryPublicId
    const result = await uploadLocalFileToCloudinary({
      config: /** @type {{ cloudName: string, apiKey: string, apiSecret: string }} */ (config),
      absoluteFilePath,
      folder,
      publicId,
      fetchImpl,
      now: opts.now,
    })

    if (!result.ok) {
      row.status = 'failed'
      row.error = result.error
      row.details = { ...(row.details ?? {}), ...result }
      delete row.details.ok
      report.summary.failed += 1
      report.tasks.push(row)
      continue
    }

    map.byCataloguePath[task.cataloguePath] = {
      cataloguePath: task.cataloguePath,
      localFilePath: task.localFilePath,
      uploadTaskId: task.uploadTaskId,
      canonicalCloudinaryPublicId: task.canonicalCloudinaryPublicId,
      cloudinaryPublicId: result.publicId,
      secureUrl: result.secureUrl,
      uploadedAt: new Date().toISOString(),
    }
    applyManifestEntriesForCataloguePath(map, opts.manifest.entries, task.cataloguePath)
    persistMap(opts.mapPath, map)

    row.status = 'uploaded'
    row.secureUrl = result.secureUrl
    report.summary.uploaded += 1
    report.tasks.push(row)
  }

  applyManifestEntriesToMap(opts.manifest, map, opts.manifest.entries)

  report.finishedAt = new Date().toISOString()
  report.summary.productSlotsMapped = Object.keys(map.byProductSlot).length
  report.ok = report.summary.failed === 0

  return { ok: report.summary.failed === 0, report, map }
}

/**
 * @typedef {Object} UploadTaskRunResult
 * @property {string} uploadTaskId
 * @property {string} cataloguePath
 * @property {string} localFilePath
 * @property {string} canonicalCloudinaryPublicId
 * @property {boolean} [sharedAcrossProducts]
 * @property {string} status
 * @property {string} [secureUrl]
 * @property {string} [error]
 * @property {Record<string, unknown>} [details]
 */

/**
 * @typedef {Object} UploadRunReport
 * @property {boolean} dryRun
 * @property {boolean} execute
 * @property {boolean} force
 * @property {string} startedAt
 * @property {string} [finishedAt]
 * @property {boolean} [ok]
 * @property {string} mapPath
 * @property {Record<string, number>} summary
 * @property {UploadTaskRunResult[]} tasks
 */
