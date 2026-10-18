/**
 * Durable catalogue-path → Cloudinary URL mapping for idempotent uploads (Phase 3D).
 */
import fs from 'node:fs'
import path from 'node:path'

export const UPLOAD_MAP_VERSION = 1

/** @returns {import('./cloudinaryUploadMapStore.js').CloudinaryUploadMap} */
export function createEmptyUploadMap() {
  return {
    version: UPLOAD_MAP_VERSION,
    updatedAt: null,
    byCataloguePath: {},
    byProductSlot: {},
  }
}

/**
 * @param {unknown} raw
 */
export function parseUploadMap(raw) {
  if (!raw || typeof raw !== 'object') return createEmptyUploadMap()
  const obj = /** @type {Record<string, unknown>} */ (raw)
  return {
    version: Number(obj.version) || UPLOAD_MAP_VERSION,
    updatedAt: obj.updatedAt ? String(obj.updatedAt) : null,
    byCataloguePath:
      obj.byCataloguePath && typeof obj.byCataloguePath === 'object'
        ? /** @type {Record<string, CataloguePathUploadRecord>} */ (obj.byCataloguePath)
        : {},
    byProductSlot:
      obj.byProductSlot && typeof obj.byProductSlot === 'object'
        ? /** @type {Record<string, ProductSlotUploadRecord>} */ (obj.byProductSlot)
        : {},
  }
}

/**
 * @param {string} mapPath
 */
export function loadUploadMap(mapPath) {
  const abs = path.resolve(mapPath)
  if (!fs.existsSync(abs)) {
    return { map: createEmptyUploadMap(), mapPath: abs, exists: false }
  }
  const map = parseUploadMap(JSON.parse(fs.readFileSync(abs, 'utf8')))
  return { map, mapPath: abs, exists: true }
}

/**
 * Atomic write: temp file in same directory, then rename. Prior file kept on failure.
 * @param {string} mapPath
 * @param {import('./cloudinaryUploadMapStore.js').CloudinaryUploadMap} map
 */
export function saveUploadMap(mapPath, map) {
  const abs = path.resolve(mapPath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const payload = {
    ...map,
    updatedAt: new Date().toISOString(),
  }
  const content = `${JSON.stringify(payload, null, 2)}\n`
  const tmp = path.join(
    path.dirname(abs),
    `.${path.basename(abs)}.${process.pid}.${Date.now()}.tmp`,
  )
  fs.writeFileSync(tmp, content, 'utf8')
  try {
    fs.renameSync(tmp, abs)
  } catch (err) {
    try {
      fs.unlinkSync(tmp)
    } catch {
      // ignore cleanup failure
    }
    throw err
  }
  return payload
}

/**
 * @param {import('./cloudinaryUploadMapStore.js').CloudinaryUploadMap} map
 * @param {string} cataloguePath
 */
export function getCataloguePathRecord(map, cataloguePath) {
  return map.byCataloguePath[cataloguePath] ?? null
}

/**
 * @typedef {Object} CataloguePathUploadRecord
 * @property {string} cataloguePath
 * @property {string} localFilePath
 * @property {string} uploadTaskId
 * @property {string} canonicalCloudinaryPublicId
 * @property {string} secureUrl
 * @property {string} [cloudinaryPublicId]
 * @property {string} uploadedAt
 */

/**
 * @typedef {Object} ProductSlotUploadRecord
 * @property {string} productId
 * @property {number} slot
 * @property {string} cataloguePath
 * @property {string} secureUrl
 * @property {string} cloudinaryPublicId
 * @property {string} [reusesCanonicalPublicId]
 */

/**
 * @typedef {Object} CloudinaryUploadMap
 * @property {number} version
 * @property {string | null} updatedAt
 * @property {Record<string, CataloguePathUploadRecord>} byCataloguePath
 * @property {Record<string, ProductSlotUploadRecord>} byProductSlot
 */
