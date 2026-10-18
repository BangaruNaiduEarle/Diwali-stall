/**
 * Phase 3C: read-only Cloudinary migration audit (default --dry-run).
 * No uploads, network, D1 writes, or catalogue mutations.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildCloudinaryMigrationAudit } from '../src/lib/cloudinaryMigrationAudit.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(SERVER_ROOT, '..')

const SOURCE_MODULE = path.join(REPO_ROOT, 'src', 'data', 'products.js')
const IMPORT_JSON = path.join(SERVER_ROOT, 'data', 'catalogue-import.json')
const OUT_AUDIT = path.join(SERVER_ROOT, 'reports', 'cloudinary-migration-audit.json')
const OUT_MANIFEST = path.join(SERVER_ROOT, 'reports', 'cloudinary-migration-manifest.json')

function parseArgs(argv) {
  const args = new Set(argv.slice(2))
  if (args.has('--help') || args.has('-h')) {
    return { help: true }
  }
  // Default and only mode for this phase: dry-run (no side effects beyond writing reports).
  const dryRun = !args.has('--no-dry-run')
  return { dryRun, help: false }
}

function loadProducts() {
  if (!fs.existsSync(SOURCE_MODULE)) {
    throw new Error(`Missing ${SOURCE_MODULE}`)
  }
  return import(pathToFileURL(SOURCE_MODULE).href).then((m) => m.products ?? [])
}

function importJsonSummary() {
  if (!fs.existsSync(IMPORT_JSON)) {
    return { present: false }
  }
  const payload = JSON.parse(fs.readFileSync(IMPORT_JSON, 'utf8'))
  return {
    present: true,
    sourceProductCount: payload.sourceProductCount,
    recordCount: payload.records?.length ?? 0,
  }
}

async function main() {
  const { help, dryRun } = parseArgs(process.argv)
  if (help) {
    console.log(`Usage: node scripts/cloudinary-migration-audit.mjs [--dry-run]

  --dry-run       Default. Audit only; writes JSON reports under server/reports/.
  --no-dry-run    Same behavior in Phase 3C (upload not implemented).

  No Cloudinary uploads, D1 changes, or products.js edits.`)
    process.exit(0)
  }

  const products = await loadProducts()
  const audit = buildCloudinaryMigrationAudit(products, {
    publicRoot: path.join(REPO_ROOT, 'public'),
    repoRoot: REPO_ROOT,
  })
  audit.dryRun = dryRun
  audit.sources = {
    productsModule: path.relative(REPO_ROOT, SOURCE_MODULE),
    catalogueImportJson: importJsonSummary(),
  }

  fs.mkdirSync(path.dirname(OUT_AUDIT), { recursive: true })
  const manifestPayload = {
    generatedAt: audit.generatedAt,
    dryRun: audit.dryRun,
    cloudinaryFolder: audit.summary.cloudinaryFolder,
    uploadTaskCount: audit.summary.uploadTaskCount,
    entryCount: audit.manifest.length,
    uploadTasks: audit.uploadTasks,
    sharedUploadPlans: audit.sharedUploadPlans,
    entries: audit.manifest,
  }
  const auditPayload = { ...audit }
  delete auditPayload.manifest
  delete auditPayload.uploadTasks

  fs.writeFileSync(OUT_AUDIT, `${JSON.stringify(auditPayload, null, 2)}\n`, 'utf8')
  fs.writeFileSync(OUT_MANIFEST, `${JSON.stringify(manifestPayload, null, 2)}\n`, 'utf8')

  const s = audit.summary
  console.log('Cloudinary migration audit (dry-run)')
  console.log(`  Products: ${s.productCount}`)
  console.log(`  Image references: ${s.totalImageReferences}`)
  console.log(`  On disk (referenced): ${s.existingReferencedFiles}`)
  console.log(`  Missing references: ${s.missingReferencedFiles}`)
  console.log(`  Empty image arrays: ${s.emptyImageProductIds}`)
  console.log(`  Unreferenced on disk: ${s.unreferencedFilesOnDisk}`)
  console.log(`  Duplicate path references: ${s.duplicateReferencePaths}`)
  console.log(`  Shared across products: ${s.sharedLocalFilesAcrossProducts}`)
  console.log(`  Upload tasks (deduped files): ${s.uploadTaskCount}`)
  console.log(`  Manifest entries (canonical uploads only): ${s.automatedUploadCount}`)
  console.log(`Wrote ${path.relative(SERVER_ROOT, OUT_AUDIT)}`)
  console.log(`Wrote ${path.relative(SERVER_ROOT, OUT_MANIFEST)}`)
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
