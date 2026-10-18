/**
 * Path confinement for Phase 3D manifest uploads.
 */
import fs from 'node:fs'
import path from 'node:path'
import { cataloguePathToPublicFile } from './cloudinaryMigrationAudit.js'

export const ALLOWED_IMAGE_EXTENSIONS = new Set(['.webp', '.jpg', '.jpeg', '.png', '.gif'])

/**
 * @param {string} repoRoot
 */
export function getProductImagesRoot(repoRoot) {
  return path.resolve(repoRoot, 'public', 'images', 'products')
}

/**
 * @param {string} absolutePath
 * @param {string} allowedRoot
 */
export function isPathInsideRoot(absolutePath, allowedRoot) {
  const resolved = path.resolve(absolutePath)
  const root = path.resolve(allowedRoot)
  const rel = path.relative(root, resolved)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * @param {string} hostname
 */
export function isApprovedCloudinaryDeliveryHost(hostname) {
  const h = String(hostname ?? '').trim().toLowerCase()
  if (h === 'res.cloudinary.com') return true
  return /^res-\d+\.cloudinary\.com$/.test(h)
}

/**
 * Cloudinary delivery URLs: /{cloud_name}/image/upload/...
 * @param {string} pathname
 * @param {string} cloudName
 */
export function validateCloudinaryDeliveryPathname(pathname, cloudName) {
  const expectedCloud = String(cloudName ?? '').trim()
  if (!expectedCloud) {
    return { ok: false, error: 'cloud_name_not_configured' }
  }
  const parts = String(pathname ?? '')
    .split('/')
    .filter(Boolean)
  if (parts.length < 3) {
    return { ok: false, error: 'malformed_delivery_path' }
  }
  if (parts[0] !== expectedCloud) {
    return { ok: false, error: 'cloud_name_mismatch' }
  }
  if (parts[1] !== 'image') {
    return { ok: false, error: 'unexpected_resource_type' }
  }
  if (parts[2] !== 'upload') {
    return { ok: false, error: 'malformed_delivery_path' }
  }
  return { ok: true }
}

/**
 * @param {string} secureUrl
 * @param {string} cloudName configured CLOUDINARY_CLOUD_NAME
 */
export function validateCloudinarySecureUrl(secureUrl, cloudName) {
  let url
  try {
    url = new URL(String(secureUrl ?? '').trim())
  } catch {
    return { ok: false, error: 'invalid_secure_url' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'insecure_delivery_url' }
  }
  if (!isApprovedCloudinaryDeliveryHost(url.hostname)) {
    return { ok: false, error: 'unapproved_delivery_host' }
  }
  const pathCheck = validateCloudinaryDeliveryPathname(url.pathname, cloudName)
  if (!pathCheck.ok) {
    return { ok: false, error: pathCheck.error }
  }
  return { ok: true, secureUrl: url.toString() }
}

/**
 * Cloudinary full public_id when uploading with folder + public_id params.
 * @param {string} folder
 * @param {string} canonicalPublicId
 */
export function buildExpectedCloudinaryFullPublicId(folder, canonicalPublicId) {
  const f = String(folder ?? '').trim().replace(/\/+$/, '')
  const id = String(canonicalPublicId ?? '').trim().replace(/^\/+/, '')
  return `${f}/${id}`
}

/**
 * @param {string} returnedPublicId
 * @param {string} expectedFullPublicId
 */
export function publicIdMatchesExpected(returnedPublicId, expectedFullPublicId) {
  const a = String(returnedPublicId ?? '').trim().replace(/^\/+/, '')
  const b = String(expectedFullPublicId ?? '').trim().replace(/^\/+/, '')
  return a === b
}

/**
 * @param {{
 *   cataloguePath: string,
 *   localFilePath: string,
 *   uploadTaskId?: string,
 *   canonicalCloudinaryPublicId?: string,
 * }} task
 * @param {string} repoRoot
 */
export function resolveManifestLocalImageFile(task, repoRoot) {
  const publicRoot = path.resolve(repoRoot, 'public')
  const allowedRoot = getProductImagesRoot(repoRoot)
  const cataloguePath = String(task.cataloguePath ?? '').trim()
  const localFilePath = String(task.localFilePath ?? '').trim()

  if (!cataloguePath.startsWith('/images/products/')) {
    return { ok: false, error: 'catalogue_path_outside_products' }
  }

  const fromCatalogue = cataloguePathToPublicFile(cataloguePath, publicRoot)
  if (!fromCatalogue.ok) {
    return { ok: false, error: 'invalid_catalogue_path', reason: fromCatalogue.reason }
  }

  if (localFilePath.includes('..') || path.isAbsolute(localFilePath)) {
    return { ok: false, error: 'unsafe_local_file_path' }
  }

  const resolvedLocal = path.resolve(repoRoot, localFilePath)
  if (!isPathInsideRoot(resolvedLocal, allowedRoot)) {
    return { ok: false, error: 'local_file_outside_products_dir' }
  }

  const ext = path.extname(resolvedLocal).toLowerCase()
  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    return { ok: false, error: 'unsupported_image_extension', extension: ext }
  }

  if (path.resolve(fromCatalogue.absolutePath) !== resolvedLocal) {
    return { ok: false, error: 'local_path_catalogue_mismatch' }
  }

  if (!fs.existsSync(resolvedLocal)) {
    return { ok: false, error: 'missing_local_file' }
  }

  let realFile
  let realAllowed
  try {
    realFile = fs.realpathSync.native
      ? fs.realpathSync.native(resolvedLocal)
      : fs.realpathSync(resolvedLocal)
    realAllowed = fs.realpathSync.native
      ? fs.realpathSync.native(allowedRoot)
      : fs.realpathSync(allowedRoot)
  } catch {
    return { ok: false, error: 'realpath_failed' }
  }

  if (!isPathInsideRoot(realFile, realAllowed)) {
    return { ok: false, error: 'symlink_escapes_products_dir' }
  }

  return {
    ok: true,
    absolutePath: realFile,
    cataloguePath,
    localFilePath,
  }
}

/**
 * @param {import('./cloudinaryUploadMapStore.js').CataloguePathUploadRecord} record
 * @param {{
 *   cataloguePath: string,
 *   localFilePath: string,
 *   uploadTaskId: string,
 *   canonicalCloudinaryPublicId: string,
 *   cloudinaryFolder: string,
 * }} task
 * @param {string} cloudName
 */
export function validateStoredMappingRecord(record, task, cloudName) {
  if (!record || typeof record !== 'object') {
    return { ok: false, error: 'missing_record' }
  }
  if (record.cataloguePath !== task.cataloguePath) {
    return { ok: false, error: 'catalogue_path_mismatch' }
  }
  if (record.localFilePath !== task.localFilePath) {
    return { ok: false, error: 'local_file_path_mismatch' }
  }
  if (record.uploadTaskId !== task.uploadTaskId) {
    return { ok: false, error: 'upload_task_id_mismatch' }
  }
  if (record.canonicalCloudinaryPublicId !== task.canonicalCloudinaryPublicId) {
    return { ok: false, error: 'canonical_public_id_mismatch' }
  }
  const urlCheck = validateCloudinarySecureUrl(record.secureUrl, cloudName)
  if (!urlCheck.ok) {
    return { ok: false, error: urlCheck.error }
  }
  const expectedFull = buildExpectedCloudinaryFullPublicId(
    task.cloudinaryFolder,
    task.canonicalCloudinaryPublicId,
  )
  const returned = record.cloudinaryPublicId ?? expectedFull
  if (!publicIdMatchesExpected(returned, expectedFull)) {
    return { ok: false, error: 'stored_public_id_mismatch' }
  }
  if (!record.uploadedAt) {
    return { ok: false, error: 'missing_uploaded_at' }
  }
  return { ok: true, secureUrl: urlCheck.secureUrl }
}
