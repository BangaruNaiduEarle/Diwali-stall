/**
 * Read-only Phase 3C review report (human migration decisions). No uploads or data mutations.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  buildCloudinaryMigrationAudit,
  cataloguePathToPublicFile,
} from './cloudinaryMigrationAudit.js'

const MIN_OVERLAP_BASENAME = 12

/**
 * Suggest unreferenced disk files for a missing catalogue path (candidates only — never auto-map).
 * @param {string} missingCataloguePath
 * @param {string[]} unreferencedCataloguePaths
 */
export function suggestUnreferencedCandidates(missingCataloguePath, unreferencedCataloguePaths) {
  const missingBase = path.basename(missingCataloguePath)
  const missingStem = path.parse(missingBase).name
  /** @type {Array<{ cataloguePath: string, reason: string }>} */
  const out = []

  for (const cat of unreferencedCataloguePaths) {
    const base = path.basename(cat)
    const stem = path.parse(base).name
    let reason = null
    if (base === missingBase) {
      reason = 'exact_basename_different_catalogue_folder'
    } else if (stem === missingStem) {
      reason = 'same_filename_stem_different_extension_or_suffix'
    } else if (stem === `${missingStem}_UNKNOWN`) {
      reason = 'unreferenced_unknown_suffix_variant'
    } else if (
      (stem.includes(missingStem) || missingStem.includes(stem)) &&
      Math.min(stem.length, missingStem.length) >= MIN_OVERLAP_BASENAME
    ) {
      reason = 'basename_overlap_manual_review_only'
    }
    if (reason) {
      out.push({ cataloguePath: cat, reason })
    }
  }

  out.sort((a, b) =>
    a.cataloguePath === b.cataloguePath
      ? a.reason.localeCompare(b.reason)
      : a.cataloguePath.localeCompare(b.cataloguePath),
  )
  return out
}

/**
 * @param {Array<{ id: string, name?: string, images?: string[] }>} products
 * @param {{ publicRoot: string, repoRoot: string }} opts
 */
export function buildCloudinaryMigrationReview(products, opts) {
  const publicRoot = path.resolve(opts.publicRoot)
  const repoRoot = path.resolve(opts.repoRoot)
  const audit = buildCloudinaryMigrationAudit(products, { publicRoot, repoRoot })

  const nameById = new Map(products.map((p) => [String(p.id), String(p.name ?? '').trim()]))

  /** @type {Map<string, { productId: string, productName: string, slot: number }[]>} */
  const locsByPath = new Map()
  for (const product of products) {
    const productId = String(product.id ?? '').trim()
    const productName = String(product.name ?? '').trim()
    const images = Array.isArray(product.images) ? product.images : []
    images.forEach((raw, index) => {
      const cataloguePath = String(raw ?? '').trim()
      if (!locsByPath.has(cataloguePath)) locsByPath.set(cataloguePath, [])
      locsByPath.get(cataloguePath).push({
        productId,
        productName,
        slot: index + 1,
      })
    })
  }

  const unreferenced = audit.unreferencedFilesOnDisk
  const missingSet = new Set(audit.missingReferencedFiles)

  /** @type {Array<Record<string, unknown>>} */
  const imageReferences = []

  for (const product of products) {
    const productId = String(product.id ?? '').trim()
    const productName = String(product.name ?? '').trim()
    const images = Array.isArray(product.images) ? product.images : []
    if (images.length === 0) continue

    images.forEach((raw, index) => {
      const cataloguePath = String(raw ?? '').trim()
      const slot = index + 1
      const mapped = cataloguePathToPublicFile(cataloguePath, publicRoot)
      const fileExists =
        mapped.ok && fs.existsSync(mapped.absolutePath)
      const allLocs = locsByPath.get(cataloguePath) ?? []
      const sharedWithProducts = allLocs
        .filter((l) => l.productId !== productId)
        .map((l) => ({ productId: l.productId, productName: l.productName, slot: l.slot }))

      /** @type {Array<{ cataloguePath: string, reason: string }>} */
      let candidateUnreferencedFiles = []
      if (!fileExists && cataloguePath.startsWith('/')) {
        candidateUnreferencedFiles = suggestUnreferencedCandidates(
          cataloguePath,
          unreferenced,
        )
      }

      imageReferences.push({
        productId,
        productName,
        slot,
        cataloguePath,
        fileExists,
        sharedWithProducts,
        intentionallySharedAcrossProducts: sharedWithProducts.length > 0,
        candidateUnreferencedFiles,
      })
    })
  }

  imageReferences.sort((a, b) =>
    a.productId === b.productId
      ? a.slot - b.slot
      : String(a.productId).localeCompare(String(b.productId)),
  )

  const emptyImageProducts = audit.emptyImageProductIds.map((id) => ({
    productId: id,
    productName: nameById.get(id) ?? '',
  }))

  const existingReferencedSet = new Set(audit.existingReferencedFiles)

  /** @type {Array<Record<string, unknown>>} */
  const missingPathDetails = audit.missingReferencedFiles.map((cataloguePath) => {
    const locations = locsByPath.get(cataloguePath) ?? []
    const missingStem = path.parse(path.basename(cataloguePath)).name
    /** Related files already used by other products (not auto-substitutes). */
    const relatedExistingReferencedPaths = [...existingReferencedSet]
      .filter((existingPath) => {
        const existingStem = path.parse(path.basename(existingPath)).name
        if (existingPath === cataloguePath) return false
        return (
          existingStem === missingStem.replace(/_AJN$/, '') ||
          missingStem === existingStem.replace(/_AJN$/, '') ||
          (missingStem.startsWith(existingStem) && existingStem.length >= MIN_OVERLAP_BASENAME) ||
          (existingStem.startsWith(missingStem) && missingStem.length >= MIN_OVERLAP_BASENAME)
        )
      })
      .map((existingPath) => ({
        cataloguePath: existingPath,
        usedByProducts: (locsByPath.get(existingPath) ?? []).map((l) => ({
          productId: l.productId,
          productName: l.productName,
          slot: l.slot,
        })),
      }))
      .filter((row) => row.usedByProducts.length > 0)
      .sort((a, b) => a.cataloguePath.localeCompare(b.cataloguePath))

    return {
      cataloguePath,
      products: locations.map((l) => ({
        productId: l.productId,
        productName: l.productName,
        slot: l.slot,
      })),
      candidateUnreferencedFiles: suggestUnreferencedCandidates(cataloguePath, unreferenced),
      relatedExistingReferencedPaths,
    }
  })

  const sharedPathReview = audit.sharedAcrossProducts.map((entry) => ({
    cataloguePath: entry.cataloguePath,
    productIds: entry.productIds,
    products: entry.productIds.map((id) => ({
      productId: id,
      productName: nameById.get(id) ?? '',
    })),
    locations: entry.locations,
    fileExists: !missingSet.has(entry.cataloguePath),
    note: 'Same local path referenced by multiple products (often intentional). Manifest uploadTasks dedupe to one Cloudinary upload; all slots reuse the canonical public ID for delivery.',
  }))

  const decisionsRequired = [
    {
      id: 'missing-local-files',
      severity: 'blocker',
      summary: `${audit.missingReferencedFiles.length} catalogue paths have no matching file under public/ (exact path).`,
      affectedProductIds: [
        ...new Set(
          missingPathDetails.flatMap((m) => m.products.map((p) => p.productId)),
        ),
      ],
      action:
        'For each missing path: add/rename the file to match the catalogue path exactly, or approve a deliberate products.js path change (not done in Phase 3C). Review candidateUnreferencedFiles only as hints.',
    },
    {
      id: 'shared-path-cloudinary-slots',
      severity: 'info',
      summary: `${audit.sharedAcrossProducts.length} path(s) shared across products (owner-approved: upload once, reuse URL). See sharedUploadPlans in the audit/manifest.`,
      action:
        'When the exact local file exists, the manifest emits one upload task per catalogue path; non-canonical product slots reuse the canonical Cloudinary public ID (no duplicate upload).',
    },
    {
      id: 'empty-image-arrays',
      severity: 'decision',
      summary: `${audit.emptyImageProductIds.length} products have images: [].`,
      action:
        'Decide whether to migrate without images, assign images later via admin, or map unreferenced disk files to specific product IDs (requires your explicit approval per product).',
    },
    {
      id: 'unreferenced-disk-files',
      severity: 'decision',
      summary: `${audit.unreferencedFilesOnDisk.length} files under public/images/products/ are not referenced in products.js.`,
      action:
        'Assign to products, rename to match catalogue paths, or leave unused. No automatic assignment in this phase.',
    },
  ]

  return {
    generatedAt: new Date().toISOString(),
    dryRun: true,
    readOnly: true,
    summary: {
      ...audit.summary,
      intentionalSharedPathCount: audit.sharedAcrossProducts.length,
      imageReferenceRowCount: imageReferences.length,
      emptyImageProductCount: emptyImageProducts.length,
    },
    sharedPathReview,
    missingPathDetails,
    emptyImageProducts,
    unreferencedFilesOnDisk: unreferenced,
    imageReferences,
    decisionsRequired,
    sources: {
      auditReport: 'server/reports/cloudinary-migration-audit.json',
      migrationManifest: 'server/reports/cloudinary-migration-manifest.json',
      productsModule: 'src/data/products.js',
    },
  }
}

/**
 * @param {ReturnType<typeof buildCloudinaryMigrationReview>} review
 */
export function formatCloudinaryMigrationReviewMarkdown(review) {
  const lines = []
  lines.push('# Cloudinary migration review (Phase 3C, read-only)')
  lines.push('')
  lines.push(`Generated: ${review.generatedAt}`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  const s = review.summary
  lines.push(`| Metric | Value |`)
  lines.push(`| --- | ---: |`)
  lines.push(`| Products | ${s.productCount} |`)
  lines.push(`| Image references | ${s.totalImageReferences} |`)
  lines.push(`| Referenced files on disk | ${s.existingReferencedFiles} unique paths |`)
  lines.push(`| Missing referenced paths | ${s.missingReferencedFiles} |`)
  lines.push(`| Empty \`images[]\` | ${s.emptyImageProductIds} |`)
  lines.push(`| Unreferenced on disk | ${s.unreferencedFilesOnDisk} |`)
  lines.push(`| Paths shared across products | ${s.intentionalSharedPathCount} |`)
  lines.push('')
  lines.push('## Intentional shared paths (verify, not errors)')
  lines.push('')
  if (review.sharedPathReview.length === 0) {
    lines.push('_No catalogue paths are referenced by more than one product._')
  } else {
    for (const row of review.sharedPathReview) {
      lines.push(`### \`${row.cataloguePath}\``)
      lines.push(`- **File exists:** ${row.fileExists ? 'yes' : 'no'}`)
      lines.push(
        `- **Products:** ${row.products.map((p) => `${p.productId} (${p.productName})`).join(', ')}`,
      )
      lines.push(`- ${row.note}`)
      lines.push('')
    }
  }
  lines.push('## Missing catalogue paths')
  lines.push('')
  for (const m of review.missingPathDetails) {
    lines.push(`### \`${m.cataloguePath}\``)
    for (const p of m.products) {
      lines.push(`- ${p.productId} **${p.productName}** (slot ${p.slot})`)
    }
    if (m.candidateUnreferencedFiles.length === 0) {
      lines.push('- **Candidates (unreferenced only):** none listed')
    } else {
      lines.push('- **Candidates (unreferenced only, not auto-mapped):**')
      for (const c of m.candidateUnreferencedFiles) {
        lines.push(`  - \`${c.cataloguePath}\` — ${c.reason}`)
      }
    }
    if (m.relatedExistingReferencedPaths?.length) {
      lines.push('- **Related paths already in catalogue (other products, not substitutes):**')
      for (const rel of m.relatedExistingReferencedPaths) {
        const who = rel.usedByProducts
          .map((p) => `${p.productId} (${p.productName})`)
          .join(', ')
        lines.push(`  - \`${rel.cataloguePath}\` — used by ${who}`)
      }
    }
    lines.push('')
  }
  lines.push('## Decisions required before upload / URL migration')
  lines.push('')
  for (const d of review.decisionsRequired) {
    lines.push(`### ${d.id} (${d.severity})`)
    lines.push(d.summary)
    lines.push('')
    lines.push(d.action)
    lines.push('')
  }
  lines.push(`## Empty image arrays (${review.emptyImageProducts.length} products)`)
  lines.push('')
  lines.push(
    review.emptyImageProducts
      .map((p) => `- ${p.productId} — ${p.productName || '(no name)'}`)
      .join('\n'),
  )
  lines.push('')
  lines.push('## Full image reference table')
  lines.push('')
  lines.push(
    '| Product | Name | Slot | Path | Exists | Shared with | Candidates |',
  )
  lines.push('| --- | --- | ---: | --- | --- | --- | --- |')
  for (const r of review.imageReferences) {
    const shared =
      r.sharedWithProducts.length === 0
        ? '—'
        : r.sharedWithProducts
            .map((p) => `${p.productId}@${p.slot}`)
            .join(', ')
    const cands =
      r.candidateUnreferencedFiles.length === 0
        ? '—'
        : r.candidateUnreferencedFiles.map((c) => path.basename(c.cataloguePath)).join(', ')
    const exists = r.fileExists ? 'yes' : 'no'
    lines.push(
      `| ${r.productId} | ${r.productName.replace(/\|/g, '\\|')} | ${r.slot} | \`${r.cataloguePath}\` | ${exists} | ${shared} | ${cands} |`,
    )
  }
  lines.push('')
  lines.push('## Unreferenced files on disk')
  lines.push('')
  for (const u of review.unreferencedFilesOnDisk) {
    lines.push(`- \`${u}\``)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}
