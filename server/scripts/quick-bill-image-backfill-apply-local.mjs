/**
 * Phase 2A — apply Quick Bill Cloudinary image backfill to LOCAL D1 only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  buildApplyTransactionSql,
  buildImageUpdatePlan,
  getLocalAuditFromReport,
  preflightImagesMatchAudit,
  verifyLocalApplyResult,
} from '../src/lib/quickBillImageBackfillApply.js'
import { parseImagesJsonArray } from '../src/lib/quickBillImageBackfillAudit.js'
import { d1ExecLocal, d1QueryLocal, SERVER_ROOT, DB_NAME } from '../tests/helpers/d1Local.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUDIT_JSON = path.join(SERVER_ROOT, 'reports', 'quick-bill-image-backfill-audit.json')
const BACKUP_DIR = path.join(SERVER_ROOT, 'data', 'backups')

function timestampUtcCompact() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true }
  }
  if (argv.includes('--remote')) {
    throw new Error('Refusing --remote: Phase 2A is local D1 only.')
  }
  return { help: false, dryRun: argv.includes('--dry-run') }
}

function exportLocalBackupSql(outPath) {
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'export', DB_NAME, '--local', '--output', outPath, '-y'],
    {
      cwd: SERVER_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    },
  )
}

function loadProductSnapshot() {
  const sql = `SELECT id, category_slug, name, pack, description, featured, stock_status, active, sort_order, company, selling_price_paise, created_at, images_json FROM products ORDER BY id ASC;`
  return d1QueryLocal(sql)
}

function main() {
  const { help, dryRun } = parseArgs(process.argv)
  if (help) {
    console.log(`Usage: node scripts/quick-bill-image-backfill-apply-local.mjs [--dry-run]

  Applies Phase 2A image backfill to LOCAL D1 only (never --remote).
  Requires: reports/quick-bill-image-backfill-audit.json (local target).

  --dry-run   Preflight + print plan; no backup or writes.`)
    process.exit(0)
  }

  if (!fs.existsSync(AUDIT_JSON)) {
    throw new Error(`Missing audit report: ${AUDIT_JSON}`)
  }

  const auditReport = JSON.parse(fs.readFileSync(AUDIT_JSON, 'utf8'))
  const localAudit = getLocalAuditFromReport(auditReport)
  if (!localAudit.ok) {
    throw new Error(localAudit.message)
  }

  const auditProducts = localAudit.audit.products
  const pathChanges = localAudit.pathChanges
  const beforeRows = loadProductSnapshot()

  const preflight = preflightImagesMatchAudit(beforeRows, auditProducts)
  if (!preflight.ok) {
    console.error('Preflight failed: local D1 images_json no longer matches audit. Aborting.')
    console.error(JSON.stringify(preflight.mismatches.slice(0, 10), null, 2))
    process.exit(2)
  }

  const updatePlan = buildImageUpdatePlan(auditProducts)
  const rowsById = new Map(beforeRows.map((r) => [String(r.id), r]))
  const txSql = buildApplyTransactionSql(rowsById, updatePlan)

  console.log(`Audit generated: ${localAudit.generatedAt}`)
  console.log(`Products to update: ${updatePlan.length}`)
  console.log(`Path replacements: ${pathChanges.length}`)

  if (dryRun) {
    console.log('Dry run — no backup or writes.')
    process.exit(0)
  }

  const ts = timestampUtcCompact()
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const backupSql = path.join(BACKUP_DIR, `d1-local-pre-quick-bill-images-${ts}.sql`)
  const backupJson = path.join(BACKUP_DIR, `d1-local-pre-quick-bill-images-${ts}.products.json`)

  console.log(`Backing up local D1 → ${path.relative(SERVER_ROOT, backupSql)}`)
  exportLocalBackupSql(backupSql)
  fs.writeFileSync(
    backupJson,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), products: beforeRows }, null, 2)}\n`,
    'utf8',
  )

  const applySqlPath = path.join(BACKUP_DIR, `_quick-bill-images-apply-${ts}.sql`)
  fs.writeFileSync(applySqlPath, txSql, 'utf8')
  console.log(`Applying batch (${updatePlan.length} optimistic UPDATEs in one wrangler file)…`)
  d1ExecLocal(fs.readFileSync(applySqlPath, 'utf8'))

  const afterRows = loadProductSnapshot()
  const verify = verifyLocalApplyResult({
    beforeRows,
    afterRows,
    auditProducts,
    pathChanges,
    updatePlan,
  })

  const verifyReport = {
    generatedAt: new Date().toISOString(),
    phase: '2a-local-apply',
    auditGeneratedAt: localAudit.generatedAt,
    backupSql: path.relative(SERVER_ROOT, backupSql),
    backupProductsJson: path.relative(SERVER_ROOT, backupJson),
    applySql: path.relative(SERVER_ROOT, applySqlPath),
    updatedProductIds: updatePlan.map((u) => u.productId),
    updatedProductCount: updatePlan.length,
    verification: verify,
    afterCloudinarySample: afterRows
      .filter((r) => parseImagesJsonArray(r.images_json).some((u) => u.startsWith('https://')))
      .slice(0, 3)
      .map((r) => ({ id: r.id, images: parseImagesJsonArray(r.images_json) })),
  }

  const verifyPath = path.join(SERVER_ROOT, 'reports', 'quick-bill-image-backfill-apply-local-verify.json')
  fs.writeFileSync(verifyPath, `${JSON.stringify(verifyReport, null, 2)}\n`, 'utf8')

  console.log(`Wrote ${path.relative(SERVER_ROOT, verifyPath)}`)
  console.log(
    `Verification: ok=${verify.ok} cloudinarySlots=${verify.cloudinarySlots} replacementsVerified=${verify.replacementsVerified}/${verify.expectedReplacements}`,
  )

  if (!verify.ok) {
    console.error('Verification failed after apply. Restore from backup SQL if needed.')
    console.error(JSON.stringify(verify, null, 2))
    process.exit(3)
  }

  console.log('Phase 2A local apply complete.')
}

main()
