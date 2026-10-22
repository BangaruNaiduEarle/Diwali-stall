#!/usr/bin/env node
/**
 * Phase 5.3: dry-run purchase rates from Excel Rate (column 6) — no D1 writes.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildPurchaseRatesDryRunPlan } from '../src/lib/purchaseRatesDryRun.js'
import { excelCellKey } from '../src/lib/x4PrivateRatesDryRun.js'
import {
  loadCurrentPurchaseRatesMap,
  loadLocalProductsMap,
  SERVER_ROOT,
} from '../src/lib/d1LocalSelect.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PHASE52_REPORT = path.join(SERVER_ROOT, 'reports', 'phase52-pricing-mapping-report.json')
const REPORT_JSON = path.join(SERVER_ROOT, 'reports', 'purchase-rates-dry-run.json')
const REPORT_MD = path.join(SERVER_ROOT, 'reports', 'purchase-rates-dry-run.md')
const PYTHON_READER = path.join(__dirname, 'read-excel-rate-batch.py')
const WORKBOOK_NAMES = ['CRACKERS_all.xlsx', 'CRACKERS_ajn.xlsx']

function resolveWorkbookPath(filename) {
  const repoRoot = path.resolve(SERVER_ROOT, '..')
  const candidates = [
    path.join(repoRoot, filename),
    path.join(os.homedir(), 'Downloads', filename),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function readExcelForCells(cells, workbookPaths) {
  if (!cells.length) {
    return { ok: false, error: 'no_cells_to_read', excelByKey: new Map() }
  }
  const py = spawnSync('py', ['-3', PYTHON_READER], {
    input: JSON.stringify({ cells }),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  if (py.status !== 0) {
    return {
      ok: false,
      error: `excel_reader_failed:${(py.stderr || py.stdout || '').trim()}`,
      excelByKey: new Map(),
    }
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
  return { ok: true, excelByKey, workbookPaths }
}

function formatMarkdown(report) {
  const lines = [
    '# Purchase rates dry-run (Phase 5.3)',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Counts',
    '',
    `- Proposed inserts: **${report.counts.proposed_insert}**`,
    `- Skipped: **${report.counts.skipped}**`,
    `- Manual review: **${report.counts.manual_review}**`,
    `- Conflicts (duplicate/existing rate): **${report.counts.conflicts}**`,
    '',
    '## Rules',
    '',
    '- Verified mapping + approved coordinates note only',
    '- Excel column 6 (Rate) only — never X4÷4',
    '- No overwrite of existing purchase rates',
    '',
    'Full row detail is in the JSON report (confidential).',
  ]
  return `${lines.join('\n')}\n`
}

function main() {
  if (!fs.existsSync(PHASE52_REPORT)) {
    console.error(`Missing phase52 mapping report: ${PHASE52_REPORT}`)
    process.exit(1)
  }

  const phase52 = JSON.parse(fs.readFileSync(PHASE52_REPORT, 'utf8'))
  const sourceRows = Array.isArray(phase52.rows) ? phase52.rows : []

  /** @type {Record<string, string>} */
  const workbookPaths = {}
  for (const name of WORKBOOK_NAMES) {
    const resolved = resolveWorkbookPath(name)
    if (resolved) workbookPaths[name] = resolved
  }

  const cells = []
  for (const row of sourceRows) {
    const wb = String(row.excel_workbook ?? '').trim()
    const sheet = String(row.excel_sheet ?? '').trim()
    const excelRow = Number(row.excel_row)
    const wbPath = workbookPaths[wb]
    if (!wbPath || !sheet || !Number.isFinite(excelRow)) continue
    cells.push({
      key: excelCellKey(wb, sheet, excelRow),
      workbook_path: wbPath,
      worksheet: sheet,
      row: excelRow,
    })
  }

  const excelResult = readExcelForCells(cells, workbookPaths)
  if (!excelResult.ok) {
    console.error(`Excel read failed: ${excelResult.error}`)
    process.exit(1)
  }

  let productsById = new Map()
  let purchaseByProduct = new Map()
  try {
    productsById = loadLocalProductsMap()
    purchaseByProduct = loadCurrentPurchaseRatesMap()
  } catch (err) {
    console.error(`Local D1 read failed: ${err?.message ?? err}`)
    process.exit(1)
  }

  const plan = buildPurchaseRatesDryRunPlan(
    sourceRows,
    productsById,
    purchaseByProduct,
    excelResult.excelByKey,
  )

  const report = {
    ...plan,
    generatedAt: new Date().toISOString(),
    source: 'phase52-pricing-mapping-report.json',
    meta: {
      workbooks_resolved: workbookPaths,
      d1_product_count: productsById.size,
      d1_current_purchase_rates: purchaseByProduct.size,
      d1_current_x4_rates_note: 'private_rates unchanged by this plan',
    },
  }

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true })
  fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  fs.writeFileSync(REPORT_MD, formatMarkdown(report), 'utf8')

  console.log('Purchase rates dry-run: OK')
  console.log(`Report JSON: ${path.relative(SERVER_ROOT, REPORT_JSON)}`)
  console.log(`Report MD:   ${path.relative(SERVER_ROOT, REPORT_MD)}`)
  console.log(`Proposed inserts: ${report.counts.proposed_insert}`)
  console.log(`Skipped: ${report.counts.skipped}`)
  console.log(`Manual review: ${report.counts.manual_review}`)
  console.log(`Conflicts: ${report.counts.conflicts}`)
  console.log(`Existing purchase rates in D1: ${purchaseByProduct.size}`)
  console.log('\nNo D1 writes. Review the report before: npm run purchase:rates:import:apply')
}

main()
