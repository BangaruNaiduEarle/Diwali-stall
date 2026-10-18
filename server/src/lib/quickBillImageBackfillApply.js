/**
 * Phase 2A — apply audited Cloudinary URLs to D1 `images_json` (local only; pure logic + SQL).
 */
import {
  isStoredCloudinaryHttpsUrl,
  parseImagesJsonArray,
} from './quickBillImageBackfillAudit.js'

export const PRODUCT_NON_IMAGE_COLUMNS = [
  'id',
  'category_slug',
  'name',
  'pack',
  'description',
  'featured',
  'stock_status',
  'active',
  'sort_order',
  'company',
  'selling_price_paise',
  'created_at',
]

/** Unmatched products — must remain unchanged in Phase 2A. */
export const PHASE2A_UNMATCHED_PRODUCT_IDS = ['P006', 'P010', 'P063', 'P124']

/**
 * @param {unknown} auditReport
 */
export function getLocalAuditFromReport(auditReport) {
  const targets = auditReport?.d1Targets
  if (!Array.isArray(targets)) {
    return { ok: false, error: 'invalid_audit', message: 'Audit report missing d1Targets.' }
  }
  const local = targets.find((t) => t?.name === 'local')
  if (!local?.audit?.products) {
    return { ok: false, error: 'invalid_audit', message: 'Audit report missing local target.' }
  }
  return {
    ok: true,
    generatedAt: String(auditReport.generatedAt ?? ''),
    audit: local.audit,
    pathChanges: local.audit.pathChanges ?? [],
  }
}

/**
 * @param {Record<string, unknown>[]} dbRows
 * @param {{ productId: string, currentImages: string[] }[]} auditProducts
 */
export function preflightImagesMatchAudit(dbRows, auditProducts) {
  /** @type {Record<string, Record<string, unknown>>} */
  const byId = new Map(dbRows.map((r) => [String(r.id), r]))
  /** @type {{ productId: string, reason: string, detail?: unknown }[]} */
  const mismatches = []

  if (dbRows.length !== auditProducts.length) {
    mismatches.push({
      productId: '_count',
      reason: 'product_count_mismatch',
      detail: { db: dbRows.length, audit: auditProducts.length },
    })
  }

  for (const ap of auditProducts) {
    const productId = String(ap.productId)
    const row = byId.get(productId)
    if (!row) {
      mismatches.push({ productId, reason: 'missing_row' })
      continue
    }
    const actual = parseImagesJsonArray(row.images_json)
    const expected = ap.currentImages ?? []
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      mismatches.push({
        productId,
        reason: 'images_drift',
        detail: { expected, actual },
      })
    }
  }

  return { ok: mismatches.length === 0, mismatches }
}

/**
 * @param {{ productId: string, wouldChange: boolean, proposedImages: string[], currentImages: string[] }[]} auditProducts
 */
export function buildImageUpdatePlan(auditProducts) {
  return auditProducts
    .filter((p) => p.wouldChange)
    .map((p) => ({
      productId: String(p.productId),
      imagesJson: JSON.stringify(p.proposedImages),
      proposedImages: p.proposedImages,
      currentImages: p.currentImages,
    }))
}

/** @param {string} value */
export function sqlStringLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * @param {Map<string, Record<string, unknown>>} rowsById
 * @param {{ productId: string, imagesJson: string }[]} updatePlan
 */
export function buildApplyTransactionSql(rowsById, updatePlan) {
  /** @type {string[]} */
  const lines = []
  for (const entry of updatePlan) {
    const row = rowsById.get(entry.productId)
    if (!row) {
      throw new Error(`Missing DB row for ${entry.productId}`)
    }
    const beforeRaw = String(row.images_json ?? '[]')
    lines.push(
      `UPDATE products SET images_json = ${sqlStringLiteral(entry.imagesJson)} WHERE id = ${sqlStringLiteral(entry.productId)} AND images_json = ${sqlStringLiteral(beforeRaw)};`,
    )
  }
  return `${lines.join('\n')}\n`
}

/**
 * @param {{ images_json?: unknown }[]} rows
 */
export function countCloudinaryImageSlots(rows) {
  let slots = 0
  for (const row of rows) {
    for (const img of parseImagesJsonArray(row.images_json)) {
      if (isStoredCloudinaryHttpsUrl(img)) slots += 1
    }
  }
  return slots
}

/**
 * @param {Record<string, unknown>} row
 */
export function snapshotNonImageFields(row) {
  /** @type {Record<string, unknown>} */
  const snap = {}
  for (const col of PRODUCT_NON_IMAGE_COLUMNS) {
    snap[col] = row[col]
  }
  return snap
}

/**
 * @param {Record<string, unknown>[]} beforeRows
 * @param {Record<string, unknown>[]} afterRows
 */
export function verifyNonImageFieldsUnchanged(beforeRows, afterRows) {
  const beforeMap = new Map(beforeRows.map((r) => [String(r.id), snapshotNonImageFields(r)]))
  /** @type {{ productId: string, field: string, before: unknown, after: unknown }[]} */
  const diffs = []
  for (const row of afterRows) {
    const id = String(row.id)
    const before = beforeMap.get(id)
    if (!before) {
      diffs.push({ productId: id, field: '_row', before: null, after: 'present' })
      continue
    }
    const after = snapshotNonImageFields(row)
    for (const col of PRODUCT_NON_IMAGE_COLUMNS) {
      if (JSON.stringify(before[col]) !== JSON.stringify(after[col])) {
        diffs.push({ productId: id, field: col, before: before[col], after: after[col] })
      }
    }
  }
  return { ok: diffs.length === 0, diffs }
}

/**
 * @param {object} opts
 * @param {Record<string, unknown>[]} opts.beforeRows
 * @param {Record<string, unknown>[]} opts.afterRows
 * @param {{ productId: string, currentImages: string[], proposedImages: string[], wouldChange: boolean }[]} opts.auditProducts
 * @param {{ productId: string, before: string, after: string }[]} opts.pathChanges
 * @param {{ productId: string, imagesJson: string }[]} opts.updatePlan
 */
export function verifyLocalApplyResult(opts) {
  const afterMap = new Map(opts.afterRows.map((r) => [String(r.id), r]))
  /** @type {string[]} */
  const imageMismatches = []
  let replacementsVerified = 0

  for (const change of opts.pathChanges) {
    const row = afterMap.get(change.productId)
    if (!row) {
      imageMismatches.push(`${change.productId}:missing_row`)
      continue
    }
    const images = parseImagesJsonArray(row.images_json)
    const slot = images[change.slotIndex]
    if (slot !== change.after) {
      imageMismatches.push(`${change.productId}[${change.slotIndex}]:expected_after`)
    } else {
      replacementsVerified += 1
    }
  }

  for (const id of PHASE2A_UNMATCHED_PRODUCT_IDS) {
    const ap = opts.auditProducts.find((p) => p.productId === id)
    const row = afterMap.get(id)
    if (!ap || !row) continue
    const after = parseImagesJsonArray(row.images_json)
    if (JSON.stringify(after) !== JSON.stringify(ap.currentImages)) {
      imageMismatches.push(`${id}:unmatched_product_changed`)
    }
  }

  for (const ap of opts.auditProducts) {
    if (ap.currentImages.length === 0) {
      const row = afterMap.get(ap.productId)
      const after = parseImagesJsonArray(row?.images_json)
      if (after.length !== 0) {
        imageMismatches.push(`${ap.productId}:empty_images_changed`)
      }
    }
  }

  for (const entry of opts.updatePlan) {
    const row = afterMap.get(entry.productId)
    const after = parseImagesJsonArray(row?.images_json)
    if (JSON.stringify(after) !== JSON.stringify(entry.proposedImages)) {
      imageMismatches.push(`${entry.productId}:proposed_mismatch`)
    }
  }

  const cloudinarySlots = countCloudinaryImageSlots(opts.afterRows)
  const nonImage = verifyNonImageFieldsUnchanged(opts.beforeRows, opts.afterRows)

  return {
    ok:
      imageMismatches.length === 0 &&
      nonImage.ok &&
      replacementsVerified === opts.pathChanges.length &&
      cloudinarySlots === opts.pathChanges.length,
    cloudinarySlots,
    expectedReplacements: opts.pathChanges.length,
    replacementsVerified,
    imageMismatches,
    nonImageFieldDiffs: nonImage.diffs,
    updatedProductCount: opts.updatePlan.length,
  }
}
