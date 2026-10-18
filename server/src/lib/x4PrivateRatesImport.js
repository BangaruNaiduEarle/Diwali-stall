/**
 * Phase 2: validate dry-run reports and build private_rates INSERT plans (no public exposure).
 */
import { inrToPaise } from '../services/money.js'
import { inrX4ToPaise } from './x4PrivateRatesDryRun.js'

/**
 * Eligible catalogue products with approved coordinates (161 CSV rows − P142 not in catalogue).
 * @see reports/x4_implemented.csv
 */
export const EXPECTED_READY_COUNT = 160

export const BLOCKED_CATALOGUE_MISSING_ID = 'P142'

/** @type {readonly string[]} */
export const REQUIRED_ZERO_BUCKETS = [
  'duplicate_approved_id',
  'missing_x4',
  'invalid_rate',
  'excel_drift',
  'comp_drift',
  'excel_read_error',
]

/** Default max report age for --apply (24 hours). */
export const DEFAULT_MAX_REPORT_AGE_MS = 24 * 60 * 60 * 1000

/**
 * UTC effective_from for SQLite datetime('now') comparisons — documented format.
 * @param {Date} [now]
 * @returns {string} `YYYY-MM-DD HH:MM:SS` in UTC
 */
export function formatEffectiveFromUtc(now = new Date()) {
  const iso = now.toISOString()
  return iso.slice(0, 19).replace('T', ' ')
}

/**
 * @param {unknown} value
 */
export function sqlString(value) {
  if (value === null || value === undefined) return 'NULL'
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * @param {Record<string, unknown>} row ready_for_import entry
 */
export function buildProvenanceNote(row) {
  const parts = [
    'x4_import_phase2',
    `workbook=${row.matched_workbook}`,
    `sheet=${row.worksheet}`,
    `row=${row.excel_row_number}`,
    `comp=${row.company_comp_excel ?? row.company_comp_csv}`,
    `x4_inr=${row.x4_inr}`,
    'source=reports/x4_implemented.csv',
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
export function buildInsertPrivateRateSql(row) {
  return `INSERT INTO private_rates (product_id, unit_rate_paise, effective_from, notes)
VALUES (${sqlString(row.product_id)}, ${Number(row.unit_rate_paise)}, ${sqlString(row.effective_from)}, ${sqlString(row.notes)});`
}

/**
 * @param {import('./x4PrivateRatesDryRun.js').DryRunReport['ready_for_import']} readyRows
 * @param {string} effectiveFromUtc
 */
export function buildImportSqlBatch(readyRows, effectiveFromUtc) {
  const lines = [
    'PRAGMA foreign_keys = ON;',
    'BEGIN TRANSACTION;',
  ]

  for (const row of readyRows) {
    const paise = inrX4ToPaise(Number(row.x4_inr))
    if (paise !== row.unit_rate_paise) {
      throw new Error(
        `${row.product_id}: unit_rate_paise ${row.unit_rate_paise} != inrToPaise(${row.x4_inr})=${paise}`,
      )
    }
    lines.push(
      buildInsertPrivateRateSql({
        product_id: row.product_id,
        unit_rate_paise: paise,
        effective_from: effectiveFromUtc,
        notes: buildProvenanceNote(row),
      }),
    )
  }

  lines.push('COMMIT;')
  return `${lines.join('\n\n')}\n`
}

/**
 * @param {string} generatedAt ISO timestamp from report
 * @param {number} maxAgeMs
 * @param {Date} [now]
 */
export function validateReportFreshness(generatedAt, maxAgeMs, now = new Date()) {
  const errors = []
  const ts = Date.parse(String(generatedAt ?? ''))
  if (!Number.isFinite(ts)) {
    errors.push('report_missing_or_invalid_generatedAt')
    return errors
  }
  const ageMs = now.getTime() - ts
  if (ageMs < 0) {
    errors.push('report_generatedAt_in_future')
  }
  if (ageMs > maxAgeMs) {
    errors.push(`report_stale:age_ms=${ageMs},max_ms=${maxAgeMs}`)
  }
  return errors
}

/**
 * @param {Record<string, unknown>} report
 */
export function validateDryRunReportForImport(report) {
  const errors = []

  if (report?.mode !== 'dry_run') {
    errors.push(`invalid_report_mode:${report?.mode}`)
  }

  const counts = report?.counts ?? {}
  const ready = report?.ready_for_import
  if (!Array.isArray(ready)) {
    errors.push('missing_ready_for_import_array')
    return errors
  }

  if (counts.ready_for_import !== ready.length) {
    errors.push('counts.ready_for_import mismatch with array length')
  }

  const approvedCsvRows = Number(counts.approved_csv_rows ?? 0)
  const failureBuckets = [
    'catalogue_missing',
    'duplicate_approved_id',
    'missing_x4',
    'invalid_rate',
    'excel_drift',
    'comp_drift',
    'excel_read_error',
    'would_conflict',
  ]
  let accounted = ready.length
  for (const bucket of failureBuckets) {
    accounted += Number(counts[bucket] ?? 0)
  }
  if (approvedCsvRows > 0 && accounted !== approvedCsvRows) {
    errors.push(
      `approved_rows_not_accounted:approved=${approvedCsvRows},accounted=${accounted},ready=${ready.length}`,
    )
  }
  if (approvedCsvRows > 0 && Number(counts.would_conflict ?? 0) === 0 && ready.length !== EXPECTED_READY_COUNT) {
    errors.push(`ready_count_mismatch:expected=${EXPECTED_READY_COUNT},actual=${ready.length}`)
  }

  const ids = ready.map((r) => String(r.product_id))
  const unique = new Set(ids)
  if (unique.size !== ids.length) {
    errors.push('duplicate_product_id_in_ready_for_import')
  }

  if (ids.includes(BLOCKED_CATALOGUE_MISSING_ID)) {
    errors.push('P142_must_not_be_in_ready_for_import')
  }

  const blocked = report?.blocked_manual ?? []
  const expectedBlocked = Number(report?.counts?.pending_csv_rows ?? 0)
  if (!Array.isArray(blocked) || blocked.length !== expectedBlocked) {
    errors.push(
      `blocked_manual_count_expected_${expectedBlocked}:actual=${blocked?.length ?? 0}`,
    )
  }
  const blockedIds = new Set(blocked.map((b) => String(b.product_id)))
  for (const id of blockedIds) {
    if (unique.has(id)) {
      errors.push(`pending_id_in_ready:${id}`)
    }
  }

  for (const bucket of REQUIRED_ZERO_BUCKETS) {
    const n = Number(counts[bucket] ?? 0)
    if (n !== 0) {
      errors.push(`bucket_must_be_zero:${bucket}=${n}`)
    }
  }

  if (Number(counts.catalogue_missing ?? 0) !== 1) {
    errors.push(`catalogue_missing_expected_1:actual=${counts.catalogue_missing}`)
  } else {
    const cm = report?.catalogue_missing ?? []
    if (!cm.some((r) => r.product_id === BLOCKED_CATALOGUE_MISSING_ID)) {
      errors.push('catalogue_missing_must_include_P142')
    }
  }

  for (const row of ready) {
    if (!row.product_id || !row.matched_workbook || !row.worksheet || !row.excel_row_number) {
      errors.push(`ready_row_missing_coordinates:${row.product_id ?? 'unknown'}`)
    }
    if (!Number.isFinite(Number(row.x4_inr))) {
      errors.push(`ready_row_invalid_x4_inr:${row.product_id}`)
    }
    if (!Number.isInteger(row.unit_rate_paise) || row.unit_rate_paise < 0) {
      errors.push(`ready_row_invalid_paise:${row.product_id}`)
    }
    try {
      if (inrToPaise(Number(row.x4_inr)) !== row.unit_rate_paise) {
        errors.push(`ready_row_paise_mismatch:${row.product_id}`)
      }
    } catch {
      errors.push(`ready_row_paise_conversion_failed:${row.product_id}`)
    }
  }

  const meta = report?.meta ?? {}
  if (!meta.approved_csv || !String(meta.approved_csv).includes('x4_implemented.csv')) {
    errors.push('report_meta_missing_approved_csv_reference')
  }
  if (!meta.pending_csv || !String(meta.pending_csv).includes('x4_pending_manual.csv')) {
    errors.push('report_meta_missing_pending_csv_reference')
  }
  if (meta.d1_skipped === true) {
    errors.push('report_d1_was_skipped')
  }

  return errors
}

/**
 * @param {Record<string, unknown>} report
 * @param {Map<string, { id: string, name: string }>} productsById
 * @param {Map<string, { id: number, unit_rate_paise: number }>} currentRatesByProductId
 */
export function validateReadyAgainstLiveD1(report, productsById, currentRatesByProductId) {
  const errors = []
  const ready = report?.ready_for_import ?? []

  for (const row of ready) {
    const id = String(row.product_id)
    if (!productsById.has(id)) {
      errors.push(`d1_product_missing:${id}`)
    }
    if (currentRatesByProductId.has(id)) {
      errors.push(`d1_existing_current_rate:${id}`)
    }
  }

  if (productsById.size > 0 && ready.length === EXPECTED_READY_COUNT) {
    const readySet = new Set(ready.map((r) => String(r.product_id)))
    if (currentRatesByProductId.size > 0) {
      for (const id of readySet) {
        if (currentRatesByProductId.has(id)) {
          errors.push(`d1_conflict_before_import:${id}`)
        }
      }
    }
  }

  return errors
}

/**
 * Re-check live Excel column G + Comp for each ready row (same coordinates as report).
 * @param {Record<string, unknown>} report
 * @param {Map<string, { comp?: string, x4_raw?: unknown, error?: string }>} excelByKey
 */
export function validateReadyAgainstExcel(report, excelByKey) {
  const errors = []
  const ready = report?.ready_for_import ?? []

  for (const row of ready) {
    const key = `${row.matched_workbook}|${row.worksheet}|${row.excel_row_number}`
    const ex = excelByKey.get(key)
    if (!ex || ex.error) {
      errors.push(`excel_read_failed:${row.product_id}:${ex?.error ?? 'missing'}`)
      continue
    }
    const g = Number(ex.x4_raw)
    if (!Number.isFinite(g) || Math.abs(g - Number(row.x4_inr)) > 0.001) {
      errors.push(`excel_x4_drift:${row.product_id}`)
    }
    const compExcel = String(ex.comp ?? '').trim()
    const compExpected = String(row.company_comp_excel ?? row.company_comp_csv ?? '').trim()
    if (compExcel !== compExpected) {
      errors.push(`excel_comp_drift:${row.product_id}`)
    }
  }

  return errors
}

/**
 * In-memory apply for tests — simulates INSERT-only with one-current-rate rule.
 * @param {{
 *   readyRows: Array<{ product_id: string, unit_rate_paise: number, x4_inr: number }>
 *   effectiveFrom: string
 *   products: Set<string>
 *   rates: Map<string, { unit_rate_paise: number, effective_from: string, notes: string }>
 * }} input
 */
export function applyImportPlanInMemory(input) {
  const { readyRows, effectiveFrom, products, rates } = input
  const snapshot = new Map(rates)

  try {
    for (const row of readyRows) {
      if (!products.has(row.product_id)) {
        throw new Error(`missing_product:${row.product_id}`)
      }
      if (rates.has(row.product_id)) {
        throw new Error(`existing_rate:${row.product_id}`)
      }
      const paise = inrToPaise(Number(row.x4_inr))
      if (paise !== row.unit_rate_paise) {
        throw new Error(`paise_mismatch:${row.product_id}`)
      }
      rates.set(row.product_id, {
        unit_rate_paise: paise,
        effective_from: effectiveFrom,
        notes: 'test',
      })
    }
  } catch (err) {
    rates.clear()
    for (const [k, v] of snapshot) rates.set(k, v)
    throw err
  }
}

/**
 * @param {Map<string, unknown>} rates
 * @param {Map<string, unknown>} snapshot
 */
export function restoreRatesMap(rates, snapshot) {
  rates.clear()
  for (const [k, v] of snapshot) rates.set(k, v)
}
