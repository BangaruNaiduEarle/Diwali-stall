/**
 * Generate reviewable catalogue-import.json from src/data/products.js (no price/x4 in output).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildCatalogueImportManifest } from '../src/lib/catalogueSource.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(SERVER_ROOT, '..')

const SOURCE_MODULE = path.join(REPO_ROOT, 'src', 'data', 'products.js')
const BACKUP_GLOB = path.join(REPO_ROOT, 'backups', 'products.js.backup.20261014T065513Z')
const OUT_JSON = path.join(SERVER_ROOT, 'data', 'catalogue-import.json')
const OUT_REPORT = path.join(SERVER_ROOT, 'reports', 'catalogue-import-report.json')

const { products } = await import(pathToFileURL(SOURCE_MODULE).href)

const manifest = buildCatalogueImportManifest(products)

let backupIdCount = null
if (fs.existsSync(BACKUP_GLOB)) {
  const backupText = fs.readFileSync(BACKUP_GLOB, 'utf8')
  backupIdCount = (backupText.match(/"id":\s*"P/g) || []).length
}

const sourceIds = new Set(manifest.records.map((r) => r.id))
const mismatches = []

const numericIds = manifest.records
  .map((r) => Number(String(r.id).replace(/^P/i, '')))
  .filter((n) => Number.isFinite(n))
  .sort((a, b) => a - b)
if (numericIds.length) {
  const max = numericIds[numericIds.length - 1]
  for (let n = 1; n <= max; n += 1) {
    if (!numericIds.includes(n)) {
      mismatches.push({ type: 'missing_id_in_sequence', id: `P${String(n).padStart(3, '0')}` })
    }
  }
}
if (backupIdCount !== null && backupIdCount !== manifest.sourceProductCount) {
  mismatches.push({
    type: 'backup_id_count',
    backupIdCount,
    sourceProductCount: manifest.sourceProductCount,
  })
}

const report = {
  generatedAt: new Date().toISOString(),
  sourceModule: path.relative(REPO_ROOT, SOURCE_MODULE),
  backupPath: fs.existsSync(BACKUP_GLOB) ? path.relative(REPO_ROOT, BACKUP_GLOB) : null,
  sourceProductCount: manifest.sourceProductCount,
  importRecordCount: manifest.recordCount,
  uniqueIds: sourceIds.size,
  companyFieldPresentInSource: products.some((p) => p.company !== undefined && p.company !== null),
  priceAndX4Excluded: true,
  warnings: manifest.warnings,
  errors: manifest.errors,
  mismatches,
}

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true })
fs.mkdirSync(path.dirname(OUT_REPORT), { recursive: true })

const payload = {
  generatedAt: report.generatedAt,
  sourceProductCount: manifest.sourceProductCount,
  records: manifest.records,
}

fs.writeFileSync(OUT_JSON, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
fs.writeFileSync(OUT_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log(`Wrote ${path.relative(SERVER_ROOT, OUT_JSON)} (${manifest.recordCount} records)`)
console.log(`Wrote ${path.relative(SERVER_ROOT, OUT_REPORT)}`)

if (manifest.errors.length) {
  console.error('Import generation errors:')
  for (const e of manifest.errors) console.error(`  - ${e}`)
  process.exit(1)
}

if (manifest.warnings.length) {
  console.warn(`Warnings: ${manifest.warnings.length} (see report)`)
}
