/**
 * Phase 1: dry-run validation for Excel X4 → D1 private_rates (no writes, no public exposure).
 */
import { inrToPaise } from '../services/money.js'

const X4_DRIFT_TOLERANCE = 0.001

/** @param {string} text */
export function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (!lines.length) return []
  const header = splitCsvLine(lines[0])
  const rows = []
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim()) continue
    const cols = splitCsvLine(line)
    /** @type {Record<string, string>} */
    const row = {}
    for (let c = 0; c < header.length; c += 1) {
      row[header[c]] = cols[c] ?? ''
    }
    rows.push(row)
  }
  return rows
}

/** @param {string} line */
function splitCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

/**
 * @param {Record<string, string>} row
 * @returns {import('./x4PrivateRatesDryRun.types.js').ApprovedMappingRow | null}
 */
export function normalizeApprovedRow(row) {
  const product_id = String(row.product_id ?? '').trim()
  if (!product_id) return null
  const excel_row_number = Number(row.excel_row_number)
  if (!Number.isFinite(excel_row_number) || excel_row_number < 1) return null
  return {
    product_id,
    product_name: String(row.product_name ?? '').trim(),
    company_comp: String(row.company_comp ?? '').trim(),
    matched_workbook: String(row.matched_workbook ?? '').trim(),
    bill_number: String(row.bill_number ?? '').trim(),
    worksheet: String(row.worksheet ?? '').trim(),
    excel_row_number: Math.floor(excel_row_number),
    x4_value_csv: String(row.x4_value ?? '').trim(),
  }
}

/** @param {unknown} raw */
export function parseExcelX4Inr(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: false, reason: 'missing_x4' }
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || Number.isNaN(n)) {
    return { ok: false, reason: 'invalid_rate' }
  }
  if (n < 0) {
    return { ok: false, reason: 'invalid_rate' }
  }
  return { ok: true, inr: n }
}

/** @param {number} inr */
export function inrX4ToPaise(inr) {
  return inrToPaise(inr)
}

/** @param {string} a @param {string} b */
export function normalizeNameForWarning(a, b) {
  return {
    a: String(a ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase(),
    b: String(b ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase(),
  }
}

/**
 * @param {string} workbookFile
 * @param {string} worksheet
 * @param {number} row
 */
export function excelCellKey(workbookFile, worksheet, row) {
  return `${workbookFile}|${worksheet}|${row}`
}

/**
 * @param {import('./x4PrivateRatesDryRun.types.js').ApprovedMappingRow[]} approvedRows
 */
export function findDuplicateApprovedIds(approvedRows) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const row of approvedRows) {
    counts.set(row.product_id, (counts.get(row.product_id) ?? 0) + 1)
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id)
}

/**
 * @param {{
 *   approvedRows: import('./x4PrivateRatesDryRun.types.js').ApprovedMappingRow[]
 *   pendingRows: Record<string, string>[]
 *   productsById: Map<string, { id: string, name: string }>
 *   currentRatesByProductId: Map<string, { unit_rate_paise: number, id: number }>
 *   excelByKey: Map<string, { comp?: string, particulars?: string, x4_raw?: unknown, error?: string }>
 *   duplicateApprovedIds: string[]
 *   generatedAt?: string
 *   meta?: Record<string, unknown>
 * }} input
 */
export function buildDryRunReport(input) {
  const {
    approvedRows,
    pendingRows,
    productsById,
    currentRatesByProductId,
    excelByKey,
    duplicateApprovedIds,
    generatedAt = new Date().toISOString(),
    meta = {},
  } = input

  const duplicateSet = new Set(duplicateApprovedIds)

  /** @type {import('./x4PrivateRatesDryRun.types.js').DryRunReport} */
  const report = {
    generatedAt,
    mode: 'dry_run',
    meta,
    counts: {},
    ready_for_import: [],
    catalogue_missing: [],
    duplicate_approved_id: [],
    missing_x4: [],
    invalid_rate: [],
    excel_drift: [],
    comp_drift: [],
    excel_read_error: [],
    name_warning: [],
    would_conflict: [],
    blocked_manual: [],
    no_rate_yet: [],
  }

  const approvedIds = new Set(approvedRows.map((r) => r.product_id))
  const pendingIds = new Set(
    pendingRows.map((r) => String(r.product_id ?? '').trim()).filter(Boolean),
  )

  for (const dupId of duplicateSet) {
    report.duplicate_approved_id.push({
      product_id: dupId,
      message: 'product_id appears more than once in approved CSV',
    })
  }

  /** @type {Set<string>} */
  const readyIds = new Set()

  for (const row of approvedRows) {
    const base = {
      product_id: row.product_id,
      product_name_csv: row.product_name,
      matched_workbook: row.matched_workbook,
      worksheet: row.worksheet,
      excel_row_number: row.excel_row_number,
      company_comp_csv: row.company_comp,
      x4_value_csv: row.x4_value_csv,
    }

    if (duplicateSet.has(row.product_id)) {
      continue
    }

    const product = productsById.get(row.product_id)
    if (!product) {
      report.catalogue_missing.push({
        ...base,
        message: 'product_id not in D1 products catalogue',
      })
      continue
    }

    const key = excelCellKey(row.matched_workbook, row.worksheet, row.excel_row_number)
    const excel = excelByKey.get(key)
    if (!excel) {
      report.excel_read_error.push({ ...base, key, message: 'no excel cell data for coordinates' })
      continue
    }
    if (excel.error) {
      report.excel_read_error.push({ ...base, key, message: excel.error })
      continue
    }

    const parsedCsv = Number(row.x4_value_csv)
    const parsedExcel = parseExcelX4Inr(excel.x4_raw)
    if (!parsedExcel.ok) {
      report[parsedExcel.reason === 'missing_x4' ? 'missing_x4' : 'invalid_rate'].push({
        ...base,
        x4_excel_raw: excel.x4_raw,
        message: parsedExcel.reason,
      })
      continue
    }

    const csvInr = Number(row.x4_value_csv)
    if (!Number.isFinite(csvInr)) {
      report.invalid_rate.push({ ...base, message: 'invalid_x4_in_approved_csv' })
      continue
    }
    if (Math.abs(csvInr - parsedExcel.inr) > X4_DRIFT_TOLERANCE) {
      report.excel_drift.push({
        ...base,
        x4_excel_inr: parsedExcel.inr,
        x4_csv_inr: csvInr,
        message: 'live Excel X4 differs from approved CSV x4_value',
      })
      continue
    }

    const compExcel = String(excel.comp ?? '').trim()
    if (compExcel !== row.company_comp.trim()) {
      report.comp_drift.push({
        ...base,
        company_comp_excel: compExcel,
        message: 'Excel Comp column does not match approved company_comp',
      })
      continue
    }

    let unit_rate_paise
    try {
      unit_rate_paise = inrX4ToPaise(parsedExcel.inr)
    } catch {
      report.invalid_rate.push({ ...base, message: 'paise_conversion_failed' })
      continue
    }

    const { a, b } = normalizeNameForWarning(product.name, excel.particulars)
    /** @type {string[]} */
    const warnings = []
    if (a !== b) {
      report.name_warning.push({
        product_id: row.product_id,
        d1_name: product.name,
        excel_particulars: excel.particulars ?? '',
        message: 'display name differs from Excel Particulars (coordinate match OK)',
      })
      warnings.push('name_warning')
    }

    const existing = currentRatesByProductId.get(row.product_id)
    if (existing) {
      report.would_conflict.push({
        ...base,
        d1_name: product.name,
        unit_rate_paise_proposed: unit_rate_paise,
        existing_private_rate_id: existing.id,
        existing_unit_rate_paise: existing.unit_rate_paise,
        message: 'current private_rates row exists; import would require explicit supersede (not in Phase 1)',
      })
      continue
    }

    report.ready_for_import.push({
      ...base,
      d1_name: product.name,
      company_comp_excel: compExcel,
      excel_particulars: excel.particulars ?? '',
      x4_inr: parsedExcel.inr,
      unit_rate_paise,
      warnings,
    })
    readyIds.add(row.product_id)
  }

  for (const row of pendingRows) {
    const product_id = String(row.product_id ?? '').trim()
    if (!product_id) continue
    report.blocked_manual.push({
      product_id,
      product_name: String(row.product_name ?? '').trim(),
      reason_skipped: String(row.reason_skipped ?? '').trim(),
      possible_excel_matches: String(row.possible_excel_matches ?? '').trim(),
      message: 'pending manual mapping — not eligible for automatic import',
    })
  }

  for (const [id, product] of productsById) {
    if (readyIds.has(id)) continue
    if (pendingIds.has(id)) continue
    if (approvedIds.has(id)) continue
    report.no_rate_yet.push({
      product_id: id,
      d1_name: product.name,
      message: 'no approved or pending mapping row',
    })
  }

  for (const bucket of [
    'ready_for_import',
    'catalogue_missing',
    'duplicate_approved_id',
    'missing_x4',
    'invalid_rate',
    'excel_drift',
    'comp_drift',
    'excel_read_error',
    'name_warning',
    'would_conflict',
    'blocked_manual',
    'no_rate_yet',
  ]) {
    report.counts[bucket] = report[bucket].length
  }

  report.counts.approved_csv_rows = approvedRows.length
  report.counts.pending_csv_rows = pendingRows.length
  report.counts.d1_product_count = productsById.size

  return report
}

/** @param {import('./x4PrivateRatesDryRun.types.js').DryRunReport} report */
export function formatDryRunMarkdown(report) {
  const lines = [
    '# X4 private rates — dry-run report',
    '',
    `Generated: ${report.generatedAt}`,
    `Mode: **${report.mode}** (no D1 writes)`,
    '',
    '## Summary counts',
    '',
    '| Bucket | Count |',
    '|--------|------:|',
  ]
  for (const [k, v] of Object.entries(report.counts)) {
    lines.push(`| ${k} | ${v} |`)
  }
  lines.push('', '## Notes', '')
  lines.push('- Source: Excel column **X4** at approved CSV coordinates only.')
  lines.push('- `selling_price_4x` from `diwali_product_master_final.csv` is **not** used.')
  lines.push('- Pending CSV rows are **blocked**; no fuzzy duplicate resolution.')
  lines.push('')

  if (report.meta && Object.keys(report.meta).length) {
    lines.push('## Run metadata', '')
    for (const [k, v] of Object.entries(report.meta)) {
      lines.push(`- **${k}:** ${String(v)}`)
    }
    lines.push('')
  }

  if (report.counts.ready_for_import !== report.counts.approved_csv_rows) {
    lines.push(
      `> **Discrepancy:** ${report.counts.ready_for_import} ready rows vs ${report.counts.approved_csv_rows} approved CSV rows — review buckets below.`,
      '',
    )
  }

  const sections = [
    ['Ready for import', 'ready_for_import'],
    ['Catalogue missing', 'catalogue_missing'],
    ['Duplicate approved ID', 'duplicate_approved_id'],
    ['Excel drift', 'excel_drift'],
    ['Comp drift', 'comp_drift'],
    ['Missing X4', 'missing_x4'],
    ['Invalid rate', 'invalid_rate'],
    ['Excel read error', 'excel_read_error'],
    ['Would conflict (existing rate)', 'would_conflict'],
    ['Blocked manual (pending CSV)', 'blocked_manual'],
    ['No rate yet', 'no_rate_yet'],
    ['Name warnings (informational)', 'name_warning'],
  ]

  for (const [title, key] of sections) {
    const items = report[key]
    lines.push(`## ${title}`, '')
    if (!items?.length) {
      lines.push('_None._', '')
      continue
    }
    lines.push('```json')
    lines.push(JSON.stringify(items.slice(0, 50), null, 2))
    if (items.length > 50) {
      lines.push(`... ${items.length - 50} more (see JSON report)`)
    }
    lines.push('```', '')
  }

  return lines.join('\n')
}
