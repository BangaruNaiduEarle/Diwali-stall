/**
 * Validate Phase 3C migration manifest before upload (Phase 3D).
 */
import fs from 'node:fs'
import path from 'node:path'

export const MANIFEST_SCHEMA_VERSION = 1

/**
 * @param {unknown} raw
 * @returns {{ ok: true, manifest: import('./cloudinaryMigrationManifest.js').MigrationManifest } | { ok: false, errors: string[] }}
 */
export function parseMigrationManifest(raw) {
  /** @type {string[]} */
  const errors = []
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['manifest must be a JSON object'] }
  }
  /** @type {Record<string, unknown>} */
  const obj = raw
  const uploadTasks = obj.uploadTasks
  const entries = obj.entries
  if (!Array.isArray(uploadTasks)) errors.push('uploadTasks must be an array')
  if (!Array.isArray(entries)) errors.push('entries must be an array')
  if (errors.length) return { ok: false, errors }

  /** @type {Map<string, Record<string, unknown>>} */
  const taskById = new Map()
  /** @type {Set<string>} */
  const taskPaths = new Set()

  for (const [i, task] of uploadTasks.entries()) {
    if (!task || typeof task !== 'object') {
      errors.push(`uploadTasks[${i}] must be an object`)
      continue
    }
    const t = /** @type {Record<string, unknown>} */ (task)
    const uploadTaskId = String(t.uploadTaskId ?? '').trim()
    const cataloguePath = String(t.cataloguePath ?? '').trim()
    const localFilePath = String(t.localFilePath ?? '').trim()
    const canonicalCloudinaryPublicId = String(t.canonicalCloudinaryPublicId ?? '').trim()
    if (!uploadTaskId) errors.push(`uploadTasks[${i}].uploadTaskId is required`)
    if (!cataloguePath.startsWith('/images/products/')) {
      errors.push(`uploadTasks[${i}].cataloguePath must be under /images/products/`)
    }
    if (localFilePath.includes('..')) {
      errors.push(`uploadTasks[${i}].localFilePath must not contain ..`)
    }
    if (!localFilePath) errors.push(`uploadTasks[${i}].localFilePath is required`)
    if (!canonicalCloudinaryPublicId) {
      errors.push(`uploadTasks[${i}].canonicalCloudinaryPublicId is required`)
    }
    if (uploadTaskId && taskById.has(uploadTaskId)) {
      errors.push(`duplicate uploadTaskId: ${uploadTaskId}`)
    }
    if (uploadTaskId) taskById.set(uploadTaskId, t)
    if (cataloguePath) taskPaths.add(cataloguePath)
  }

  for (const [i, entry] of entries.entries()) {
    if (!entry || typeof entry !== 'object') {
      errors.push(`entries[${i}] must be an object`)
      continue
    }
    const e = /** @type {Record<string, unknown>} */ (entry)
    const uploadTaskId = String(e.uploadTaskId ?? '').trim()
    const cataloguePath = String(e.cataloguePath ?? '').trim()
    const productId = String(e.productId ?? '').trim()
    const slot = Number(e.slot)
    if (!productId) errors.push(`entries[${i}].productId is required`)
    if (!Number.isInteger(slot) || slot < 1) errors.push(`entries[${i}].slot must be a positive integer`)
    if (!uploadTaskId || !taskById.has(uploadTaskId)) {
      errors.push(`entries[${i}] references unknown uploadTaskId: ${uploadTaskId || '(empty)'}`)
    }
    const task = taskById.get(uploadTaskId)
    if (task && cataloguePath && String(task.cataloguePath) !== cataloguePath) {
      errors.push(
        `entries[${i}] cataloguePath does not match upload task ${uploadTaskId}`,
      )
    }
    if (cataloguePath && !taskPaths.has(cataloguePath)) {
      errors.push(`entries[${i}] cataloguePath is not listed in uploadTasks`)
    }
  }

  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    manifest: {
      generatedAt: String(obj.generatedAt ?? ''),
      dryRun: Boolean(obj.dryRun),
      cloudinaryFolder: String(obj.cloudinaryFolder ?? 'diwali/products'),
      uploadTaskCount: uploadTasks.length,
      entryCount: entries.length,
      uploadTasks: /** @type {MigrationUploadTask[]} */ (uploadTasks),
      entries: /** @type {MigrationManifestEntry[]} */ (entries),
      sharedUploadPlans: Array.isArray(obj.sharedUploadPlans)
        ? /** @type {MigrationSharedUploadPlan[]} */ (obj.sharedUploadPlans)
        : [],
    },
  }
}

/**
 * @param {string} manifestPath
 * @param {string} repoRoot
 */
export function loadMigrationManifest(manifestPath, repoRoot) {
  const abs = path.resolve(manifestPath)
  if (!fs.existsSync(abs)) {
    return { ok: false, errors: [`manifest not found: ${abs}`] }
  }
  const parsed = parseMigrationManifest(JSON.parse(fs.readFileSync(abs, 'utf8')))
  if (!parsed.ok) return parsed
  return { ok: true, manifest: parsed.manifest, manifestPath: abs, repoRoot: path.resolve(repoRoot) }
}

/**
 * @typedef {Object} MigrationUploadTask
 * @property {string} uploadTaskId
 * @property {string} cataloguePath
 * @property {string} localFilePath
 * @property {string} cloudinaryFolder
 * @property {string} canonicalCloudinaryPublicId
 * @property {string} [canonicalProductId]
 * @property {number} [canonicalSlot]
 * @property {boolean} [sharedAcrossProducts]
 * @property {string[]} [productIds]
 * @property {{ productId: string, slot: number }[]} [references]
 */

/**
 * @typedef {Object} MigrationManifestEntry
 * @property {string} productId
 * @property {number} slot
 * @property {string} cataloguePath
 * @property {string} localFilePath
 * @property {string} uploadTaskId
 * @property {string} cloudinaryPublicId
 * @property {boolean} [isCanonicalUpload]
 * @property {boolean} [eligibleForAutomatedUpload]
 * @property {boolean} [sharedLocalFile]
 * @property {{ productId: string, slot: number, cloudinaryPublicId: string }} [reusesCanonicalUploadFrom]
 */

/**
 * @typedef {Object} MigrationSharedUploadPlan
 * @property {string} cataloguePath
 * @property {string[]} productIds
 * @property {boolean} [fileExists]
 * @property {string} canonicalCloudinaryPublicId
 */
