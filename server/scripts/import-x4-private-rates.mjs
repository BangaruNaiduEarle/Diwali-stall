#!/usr/bin/env node
/**
 * Phase 2: import X4 private rates into local D1 from a validated dry-run report.
 * Default: plan only (no D1 writes). Use --apply to execute (requires fresh report + preflight).
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { excelCellKey } from '../src/lib/x4PrivateRatesDryRun.js'
import {
  DEFAULT_MAX_REPORT_AGE_MS,
  buildImportSqlBatch,
  formatEffectiveFromUtc,
  validateDryRunReportForImport,
  validateReadyAgainstExcel,
  validateReadyAgainstLiveD1,
  validateReportFreshness,
  EXPECTED_READY_COUNT,
} from '../src/lib/x4PrivateRatesImport.js'
import {
  loadCurrentPrivateRatesMap,
  loadLocalProductsMap,
  SERVER_ROOT,
} from '../src/lib/d1LocalSelect.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_NAME = 'diwali-quotation'
const DEFAULT_REPORT = path.join(SERVER_ROOT, 'reports', 'x4-private-rates-dry-run.json')
const GENERATED_SQL = path.join(SERVER_ROOT, 'data', 'generated', 'x4-private-rates-insert.sql')
const PYTHON_READER = path.join(__dirname, 'read-excel-x4-batch.py')

function parseArgs(argv) {
  const out = {
    apply: false,
    reportPath: DEFAULT_REPORT,
    maxReportAgeMs: DEFAULT_MAX_REPORT_AGE_MS,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') out.apply = true
    else if (arg === '--report' && argv[i + 1]) out.reportPath = path.resolve(argv[++i])
    else if (arg === '--max-report-age-hours' && argv[i + 1]) {
      out.maxReportAgeMs = Number(argv[++i]) * 60 * 60 * 1000
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
  }
  return out
}

function printHelp() {
  console.log(`X4 private_rates import (local D1)

Usage:
  node scripts/import-x4-private-rates.mjs              Plan only — validate report, no D1 writes
  node scripts/import-x4-private-rates.mjs --apply      Execute INSERT batch (local D1 only)

Options:
  --report <path>                 Dry-run JSON (default: server/reports/x4-private-rates-dry-run.json)
  --max-report-age-hours <n>      Reject stale reports (default: 24)

Report validation (always):
  - mode=dry_run, exactly ${EXPECTED_READY_COUNT} ready rows, unique product_id
  - zero drift/conflict/invalid buckets; P142 not in ready; 23 blocked_manual
  - meta references x4_implemented.csv / x4_pending_manual.csv; D1 not skipped

Apply-only preflight (before any INSERT):
  - Report freshness (generatedAt within max age)
  - All ready product_ids exist in local D1; no current private_rates row
  - Re-read Excel column G + Comp at stored coordinates

Transaction (Wrangler 4.85.x local, verified in tests):
  - wrangler splits the SQL file into statements, then runs ONE db.batch([...]) (see node_modules/wrangler/wrangler-dist/cli.js executeLocally)
  - On batch failure the CLI exits non-zero; no success summary is printed
  - Probe: server/tests/fixtures/d1-wrangler-tx + tests/d1WranglerTxAtomic.test.js (isolated DB, not diwali-quotation)
  - Not atomic across multiple wrangler invocations; remote --remote uses a different import API
  - INSERT only — never UPDATE existing rates

npm scripts:
  npm run x4:rates:import              Plan only
  npm run x4:rates:import:apply        Requires --apply flag on underlying script
`)
}

function loadReport(reportPath) {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Report not found: ${reportPath}`)
  }
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

  const missing = cells.filter((c) => c.error)
  if (missing.length) {
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
  errors.push(...validateDryRunReportForImport(report))

  if (args.apply) {
    errors.push(...validateReportFreshness(report.generatedAt, args.maxReportAgeMs))
    const generatedMs = Date.parse(String(report.generatedAt))
    if (Number.isFinite(generatedMs) && mtimeMs + 1000 < generatedMs) {
      errors.push('report_file_older_than_generatedAt_metadata')
    }
  }

  let productsById = new Map()
  let currentRatesByProductId = new Map()

  try {
    productsById = loadLocalProductsMap()
    currentRatesByProductId = loadCurrentPrivateRatesMap()
  } catch (err) {
    errors.push(`d1_read_failed:${err?.message ?? err}`)
  }

  if (!errors.length) {
    errors.push(...validateReadyAgainstLiveD1(report, productsById, currentRatesByProductId))
  }

  let excelByKey = new Map()
  if (!errors.length) {
    const excel = readExcelForReport(report)
    if (!excel.ok) {
      errors.push(excel.error)
    } else {
      excelByKey = excel.excelByKey
      errors.push(...validateReadyAgainstExcel(report, excelByKey))
    }
  }

  if (errors.length) {
    console.error('X4 import validation failed:')
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }

  const effectiveFrom = formatEffectiveFromUtc()
  const sql = buildImportSqlBatch(report.ready_for_import, effectiveFrom)

  fs.mkdirSync(path.dirname(GENERATED_SQL), { recursive: true })
  fs.writeFileSync(GENERATED_SQL, sql, 'utf8')

  console.log('X4 private_rates import validation: OK')
  console.log(`Report: ${path.relative(SERVER_ROOT, args.reportPath)}`)
  console.log(`Ready rows: ${report.ready_for_import.length}`)
  console.log(`effective_from (UTC): ${effectiveFrom}`)
  console.log(`Generated SQL: ${path.relative(SERVER_ROOT, GENERATED_SQL)}`)
  console.log(`Current private_rates (effective_to IS NULL): ${currentRatesByProductId.size}`)

  if (!args.apply) {
    console.log('\nPlan only — no D1 writes. To execute locally:')
    console.log('  npm run x4:rates:import:apply')
    console.log('  (or: node scripts/import-x4-private-rates.mjs --apply)')
    return
  }

  console.log('\nApplying INSERT batch to local D1...')
  runSqlFile(GENERATED_SQL)

  const countOut = execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      DB_NAME,
      '--local',
      '--command',
      'SELECT COUNT(*) AS n FROM private_rates WHERE effective_to IS NULL;',
      '--json',
    ],
    { cwd: SERVER_ROOT, encoding: 'utf8', shell: process.platform === 'win32' },
  )

  let n = null
  try {
    const parsed = JSON.parse(countOut)
    n = parsed?.[0]?.results?.[0]?.n ?? parsed?.results?.[0]?.n
  } catch {
    /* ignore */
  }

  console.log(`Post-apply current private_rates count: ${n ?? 'unknown'} (expected ${EXPECTED_READY_COUNT} if DB was empty)`)
}

try {
  main()
} catch (err) {
  console.error(err?.message ?? err)
  process.exit(1)
}
