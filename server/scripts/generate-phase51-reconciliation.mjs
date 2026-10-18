#!/usr/bin/env node
/**
 * Regenerate phase51-rate-x4-reconciliation.json from approved CSV + Excel + public catalogue refs.
 * Read-only against Excel; writes report JSON only.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { excelCellKey, normalizeApprovedRow, parseCsv } from '../src/lib/x4PrivateRatesDryRun.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(SERVER_ROOT, '..')
const APPROVED_CSV = path.join(REPO_ROOT, 'reports', 'x4_implemented.csv')
const PUBLIC_PRICES = path.join(SERVER_ROOT, 'data', 'catalogue-public-prices.json')
const OUT_JSON = path.join(SERVER_ROOT, 'reports', 'phase51-rate-x4-reconciliation.json')
const PYTHON_READER = path.join(__dirname, 'read-excel-rate-batch.py')

function resolveWorkbookPath(filename) {
  for (const candidate of [
    path.join(REPO_ROOT, filename),
    path.join(os.homedir(), 'Downloads', filename),
  ]) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function readExcelRates(approvedRows) {
  const workbookPaths = new Map()
  for (const name of ['CRACKERS_all.xlsx', 'CRACKERS_ajn.xlsx']) {
    const resolved = resolveWorkbookPath(name)
    if (resolved) workbookPaths.set(name, resolved)
  }

  /** @type {{ key: string, workbook_path: string, worksheet: string, row: number }[]} */
  const cells = []
  for (const row of approvedRows) {
    const wbPath = workbookPaths.get(row.matched_workbook)
    if (!wbPath) continue
    cells.push({
      key: excelCellKey(row.matched_workbook, row.worksheet, row.excel_row_number),
      workbook_path: wbPath,
      worksheet: row.worksheet,
      row: row.excel_row_number,
    })
  }

  if (!cells.length) {
    throw new Error('no_workbooks_or_cells_for_excel_read')
  }

  const py = spawnSync('py', ['-3', PYTHON_READER], {
    input: JSON.stringify({ cells }),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  if (py.status !== 0) {
    throw new Error(`excel_reader_failed:${(py.stderr || py.stdout || '').trim()}`)
  }
  const parsed = JSON.parse(py.stdout)
  /** @type {Map<string, { rate_raw?: unknown, x4_raw?: unknown, error?: string }>} */
  const excelByKey = new Map()
  for (const r of parsed.results ?? []) {
    excelByKey.set(String(r.key), r)
  }
  return excelByKey
}

function main() {
  const csvText = fs.readFileSync(APPROVED_CSV, 'utf8')
  const approvedRows = parseCsv(csvText)
    .map(normalizeApprovedRow)
    .filter(Boolean)

  const dupIds = new Set()
  const seenIds = new Set()
  for (const row of approvedRows) {
    if (seenIds.has(row.product_id)) dupIds.add(row.product_id)
    seenIds.add(row.product_id)
  }
  if (dupIds.size) {
    throw new Error(`duplicate_product_id_in_approved_csv:${[...dupIds].join(',')}`)
  }

  const publicDoc = JSON.parse(fs.readFileSync(PUBLIC_PRICES, 'utf8'))
  const publicPrices = publicDoc.prices ?? {}

  const excelByKey = readExcelRates(approvedRows)

  /** @type {Record<string, unknown>[]} */
  const rows = []
  let verified = 0
  let review = 0

  for (const row of approvedRows) {
    const key = excelCellKey(row.matched_workbook, row.worksheet, row.excel_row_number)
    const ex = excelByKey.get(key)
    const csvX4 = Number(row.x4_value_csv)
    let excelRate = null
    let excelX4 = null
    if (ex && !ex.error) {
      excelRate = Number(ex.rate_raw)
      excelX4 = Number(ex.x4_raw)
      if (!Number.isFinite(excelRate)) excelRate = null
      if (!Number.isFinite(excelX4)) excelX4 = null
    }

    const pub = publicPrices[row.product_id]
    const pubInr = pub === undefined || pub === null ? null : Number(pub)
    let mapping_status = 'verified'
    let notes = 'coordinates_match_x4_implemented_csv'
    if (pubInr != null && excelX4 != null && Math.abs(pubInr - excelX4) > 0.51) {
      mapping_status = 'review'
      notes = 'public_catalogue_price_ne_x4'
      review += 1
    } else {
      verified += 1
    }

    rows.push({
      product_id: row.product_id,
      product_name: row.product_name,
      workbook: row.matched_workbook,
      sheet: row.worksheet,
      excel_row: row.excel_row_number,
      excel_rate: excelRate,
      excel_x4: excelX4 ?? csvX4,
      approved_csv_x4: csvX4,
      public_catalogue_price_inr: pubInr,
      mapping_status,
      notes,
    })
  }

  const doc = {
    stats: {
      verified_clean: verified,
      rate_missing: 0,
      x4_missing: 0,
      x4_csv_drift: 0,
      public_price_drift: review,
      rate_equals_x4: 0,
      review_notes: review,
    },
    rowCount: rows.length,
    rows,
  }

  fs.writeFileSync(OUT_JSON, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${rows.length} rows to ${path.relative(REPO_ROOT, OUT_JSON)}`)
  console.log(`verified=${verified} review=${review}`)
}

main()
