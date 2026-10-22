#!/usr/bin/env node
/**
 * Phase 5.3: import purchase rates into local D1 from validated dry-run report.
 * Default: plan only. Use --apply for local D1 writes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { excelCellKey } from '../src/lib/x4PrivateRatesDryRun.js'
import {
  DEFAULT_MAX_REPORT_AGE_MS,
  buildPurchaseImportSqlBatch,
  formatEffectiveFromUtc,
  validatePurchaseDryRunReportForImport,
  validatePurchaseReadyAgainstExcel,
  validatePurchaseReadyAgainstLiveD1,
  validateReportFreshness,
} from '../src/lib/purchaseRatesImport.js'
import {
  loadCurrentPurchaseRatesMap,
  loadLocalProductsMap,
  SERVER_ROOT,
  DB_NAME,
} from '../src/lib/d1LocalSelect.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPORT = path.join(SERVER_ROOT, 'reports', 'purchase-rates-dry-run.json')
const GENERATED_SQL = path.join(SERVER_ROOT, 'data', 'generated', 'purchase-rates-insert.sql')
const PYTHON_READER = path.join(__dirname, 'read-excel-rate-batch.py')

function parseArgs(argv) {
  const out = { apply: false, reportPath: DEFAULT_REPORT, maxReportAgeMs: DEFAULT_MAX_REPORT_AGE_MS }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') out.apply = true
    else if (arg === '--report' && argv[i + 1]) out.reportPath = path.resolve(argv[++i])
    else if (arg === '--max-report-age-hours' && argv[i + 1]) {
      out.maxReportAgeMs = Number(argv[++i]) * 60 * 60 * 1000
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Purchase rates import (local D1 only)

  node scripts/import-purchase-rates.mjs           Plan / validate only
  node scripts/import-purchase-rates.mjs --apply   Execute INSERT batch (local)

Options:
  --report <path>              Dry-run JSON (default: reports/purchase-rates-dry-run.json)
  --max-report-age-hours <n>   Default 24
`)
      process.exit(0)
    }
  }
  return out
}

function loadReport(reportPath) {
  if (!fs.existsSync(reportPath)) throw new Error(`Report not found: ${reportPath}`)
  const stat = fs.statSync(reportPath)
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  return { report, mtimeMs: stat.mtimeMs }
}

function readExcelForReport(report) {
  const ready = report.ready_for_import ?? []
  const resolved = report.meta?.workbooks_resolved ?? {}
  const cells = ready.map((row) => {
    const wb = String(row.matched_workbook)
    const workbook_path = resolved[wb]
    if (!workbook_path || !fs.existsSync(workbook_path)) {
      return { key: excelCellKey(wb, row.worksheet, row.excel_row_number), error: 'workbook_missing' }
    }
    return {
      key: excelCellKey(wb, row.worksheet, row.excel_row_number),
      workbook_path,
      worksheet: row.worksheet,
      row: row.excel_row_number,
    }
  })
  if (cells.some((c) => c.error)) {
    return { ok: false, error: 'workbook_path_missing_in_report_meta_or_disk', excelByKey: new Map() }
  }
  const py = spawnSync('py', ['-3', PYTHON_READER], {
    input: JSON.stringify({ cells }),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  if (py.status !== 0) {
    return { ok: false, error: `excel_reader_failed:${(py.stderr || py.stdout || '').trim()}`, excelByKey: new Map() }
  }
  let payload
  try {
    payload = JSON.parse(py.stdout)
  } catch {
    return { ok: false, error: 'excel_reader_invalid_json', excelByKey: new Map() }
  }
  const excelByKey = new Map()
  for (const result of payload.results ?? []) {
    if (result?.key) excelByKey.set(String(result.key), result)
  }
  return { ok: true, excelByKey }
}

function runSqlFile(filePath) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, '--local', '--file', filePath], {
    cwd: SERVER_ROOT,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  })
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const { report, mtimeMs } = loadReport(args.reportPath)

  /** @type {string[]} */
  const errors = []
  errors.push(...validatePurchaseDryRunReportForImport(report))

  if (args.apply) {
    errors.push(...validateReportFreshness(report.generatedAt, args.maxReportAgeMs))
    const generatedMs = Date.parse(String(report.generatedAt))
    if (Number.isFinite(generatedMs) && mtimeMs + 1000 < generatedMs) {
      errors.push('report_file_older_than_generatedAt_metadata')
    }
  }

  let productsById = new Map()
  let purchaseByProduct = new Map()
  try {
    productsById = loadLocalProductsMap()
    purchaseByProduct = loadCurrentPurchaseRatesMap()
  } catch (err) {
    errors.push(`d1_read_failed:${err?.message ?? err}`)
  }

  if (!errors.length) {
    errors.push(...validatePurchaseReadyAgainstLiveD1(report, productsById, purchaseByProduct))
  }

  let excelByKey = new Map()
  if (!errors.length) {
    const excel = readExcelForReport(report)
    if (!excel.ok) errors.push(excel.error)
    else {
      excelByKey = excel.excelByKey
      errors.push(...validatePurchaseReadyAgainstExcel(report, excelByKey))
    }
  }

  if (errors.length) {
    console.error('Purchase rate import validation failed:')
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }

  const effectiveFrom = formatEffectiveFromUtc()
  const sql = buildPurchaseImportSqlBatch(report.ready_for_import, effectiveFrom)
  fs.mkdirSync(path.dirname(GENERATED_SQL), { recursive: true })
  fs.writeFileSync(GENERATED_SQL, sql, 'utf8')

  console.log('Purchase rate import validation: OK')
  console.log(`Report: ${path.relative(SERVER_ROOT, args.reportPath)}`)
  console.log(`Ready rows: ${report.ready_for_import.length}`)
  console.log(`effective_from (UTC): ${effectiveFrom}`)
  console.log(`Generated SQL: ${path.relative(SERVER_ROOT, GENERATED_SQL)}`)
  console.log(`Current purchase rates (effective_to IS NULL): ${purchaseByProduct.size}`)

  if (!args.apply) {
    console.log('\nPlan only — no D1 writes. After approval:')
    console.log('  npm run purchase:rates:import:apply')
    return
  }

  console.log('\nApplying INSERT batch to local D1...')
  runSqlFile(GENERATED_SQL)
  const after = loadCurrentPurchaseRatesMap()
  console.log(`Post-apply current purchase rates count: ${after.size}`)
  console.log(`Inserted this run (expected): ${report.ready_for_import.length}`)
}

try {
  main()
} catch (err) {
  console.error(err?.message ?? err)
  process.exit(1)
}
