/**
 * Phase 5.3: dry-run plan for Excel Rate → product_purchase_rates (verified mappings only).
 */
import { inrToPaise } from '../services/money.js'
import { excelCellKey } from './x4PrivateRatesDryRun.js'

export const APPROVED_MAPPING_NOTES = 'coordinates_match_x4_implemented_csv'
export const APPROVED_MAPPING_STATUS = 'verified'

const INR_DRIFT_TOLERANCE = 0.001

/** @param {unknown} raw */
export function parseExcelRateInr(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: false, reason: 'missing_rate' }
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

/** @param {number} a @param {number} b */
export function inrWithinTolerance(a, b, tolerance = INR_DRIFT_TOLERANCE) {
  return Math.abs(Number(a) - Number(b)) <= tolerance
}

/**
 * @param {Record<string, unknown>} row phase52 mapping row
 */
export function normalizePhase52Row(row) {
  const product_id = String(row.product_id ?? '').trim()
  if (!product_id) return null
  const excel_row = Number(row.excel_row)
  if (!Number.isFinite(excel_row) || excel_row < 1) return null
  return {
    product_id,
    product_name: String(row.product_name ?? '').trim(),
    workbook: String(row.excel_workbook ?? '').trim(),
    sheet: String(row.excel_sheet ?? '').trim(),
    excel_row: Math.floor(excel_row),
    excel_rate_inr: row.excel_rate_inr,
    excel_x4_inr: row.excel_x4_inr,
    mapping_status: String(row.mapping_status ?? '').trim(),
    mapping_notes: String(row.mapping_notes ?? '').trim(),
    stored_purchase_paise:
      row.stored_purchase_paise === null || row.stored_purchase_paise === undefined
        ? null
        : Number(row.stored_purchase_paise),
  }
}

/** @param {ReturnType<typeof normalizePhase52Row>[]} rows @param {Map<string, { id: string, name: string }>} productsById @param {Map<string, { unit_rate_paise: number }>} purchaseByProduct @param {Map<string, unknown>} excelByKey */
export function buildPurchaseRatesDryRunPlan(rows, productsById, purchaseByProduct, excelByKey) {
  /** @type {Map<string, number>} */
  const idCounts = new Map()
  for (const row of rows) {
    if (!row) continue
    idCounts.set(row.product_id, (idCounts.get(row.product_id) ?? 0) + 1)
  }

  /** @type {Record<string, unknown>[]} */
  const ready_for_import = []
  /** @type {Record<string, unknown>[]} */
  const skipped = []
  /** @type {Record<string, unknown>[]} */
  const manual_review = []

  for (const raw of rows) {
    const row = normalizePhase52Row(raw)
    if (!row) continue

    const base = {
      product_id: row.product_id,
      product_name: row.product_name,
      matched_workbook: row.workbook,
      worksheet: row.sheet,
      excel_row_number: row.excel_row,
      excel_rate_inr_report: row.excel_rate_inr,
      excel_x4_inr_crosscheck: row.excel_x4_inr,
      mapping_status: row.mapping_status,
      mapping_notes: row.mapping_notes,
      existing_purchase_paise: purchaseByProduct.get(row.product_id)?.unit_rate_paise ?? null,
    }

    if ((idCounts.get(row.product_id) ?? 0) > 1) {
      skipped.push({ ...base, action: 'skip', reason: 'duplicate_product_id_in_source' })
      continue
    }

    if (row.mapping_status === 'review') {
      manual_review.push({ ...base, action: 'manual_review', reason: 'mapping_status_review' })
      continue
    }

    if (row.mapping_status !== APPROVED_MAPPING_STATUS) {
      manual_review.push({ ...base, action: 'manual_review', reason: 'mapping_status_not_verified' })
      continue
    }

    if (row.mapping_notes !== APPROVED_MAPPING_NOTES) {
      manual_review.push({ ...base, action: 'manual_review', reason: 'mapping_notes_not_approved' })
      continue
    }

    const reportRate = parseExcelRateInr(row.excel_rate_inr)
    if (!reportRate.ok) {
      manual_review.push({ ...base, action: 'manual_review', reason: reportRate.reason })
      continue
    }

    const product = productsById.get(row.product_id)
    if (!product) {
      skipped.push({ ...base, action: 'skip', reason: 'product_not_in_d1_catalogue' })
      continue
    }

    if (purchaseByProduct.has(row.product_id) || row.stored_purchase_paise != null) {
      skipped.push({ ...base, action: 'skip', reason: 'existing_purchase_rate_would_conflict' })
      continue
    }

    const unit_rate_paise = inrToPaise(reportRate.inr)
    const key = excelCellKey(row.workbook, row.sheet, row.excel_row)
    const excel = excelByKey.get(key)
    if (!excel) {
      manual_review.push({ ...base, action: 'manual_review', reason: 'excel_cell_not_read', excel_key: key })
      continue
    }
    if (excel.error) {
      manual_review.push({ ...base, action: 'manual_review', reason: String(excel.error), excel_key: key })
      continue
    }

    const liveRate = parseExcelRateInr(excel.rate_raw)
    if (!liveRate.ok) {
      manual_review.push({ ...base, action: 'manual_review', reason: `live_${liveRate.reason}`, excel_key: key })
      continue
    }

    if (!inrWithinTolerance(liveRate.inr, reportRate.inr)) {
      manual_review.push({
        ...base,
        action: 'manual_review',
        reason: 'excel_rate_drift',
        excel_rate_inr_live: liveRate.inr,
        excel_key: key,
      })
      continue
    }

    const liveX4 = parseExcelRateInr(excel.x4_raw)
    if (!liveX4.ok) {
      manual_review.push({ ...base, action: 'manual_review', reason: `live_x4_${liveX4.reason}`, excel_key: key })
      continue
    }

    if (row.excel_x4_inr != null && !inrWithinTolerance(liveX4.inr, Number(row.excel_x4_inr))) {
      manual_review.push({
        ...base,
        action: 'manual_review',
        reason: 'excel_x4_crosscheck_drift',
        excel_x4_inr_live: liveX4.inr,
        excel_key: key,
      })
      continue
    }

    ready_for_import.push({
      ...base,
      action: 'insert',
      d1_name: product.name,
      purchase_rate_inr: liveRate.inr,
      unit_rate_paise,
      excel_key: key,
      excel_rate_inr_live: liveRate.inr,
      excel_x4_inr_live: liveX4.inr,
    })
  }

  const counts = {
    total_source_rows: rows.length,
    proposed_insert: ready_for_import.length,
    skipped: skipped.length,
    manual_review: manual_review.length,
    conflicts: skipped.filter((r) => String(r.reason).includes('duplicate') || String(r.reason).includes('conflict'))
      .length,
  }

  return {
    mode: 'dry_run',
    ready_for_import,
    skipped,
    manual_review,
    counts,
  }
}
