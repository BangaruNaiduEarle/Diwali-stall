#!/usr/bin/env node
/**
 * Phase 1: read-only dry-run for Excel X4 → private_rates validation.
 * Default: dry-run only — writes report files, never mutates D1.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  buildDryRunReport,
  excelCellKey,
  findDuplicateApprovedIds,
  formatDryRunMarkdown,
  normalizeApprovedRow,
  parseCsv,
} from '../src/lib/x4PrivateRatesDryRun.js'
import {
  d1QueryLocalSelect,
  loadCurrentPrivateRatesMap,
  loadLocalProductsMap,
  SERVER_ROOT,
} from '../src/lib/d1LocalSelect.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SERVER_ROOT, '..')

const DEFAULT_APPROVED = path.join(REPO_ROOT, 'reports', 'x4_implemented.csv')
const DEFAULT_PENDING = path.join(REPO_ROOT, 'reports', 'x4_pending_manual.csv')
const REPORT_JSON = path.join(SERVER_ROOT, 'reports', 'x4-private-rates-dry-run.json')
const REPORT_MD = path.join(SERVER_ROOT, 'reports', 'x4-private-rates-dry-run.md')
const PYTHON_READER = path.join(__dirname, 'read-excel-x4-batch.py')

const WORKBOOK_NAMES = ['CRACKERS_all.xlsx', 'CRACKERS_ajn.xlsx']

function resolveWorkbookPath(filename) {
  const candidates = [
    path.join(REPO_ROOT, filename),
    path.join(os.homedir(), 'Downloads', filename),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function readExcelCells(approvedRows) {
  /** @type {Map<string, string>} */
  const workbookPaths = new Map()
  for (const name of WORKBOOK_NAMES) {
    const resolved = resolveWorkbookPath(name)
    if (resolved) workbookPaths.set(name, resolved)
  }

  /** @type {{ key: string, workbook_path: string, worksheet: string, row: number }[]} */
  const cells = []
  for (const row of approvedRows) {
    const wbPath = workbookPaths.get(row.matched_workbook)
    if (!wbPath) continue
    const key = excelCellKey(row.matched_workbook, row.worksheet, row.excel_row_number)
    cells.push({
      key,
      workbook_path: wbPath,
      worksheet: row.worksheet,
      row: row.excel_row_number,
    })
  }

  if (!cells.length) {
    return {
      ok: false,
      error: 'no_workbooks_found',
      excelByKey: new Map(),
      workbookPaths: Object.fromEntries(workbookPaths),
    }
  }

  const missingWb = [...new Set(approvedRows.map((r) => r.matched_workbook))].filter(
    (name) => !workbookPaths.get(name),
  )
  if (missingWb.length) {
    return {
      ok: false,
      error: `workbook_not_found:${missingWb.join(',')}`,
      excelByKey: new Map(),
      workbookPaths: Object.fromEntries(workbookPaths),
    }
  }

  const py = spawnSync('py', ['-3', PYTHON_READER], {
    input: JSON.stringify({ cells }),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  if (py.status !== 0) {
    const detail = (py.stderr || py.stdout || '').trim()
    return {
      ok: false,
      error: `excel_reader_failed:${detail || py.status}`,
      excelByKey: new Map(),
      workbookPaths: Object.fromEntries(workbookPaths),
    }
  }

  let payload
  try {
    payload = JSON.parse(py.stdout)
  } catch {
    return {
      ok: false,
      error: 'excel_reader_invalid_json',
      excelByKey: new Map(),
      workbookPaths: Object.fromEntries(workbookPaths),
    }
  }

  /** @type {Map<string, object>} */
  const excelByKey = new Map()
  for (const result of payload.results ?? []) {
    if (result?.key) excelByKey.set(String(result.key), result)
  }
  return { ok: true, excelByKey, workbookPaths: Object.fromEntries(workbookPaths) }
}

function parseArgs(argv) {
  const out = {
    approvedCsv: DEFAULT_APPROVED,
    pendingCsv: DEFAULT_PENDING,
    skipD1: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--approved-csv' && argv[i + 1]) {
      out.approvedCsv = path.resolve(argv[++i])
    } else if (arg === '--pending-csv' && argv[i + 1]) {
      out.pendingCsv = path.resolve(argv[++i])
    } else if (arg === '--skip-d1') {
      out.skipD1 = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/dry-run-x4-private-rates.mjs [options]

Options:
  --approved-csv <path>   Default: reports/x4_implemented.csv
  --pending-csv <path>    Default: reports/x4_pending_manual.csv
  --skip-d1               Skip D1 reads (tests only; incomplete report)

Dry-run only. Writes:
  server/reports/x4-private-rates-dry-run.json
  server/reports/x4-private-rates-dry-run.md
`)
      process.exit(0)
    }
  }
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!fs.existsSync(args.approvedCsv)) {
    console.error(`Missing approved CSV: ${args.approvedCsv}`)
    process.exit(1)
  }
  if (!fs.existsSync(args.pendingCsv)) {
    console.error(`Missing pending CSV: ${args.pendingCsv}`)
    process.exit(1)
  }

  const approvedRaw = parseCsv(fs.readFileSync(args.approvedCsv, 'utf8'))
  const pendingRaw = parseCsv(fs.readFileSync(args.pendingCsv, 'utf8'))

  const approvedRows = approvedRaw.map(normalizeApprovedRow).filter(Boolean)
  const duplicateApprovedIds = findDuplicateApprovedIds(approvedRows)

  let productsById = new Map()
  let currentRatesByProductId = new Map()
  /** @type {string[]} */
  let d1Errors = []

  if (!args.skipD1) {
    try {
      productsById = loadLocalProductsMap()
      currentRatesByProductId = loadCurrentPrivateRatesMap()
      // Sanity: ensure guard rejects writes
      d1QueryLocalSelect('SELECT 1 AS ok')
    } catch (err) {
      d1Errors.push(String(err?.message ?? err))
      console.error('D1 read failed (SELECT-only). Fix local Wrangler D1 or use --skip-d1 for partial runs.')
      console.error(d1Errors[0])
      process.exit(2)
    }
  }

  const excelResult = readExcelCells(approvedRows)
  if (!excelResult.ok) {
    console.error(`Excel read failed: ${excelResult.error}`)
    process.exit(3)
  }

  const report = buildDryRunReport({
    approvedRows,
    pendingRows: pendingRaw,
    productsById,
    currentRatesByProductId,
    excelByKey: excelResult.excelByKey,
    duplicateApprovedIds,
    meta: {
      approved_csv: path.relative(REPO_ROOT, args.approvedCsv),
      pending_csv: path.relative(REPO_ROOT, args.pendingCsv),
      workbooks_resolved: excelResult.workbookPaths,
      d1_skipped: args.skipD1,
      d1_errors: d1Errors,
    },
  })

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true })
  fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  fs.writeFileSync(REPORT_MD, `${formatDryRunMarkdown(report)}\n`, 'utf8')

  console.log('X4 private rates dry-run complete (no D1 writes).')
  console.log(`JSON: ${path.relative(SERVER_ROOT, REPORT_JSON)}`)
  console.log(`Markdown: ${path.relative(SERVER_ROOT, REPORT_MD)}`)
  console.log('Counts:')
  for (const [k, v] of Object.entries(report.counts)) {
    console.log(`  ${k}: ${v}`)
  }

  const expectedNote =
    report.counts.ready_for_import !== report.counts.approved_csv_rows
      ? ' (approved CSV rows include blocked/missing catalogue — expected)'
      : ''
  console.log(`\nready_for_import: ${report.counts.ready_for_import}${expectedNote}`)

  if (report.catalogue_missing.some((r) => r.product_id === 'P142')) {
    console.log('Note: P142 in approved CSV but absent from D1 catalogue (catalogue_missing).')
  }

  process.exit(0)
}

try {
  main()
} catch (err) {
  console.error(err)
  process.exit(1)
}
