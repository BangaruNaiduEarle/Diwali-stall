/**
 * Admin-only Excel mapping metadata from phase51 reconciliation (read-only reference).
 */
import reconciliationDoc from '../../reports/phase51-rate-x4-reconciliation.json' with { type: 'json' }

/** @returns {Map<string, Record<string, unknown>>} */
export function getPricingReconciliationByProductId() {
  /** @type {Map<string, Record<string, unknown>>} */
  const map = new Map()
  const rows = reconciliationDoc?.rows
  if (!Array.isArray(rows)) return map
  for (const row of rows) {
    const id = String(row.product_id ?? '').trim()
    if (!id) continue
    map.set(id, row)
  }
  return map
}

/** @param {string} productId */
export function getPricingReconciliationMeta(productId) {
  const row = getPricingReconciliationByProductId().get(String(productId ?? '').trim())
  if (!row) {
    return {
      mappingStatus: 'unmapped',
      mappingNotes: 'No row in phase51 reconciliation report.',
      excelWorkbook: null,
      excelSheet: null,
      excelRow: null,
      publicCataloguePriceDrift: null,
    }
  }
  const notes = String(row.notes ?? '')
  const mappingStatus = String(row.mapping_status ?? 'unknown')
  const pub = row.public_catalogue_price_inr
  const x4 = row.excel_x4
  let publicCataloguePriceDrift = null
  if (pub != null && x4 != null && Math.abs(Number(pub) - Number(x4)) > 0.51) {
    publicCataloguePriceDrift = true
  } else if (pub != null && x4 != null) {
    publicCataloguePriceDrift = false
  }
  return {
    mappingStatus,
    mappingNotes: notes || null,
    excelWorkbook: row.workbook ?? null,
    excelSheet: row.sheet ?? null,
    excelRow: row.excel_row ?? null,
    publicCataloguePriceDrift,
  }
}
