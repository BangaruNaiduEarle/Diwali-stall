/**
 * Read-only Cloudinary migration audit (Phase 3C). No network, D1, or uploads.
 */
import fs from 'node:fs'
import path from 'node:path'
import { buildProductUploadTarget, CLOUDINARY_PRODUCT_FOLDER } from './cloudinarySign.js'

export const PRODUCT_IMAGES_PUBLIC_PREFIX = '/images/products/'
const IMAGE_EXT = new Set(['.webp', '.jpg', '.jpeg', '.png', '.gif'])

/**
 * Map site catalogue path to absolute file under `public/`.
 * Exact path only — no filename guessing.
 * @param {string} cataloguePath
 * @param {string} publicRoot absolute path to repo `public/`
 */
export function cataloguePathToPublicFile(cataloguePath, publicRoot) {
  const s = String(cataloguePath ?? '').trim()
  if (!s) return { ok: false, reason: 'empty' }
  if (!s.startsWith('/')) return { ok: false, reason: 'not_site_absolute_path' }
  if (s.includes('://') || s.includes('\\') || s.includes('..')) {
    return { ok: false, reason: 'unsafe_path' }
  }
  const rel = s.slice(1).split('/').filter(Boolean)
  if (rel.length === 0) return { ok: false, reason: 'empty' }
  const absolutePath = path.join(publicRoot, ...rel)
  return { ok: true, absolutePath, cataloguePath: s }
}

/** @param {string} absolutePath @param {string} publicRoot */
export function publicFileToCataloguePath(absolutePath, publicRoot) {
  const rel = path.relative(publicRoot, absolutePath).replace(/\\/g, '/')
  if (rel.startsWith('..')) return null
  return `/${rel}`
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
export function listProductImageFilesOnDisk(productImagesDir) {
  const out = []
  if (!fs.existsSync(productImagesDir)) return out

  /** @param {string} current */
  function walk(current) {
    for (const ent of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, ent.name)
      if (ent.isDirectory()) {
        walk(full)
        continue
      }
      if (ent.name.startsWith('.')) continue
      const ext = path.extname(ent.name).toLowerCase()
      if (!IMAGE_EXT.has(ext)) continue
      out.push(full)
    }
  }
  walk(productImagesDir)
  out.sort()
  return out
}

/** Stable id for deduplicated upload tasks (one per local catalogue path). */
export function cataloguePathToUploadTaskId(cataloguePath) {
  return String(cataloguePath ?? '')
    .trim()
    .replace(/^\//, '')
    .replace(/\//g, '--')
}

/**
 * @param {{ productId: string, slot: number }[]} locations
 */
export function pickCanonicalUploadReference(locations) {
  return [...locations].sort((a, b) =>
    a.productId === b.productId ? a.slot - b.slot : a.productId.localeCompare(b.productId),
  )[0]
}

/**
 * One physical file → one Cloudinary upload; product slots may reuse the canonical public ID.
 * @param {Map<string, { productId: string, slot: number, cataloguePath: string, localFilePath: string }[]>} refsByExistingPath
 */
export function buildUploadTasksForExistingPaths(refsByExistingPath) {
  /** @type {Array<Record<string, unknown>>} */
  const tasks = []

  for (const cataloguePath of [...refsByExistingPath.keys()].sort()) {
    const refs = refsByExistingPath.get(cataloguePath) ?? []
    const canonical = pickCanonicalUploadReference(refs)
    const { folder, publicId } = buildProductUploadTarget(canonical.productId, canonical.slot)
    const productIds = [...new Set(refs.map((r) => r.productId))].sort()
    tasks.push({
      uploadTaskId: cataloguePathToUploadTaskId(cataloguePath),
      cataloguePath,
      localFilePath: refs[0]?.localFilePath,
      cloudinaryFolder: folder,
      canonicalCloudinaryPublicId: publicId,
      canonicalProductId: canonical.productId,
      canonicalSlot: canonical.slot,
      sharedAcrossProducts: productIds.length > 1,
      productIds,
      references: refs
        .map((r) => ({ productId: r.productId, slot: r.slot }))
        .sort((a, b) =>
          a.productId === b.productId ? a.slot - b.slot : a.productId.localeCompare(b.productId),
        ),
    })
  }

  return tasks
}

/**
 * @param {Array<{ id: string, images?: string[] }>} products
 * @param {{ publicRoot: string, repoRoot: string, productImagesDir?: string }} opts
 */
export function buildCloudinaryMigrationAudit(products, opts) {
  const publicRoot = path.resolve(opts.publicRoot)
  const repoRoot = path.resolve(opts.repoRoot)
  const productImagesDir =
    opts.productImagesDir ?? path.join(publicRoot, 'images', 'products')

  /** @type {Array<{ productId: string, slot: number, cataloguePath: string }>} */
  const allReferences = []
  /** @type {string[]} */
  const emptyImageProductIds = []

  for (const product of products) {
    const productId = String(product.id ?? '').trim()
    const images = Array.isArray(product.images) ? product.images : []
    if (images.length === 0) {
      emptyImageProductIds.push(productId)
      continue
    }
    images.forEach((raw, index) => {
      allReferences.push({
        productId,
        slot: index + 1,
        cataloguePath: String(raw ?? '').trim(),
      })
    })
  }

  emptyImageProductIds.sort()

  /** @type {Map<string, { productId: string, slot: number }[]>} */
  const refsByPath = new Map()
  for (const ref of allReferences) {
    const key = ref.cataloguePath
    if (!refsByPath.has(key)) refsByPath.set(key, [])
    refsByPath.get(key).push({ productId: ref.productId, slot: ref.slot })
  }

  const duplicateReferences = [...refsByPath.entries()]
    .filter(([, locs]) => locs.length > 1)
    .map(([cataloguePath, locations]) => ({
      cataloguePath,
      locations: locations.sort((a, b) =>
        a.productId === b.productId ? a.slot - b.slot : a.productId.localeCompare(b.productId),
      ),
    }))
    .sort((a, b) => a.cataloguePath.localeCompare(b.cataloguePath))

  const sharedAcrossProducts = duplicateReferences
    .filter(({ locations }) => new Set(locations.map((l) => l.productId)).size > 1)
    .map(({ cataloguePath, locations }) => ({
      cataloguePath,
      productIds: [...new Set(locations.map((l) => l.productId))].sort(),
      locations,
    }))

  const sharedPathSet = new Set(sharedAcrossProducts.map((s) => s.cataloguePath))

  /** @type {string[]} */
  const missingReferencedFiles = []
  /** @type {string[]} */
  const existingReferencedFiles = []
  /** @type {Array<Record<string, unknown>>} */
  const manifest = []
  /** @type {string[]} */
  const nonLocalReferences = []
  /** @type {string[]} */
  const invalidReferences = []

  /** @type {Map<string, { productId: string, slot: number, cataloguePath: string, localFilePath: string }[]>} */
  const refsByExistingPath = new Map()

  const sortedRefs = [...allReferences].sort((a, b) =>
    a.productId === b.productId
      ? a.slot - b.slot
      : a.productId.localeCompare(b.productId),
  )

  for (const ref of sortedRefs) {
    const { cataloguePath, productId, slot } = ref
    if (cataloguePath.startsWith('http://') || cataloguePath.startsWith('https://')) {
      nonLocalReferences.push(cataloguePath)
      continue
    }
    const mapped = cataloguePathToPublicFile(cataloguePath, publicRoot)
    if (!mapped.ok) {
      invalidReferences.push(cataloguePath)
      if (cataloguePath) missingReferencedFiles.push(cataloguePath)
      continue
    }
    const exists = fs.existsSync(mapped.absolutePath)
    if (!exists) {
      missingReferencedFiles.push(cataloguePath)
      continue
    }
    existingReferencedFiles.push(cataloguePath)
    const localFilePath = path.relative(repoRoot, mapped.absolutePath).replace(/\\/g, '/')
    if (!refsByExistingPath.has(cataloguePath)) refsByExistingPath.set(cataloguePath, [])
    refsByExistingPath.get(cataloguePath).push({
      productId,
      slot,
      cataloguePath,
      localFilePath,
    })
  }

  const uploadTasks = buildUploadTasksForExistingPaths(refsByExistingPath)
  /** @type {Map<string, (typeof uploadTasks)[number]>} */
  const taskByPath = new Map(uploadTasks.map((t) => [String(t.cataloguePath), t]))

  for (const ref of sortedRefs) {
    const { cataloguePath, productId, slot } = ref
    if (cataloguePath.startsWith('http://') || cataloguePath.startsWith('https://')) continue
    const mapped = cataloguePathToPublicFile(cataloguePath, publicRoot)
    if (!mapped.ok || !fs.existsSync(mapped.absolutePath)) continue

    const localFilePath = path.relative(repoRoot, mapped.absolutePath).replace(/\\/g, '/')
    const task = taskByPath.get(cataloguePath)
    const shared = sharedPathSet.has(cataloguePath)
    const canonicalPublicId = String(task?.canonicalCloudinaryPublicId ?? '')
    const uploadTaskId = cataloguePathToUploadTaskId(cataloguePath)
    const isCanonicalUpload =
      task?.canonicalProductId === productId && task?.canonicalSlot === slot

    manifest.push({
      productId,
      slot,
      cataloguePath,
      localFilePath,
      uploadTaskId,
      cloudinaryFolder: task?.cloudinaryFolder ?? CLOUDINARY_PRODUCT_FOLDER,
      cloudinaryPublicId: canonicalPublicId,
      perProductCloudinaryPublicId: buildProductUploadTarget(productId, slot).publicId,
      sharedLocalFile: shared,
      isCanonicalUpload,
      eligibleForAutomatedUpload: isCanonicalUpload,
      ...(shared
        ? {
            sharedWithProductIds: sharedAcrossProducts
              .find((s) => s.cataloguePath === cataloguePath)
              ?.productIds.filter((id) => id !== productId),
            reusesCanonicalUploadFrom: isCanonicalUpload
              ? undefined
              : {
                  productId: task?.canonicalProductId,
                  slot: task?.canonicalSlot,
                  cloudinaryPublicId: canonicalPublicId,
                },
          }
        : {}),
    })
  }

  const missingPathSet = new Set(missingReferencedFiles)

  /** Shared paths blocked until the exact catalogue file exists (no filename substitution). */
  const sharedUploadPlans = sharedAcrossProducts.map(({ cataloguePath, productIds, locations }) => {
    const canonical = pickCanonicalUploadReference(locations)
    const { publicId } = buildProductUploadTarget(canonical.productId, canonical.slot)
    return {
      cataloguePath,
      productIds,
      fileExists: !missingPathSet.has(cataloguePath),
      canonicalCloudinaryPublicId: publicId,
      canonicalProductId: canonical.productId,
      canonicalSlot: canonical.slot,
      uploadOnceReuseUrlForAllProducts: true,
    }
  })

  const uniqueExisting = [...new Set(existingReferencedFiles)].sort()
  const uniqueMissing = [...new Set(missingReferencedFiles)].sort()

  const referencedSet = new Set(
    allReferences
      .map((r) => r.cataloguePath)
      .filter((p) => p.startsWith('/') && !p.includes('://')),
  )

  const onDisk = listProductImageFilesOnDisk(productImagesDir)
  const unreferencedOnDisk = onDisk
    .map((abs) => publicFileToCataloguePath(abs, publicRoot))
    .filter((cat) => cat && !referencedSet.has(cat))
    .sort()

  return {
    generatedAt: new Date().toISOString(),
    dryRun: true,
    summary: {
      productCount: products.length,
      totalImageReferences: allReferences.length,
      uniqueReferencedPaths: refsByPath.size,
      existingReferencedFiles: uniqueExisting.length,
      missingReferencedFiles: uniqueMissing.length,
      emptyImageProductIds: emptyImageProductIds.length,
      unreferencedFilesOnDisk: unreferencedOnDisk.length,
      duplicateReferencePaths: duplicateReferences.length,
      sharedLocalFilesAcrossProducts: sharedAcrossProducts.length,
      manifestEntryCount: manifest.length,
      uploadTaskCount: uploadTasks.length,
      sharedUploadTaskCount: uploadTasks.filter((t) => t.sharedAcrossProducts).length,
      automatedUploadCount: manifest.filter((e) => e.eligibleForAutomatedUpload).length,
      cloudinaryFolder: CLOUDINARY_PRODUCT_FOLDER,
    },
    emptyImageProductIds,
    existingReferencedFiles: uniqueExisting,
    missingReferencedFiles: uniqueMissing,
    unreferencedFilesOnDisk: unreferencedOnDisk,
    duplicateReferences,
    sharedAcrossProducts,
    nonLocalReferences: [...new Set(nonLocalReferences)].sort(),
    invalidReferences: [...new Set(invalidReferences)].sort(),
    uploadTasks,
    sharedUploadPlans,
    manifest,
  }
}
