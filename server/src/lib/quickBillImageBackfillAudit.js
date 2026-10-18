/**
 * Phase 1 — read-only audit: D1 `images_json` vs Cloudinary HTTPS mapping (no D1 writes).
 */

const CLOUDINARY_HTTPS_RE = /^https:\/\/res(-\d+)?\.cloudinary\.com\/.+\/image\/upload\/.+/i

/**
 * @param {unknown} imagesJson
 * @returns {string[]}
 */
export function parseImagesJsonArray(imagesJson) {
  if (Array.isArray(imagesJson)) {
    return imagesJson.map((x) => String(x ?? '').trim()).filter(Boolean)
  }
  try {
    const parsed = JSON.parse(String(imagesJson ?? '[]'))
    if (!Array.isArray(parsed)) return []
    return parsed.map((x) => String(x ?? '').trim()).filter(Boolean)
  } catch {
    return []
  }
}

/**
 * @param {string} url
 */
export function isStoredCloudinaryHttpsUrl(url) {
  return CLOUDINARY_HTTPS_RE.test(String(url ?? '').trim())
}

/**
 * @param {{ byCataloguePath?: Record<string, { secureUrl?: string }> }} uploadMapping
 * @param {Record<string, string>} [catalogueByPath]
 */
export function buildCloudinaryPathLookup(uploadMapping, catalogueByPath = {}) {
  /** @type {Map<string, { secureUrl: string, sources: string[] }>} */
  const byPath = new Map()

  for (const [cataloguePath, entry] of Object.entries(uploadMapping?.byCataloguePath ?? {})) {
    const secureUrl = String(entry?.secureUrl ?? '').trim()
    if (!cataloguePath || !secureUrl) continue
    byPath.set(cataloguePath, { secureUrl, sources: ['cloudinary-upload-mapping.json'] })
  }

  for (const [cataloguePath, url] of Object.entries(catalogueByPath)) {
    const secureUrl = String(url ?? '').trim()
    if (!cataloguePath || !secureUrl) continue
    const existing = byPath.get(cataloguePath)
    if (existing) {
      if (existing.secureUrl !== secureUrl) {
        existing.sources.push('catalogueCloudinaryByPath.js:mismatch')
        existing.catalogueModuleUrl = secureUrl
      } else {
        existing.sources.push('catalogueCloudinaryByPath.js')
      }
    } else {
      byPath.set(cataloguePath, { secureUrl, sources: ['catalogueCloudinaryByPath.js-only'] })
    }
  }

  return byPath
}

/**
 * @param {Map<string, { secureUrl: string }>} byPath
 */
export function findDuplicateCloudinaryMappings(byPath) {
  /** @type {Map<string, string[]>} */
  const urlToPaths = new Map()
  /** @type {{ cataloguePath: string, uploadUrl: string, catalogueModuleUrl: string }[]} */
  const pathMismatches = []

  for (const [cataloguePath, meta] of byPath.entries()) {
    const url = meta.secureUrl
    const list = urlToPaths.get(url) ?? []
    list.push(cataloguePath)
    urlToPaths.set(url, list)
    if (meta.catalogueModuleUrl && meta.catalogueModuleUrl !== url) {
      pathMismatches.push({
        cataloguePath,
        uploadUrl: url,
        catalogueModuleUrl: meta.catalogueModuleUrl,
      })
    }
  }

  /** @type {{ secureUrl: string, cataloguePaths: string[] }[]} */
  const duplicateUrls = []
  for (const [secureUrl, cataloguePaths] of urlToPaths.entries()) {
    if (cataloguePaths.length > 1) {
      duplicateUrls.push({ secureUrl, cataloguePaths: [...cataloguePaths].sort() })
    }
  }
  duplicateUrls.sort((a, b) => a.secureUrl.localeCompare(b.secureUrl))

  return { duplicateUrls, pathMismatches }
}

/**
 * Proposed `images_json` after backfill (preview only — not applied).
 * @param {string[]} currentImages
 * @param {Map<string, { secureUrl: string }>} lookup
 */
export function proposeImagesJsonAfterBackfill(currentImages, lookup) {
  /** @type {{ index: number, before: string, after: string, changeType: 'replace_local' | 'unchanged_cloudinary' | 'unchanged_other' }[]} */
  const slotDetails = []
  /** @type {string[]} */
  const proposed = []
  /** @type {string[]} */
  const missingMappingPaths = []

  currentImages.forEach((raw, index) => {
    const before = String(raw).trim()
    if (!before) return

    if (isStoredCloudinaryHttpsUrl(before)) {
      proposed.push(before)
      slotDetails.push({ index, before, after: before, changeType: 'unchanged_cloudinary' })
      return
    }

    const mapped = lookup.get(before)
    if (mapped?.secureUrl) {
      proposed.push(mapped.secureUrl)
      slotDetails.push({ index, before, after: mapped.secureUrl, changeType: 'replace_local' })
      return
    }

    proposed.push(before)
    missingMappingPaths.push(before)
    slotDetails.push({ index, before, after: before, changeType: 'unchanged_other' })
  })

  const wouldChange = slotDetails.some((s) => s.changeType === 'replace_local')
  const hasMissing = missingMappingPaths.length > 0
  const allCloudinary =
    proposed.length > 0 && proposed.every((u) => isStoredCloudinaryHttpsUrl(u)) && !hasMissing

  let productStatus = 'empty'
  if (proposed.length === 0) {
    productStatus = 'empty_images'
  } else if (allCloudinary && wouldChange) {
    productStatus = 'fully_mappable'
  } else if (allCloudinary && !wouldChange) {
    productStatus = 'already_cloudinary'
  } else if (wouldChange && hasMissing) {
    productStatus = 'partially_mappable'
  } else if (hasMissing) {
    productStatus = 'unmatched'
  } else if (!wouldChange) {
    productStatus = 'no_change_needed'
  } else {
    productStatus = 'fully_mappable'
  }

  return {
    proposedImages: proposed,
    slotDetails,
    missingMappingPaths: [...new Set(missingMappingPaths)],
    wouldChange,
    productStatus,
  }
}

/**
 * @param {{ id: string, images_json?: unknown, images?: unknown }[]} products
 * @param {Map<string, { secureUrl: string }>} lookup
 */
export function auditQuickBillImageBackfill(products, lookup) {
  /** @type {Record<string, unknown>[]} */
  const productReports = []
  /** @type {Record<string, unknown>[]} */
  const pathChanges = []
  /** @type {string[]} */
  const unmatchedProductIds = []
  /** @type {string[]} */
  const matchedProductIds = []
  /** @type {string[]} */
  const alreadyCloudinaryProductIds = []
  /** @type {string[]} */
  const emptyProductIds = []

  let totalImageSlots = 0
  let slotsAlreadyCloudinary = 0
  let slotsWouldReplace = 0
  let slotsMissingMapping = 0

  for (const row of products) {
    const productId = String(row.id ?? '').trim()
    const currentImages = parseImagesJsonArray(row.images_json ?? row.images)
    totalImageSlots += currentImages.length

    const proposal = proposeImagesJsonAfterBackfill(currentImages, lookup)

    for (const slot of proposal.slotDetails) {
      if (slot.changeType === 'unchanged_cloudinary') slotsAlreadyCloudinary += 1
      if (slot.changeType === 'replace_local') slotsWouldReplace += 1
      if (slot.changeType === 'unchanged_other') slotsMissingMapping += 1
    }

    if (proposal.productStatus === 'empty_images') emptyProductIds.push(productId)
    else if (proposal.productStatus === 'already_cloudinary') alreadyCloudinaryProductIds.push(productId)
    else if (proposal.productStatus === 'unmatched') unmatchedProductIds.push(productId)
    else if (
      proposal.productStatus === 'fully_mappable' ||
      proposal.productStatus === 'partially_mappable'
    ) {
      matchedProductIds.push(productId)
    }

    for (const slot of proposal.slotDetails) {
      if (slot.changeType !== 'replace_local') continue
      pathChanges.push({
        productId,
        slotIndex: slot.index,
        before: slot.before,
        after: slot.after,
      })
    }

    productReports.push({
      productId,
      productStatus: proposal.productStatus,
      currentImages,
      proposedImages: proposal.proposedImages,
      missingMappingPaths: proposal.missingMappingPaths,
      wouldChange: proposal.wouldChange,
      slotDetails: proposal.slotDetails,
    })
  }

  productReports.sort((a, b) => String(a.productId).localeCompare(String(b.productId)))

  return {
    summary: {
      productCount: products.length,
      totalImageSlots,
      slotsAlreadyCloudinary,
      slotsWouldReplace,
      slotsMissingMapping,
      productsFullyOrPartiallyMappable: matchedProductIds.length,
      productsUnmatched: unmatchedProductIds.length,
      productsAlreadyCloudinary: alreadyCloudinaryProductIds.length,
      productsEmptyImages: emptyProductIds.length,
      pathChangesCount: pathChanges.length,
    },
    matchedProductIds: [...matchedProductIds].sort(),
    unmatchedProductIds: [...unmatchedProductIds].sort(),
    alreadyCloudinaryProductIds: [...alreadyCloudinaryProductIds].sort(),
    emptyProductIds: [...emptyProductIds].sort(),
    pathChanges,
    products: productReports,
  }
}
