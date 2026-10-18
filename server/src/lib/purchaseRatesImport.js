/**
 * Phase 5.3: validate purchase-rate dry-run reports and build INSERT plans.
 */
import { inrToPaise } from '../services/money.js'
import { formatEffectiveFromUtc } from './x4PrivateRatesImport.js'
import { sqlString } from './x4PrivateRatesImport.js'
import {
  APPROVED_MAPPING_NOTES,
  APPROVED_MAPPING_STATUS,
  inrWithinTolerance,
  parseExcelRateInr,
} from './purchaseRatesDryRun.js'
import { excelCellKey } from './x4PrivateRatesDryRun.js'

export { formatEffectiveFromUtc, DEFAULT_MAX_REPORT_AGE_MS } from './x4PrivateRatesImport.js'
export { validateReportFreshness } from './x4PrivateRatesImport.js'

/** @param {Record<string, unknown>} row */
export function buildPurchaseProvenanceNote(row) {
  const parts = [
    'purchase_rate_import_phase53',
    `workbook=${row.matched_workbook}`,
    `sheet=${row.worksheet}`,
    `row=${row.excel_row_number}`,
    `rate_inr=${row.purchase_rate_inr}`,
    'source=phase52-verified-mapping',
  ]
  return parts.join('|')
}

/**
 * @param {{
 *   product_id: string
 *   unit_rate_paise: number
 *   effective_from: string
 *   notes: string
 * }} row
 */
export function buildInsertPurchaseRateSql(row) {
  return `INSERT INTO product_purchase_rates (product_id, unit_rate_paise, effective_from, notes)
VALUES (${sqlString(row.product_id)}, ${Number(row.unit_rate_paise)}, ${sqlString(row.effective_from)}, ${sqlString(row.notes)});`
}

/** @param {Record<string, unknown>[]} readyRows @param {string} effectiveFromUtc */
export function buildPurchaseImportSqlBatch(readyRows, effectiveFromUtc) {
  const lines = ['PRAGMA foreign_keys = ON;', 'BEGIN TRANSACTION;']
  for (const row of readyRows) {
    const paise = inrToPaise(Number(row.purchase_rate_inr))
    if (paise !== row.unit_rate_paise) {
      throw new Error(
        `${row.product_id}: unit_rate_paise ${row.unit_rate_paise} != inrToPaise(${row.purchase_rate_inr})=${paise}`,
      )
    }
    lines.push(
      buildInsertPurchaseRateSql({
        product_id: String(row.product_id),
        unit_rate_paise: paise,
        effective_from: effectiveFromUtc,
        notes: buildPurchaseProvenanceNote(row),
      }),
    )
  }
  lines.push('COMMIT;')
  return `${lines.join('\n')}\n`
}

/** @param {Record<string, unknown>} report */
export function validatePurchaseDryRunReportForImport(report) {
  /** @type {string[]} */
  const errors = []
  if (report?.mode !== 'dry_run') errors.push('report_mode_must_be_dry_run')
  const ready = report?.ready_for_import
  if (!Array.isArray(ready)) {
    errors.push('ready_for_import_missing')
    return errors
  }
  const ids = new Set()
  for (const row of ready) {
    const id = String(row.product_id ?? '').trim()
    if (!id) errors.push('ready_row_missing_product_id')
    if (ids.has(id)) errors.push(`duplicate_ready_product_id:${id}`)
    ids.add(id)
    if (row.mapping_status !== APPROVED_MAPPING_STATUS) {
      errors.push(`ready_row_not_verified:${id}`)
    }
    if (row.mapping_notes !== APPROVED_MAPPING_NOTES) {
      errors.push(`ready_row_mapping_notes_not_approved:${id}`)
    }
    if (row.action !== 'insert') errors.push(`ready_row_action_not_insert:${id}`)
    const paise = Number(row.unit_rate_paise)
    if (!Number.isInteger(paise) || paise < 0) errors.push(`ready_row_invalid_paise:${id}`)
    const expected = inrToPaise(Number(row.purchase_rate_inr))
    if (expected !== paise) errors.push(`ready_row_paise_mismatch:${id}`)
  }
  const expectedReady = Number(report?.counts?.proposed_insert)
  if (Number.isFinite(expectedReady) && expectedReady !== ready.length) {
    errors.push(`ready_count_mismatch:counts=${expectedReady},actual=${ready.length}`)
  }
  return errors
}

/**
 * @param {Record<string, unknown>} report
 * @param {Map<string, { id: string }>} productsById
 * @param {Map<string, { unit_rate_paise: number }>} purchaseByProduct
 */
export function validatePurchaseReadyAgainstLiveD1(report, productsById, purchaseByProduct) {
  /** @type {string[]} */
  const errors = []
  for (const row of report.ready_for_import ?? []) {
    const id = String(row.product_id)
    if (!productsById.has(id)) errors.push(`d1_product_missing:${id}`)
    if (purchaseByProduct.has(id)) errors.push(`d1_purchase_rate_exists:${id}`)
  }
  return errors
}

/**
 * @param {Record<string, unknown>} report
 * @param {Map<string, Record<string, unknown>>} excelByKey
 */
export function validatePurchaseReadyAgainstExcel(report, excelByKey) {
  /** @type {string[]} */
  const errors = []
  for (const row of report.ready_for_import ?? []) {
    const id = String(row.product_id)
    const key = excelCellKey(String(row.matched_workbook), String(row.worksheet), Number(row.excel_row_number))
    const excel = excelByKey.get(key)
    if (!excel) {
      errors.push(`excel_missing:${id}`)
      continue
    }
    if (excel.error) {
      errors.push(`excel_read_error:${id}:${excel.error}`)
      continue
    }
    const liveRate = parseExcelRateInr(excel.rate_raw)
    if (!liveRate.ok) {
      errors.push(`excel_live_rate_${liveRate.reason}:${id}`)
      continue
    }
    if (!inrWithinTolerance(liveRate.inr, Number(row.purchase_rate_inr))) {
      errors.push(`excel_rate_drift:${id}`)
    }
    const liveX4 = parseExcelRateInr(excel.x4_raw)
    if (
      liveX4.ok &&
      row.excel_x4_inr_crosscheck != null &&
      !inrWithinTolerance(liveX4.inr, Number(row.excel_x4_inr_crosscheck))
    ) {
      errors.push(`excel_x4_crosscheck_drift:${id}`)
    }
  }
  return errors
}

/**
 * In-memory apply for tests (transactional semantics).
 * @param {Record<string, unknown>[]} readyRows
 * @param {Map<string, { unit_rate_paise: number }>} purchaseByProduct
 */
export function applyPurchaseImportPlanInMemory(readyRows, purchaseByProduct, opts = {}) {
  const snapshot = new Map(purchaseByProduct)
  /** @type {string[]} */
  const inserted = []
  try {
    for (const row of readyRows) {
      const id = String(row.product_id)
      if (purchaseByProduct.has(id)) {
        throw new Error(`purchase_rate_exists:${id}`)
      }
      if (opts.failOnProductId && id === opts.failOnProductId) {
        throw new Error('injected_failure')
      }
      const paise = inrToPaise(Number(row.purchase_rate_inr))
      purchaseByProduct.set(id, { unit_rate_paise: paise })
      inserted.push(id)
    }
  } catch (err) {
    purchaseByProduct.clear()
    for (const [k, v] of snapshot) purchaseByProduct.set(k, v)
    return { ok: false, inserted, error: String(err?.message ?? err) }
  }
  return { ok: true, inserted }
}
