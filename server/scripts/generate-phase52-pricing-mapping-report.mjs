/**
 * Confidential admin mapping report: Excel Rate/X4 vs D1 stored X4 vs public catalogue.
 * Does not write purchase rates to D1. Does not log rate values to stdout.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { d1QueryLocal } from '../tests/helpers/d1Local.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RECON_PATH = path.join(ROOT, 'reports/phase51-rate-x4-reconciliation.json')
const OUT_PATH = path.join(ROOT, 'reports/phase52-pricing-mapping-report.json')

const recon = JSON.parse(fs.readFileSync(RECON_PATH, 'utf8'))
const rows = Array.isArray(recon.rows) ? recon.rows : []

const x4Rows = d1QueryLocal(`
  SELECT pr.product_id, pr.unit_rate_paise
  FROM private_rates pr
  WHERE pr.effective_to IS NULL
`)
const x4ByProduct = new Map(x4Rows.map((r) => [String(r.product_id), Number(r.unit_rate_paise)]))

const purchaseRows = d1QueryLocal(`
  SELECT ppr.product_id, ppr.unit_rate_paise
  FROM product_purchase_rates ppr
  WHERE ppr.effective_to IS NULL
`)
const purchaseByProduct = new Map(purchaseRows.map((r) => [String(r.product_id), Number(r.unit_rate_paise)]))

const reportRows = rows.map((row) => {
  const id = String(row.product_id ?? '')
  const storedX4Paise = x4ByProduct.get(id)
  const storedPurchasePaise = purchaseByProduct.get(id)
  return {
    product_id: id,
    product_name: row.product_name ?? null,
    excel_workbook: row.workbook ?? null,
    excel_sheet: row.sheet ?? null,
    excel_row: row.excel_row ?? null,
    excel_rate_inr: row.excel_rate ?? null,
    excel_x4_inr: row.excel_x4 ?? null,
    stored_x4_selling_paise: storedX4Paise ?? null,
    stored_purchase_paise: storedPurchasePaise ?? null,
    public_catalogue_price_inr: row.public_catalogue_price_inr ?? null,
    mapping_status: row.mapping_status ?? 'unknown',
    mapping_notes: row.notes ?? null,
  }
})

const out = {
  generated_at: new Date().toISOString(),
  confidential: true,
  source_reconciliation: 'phase51-rate-x4-reconciliation.json',
  row_count: reportRows.length,
  stats: {
    stored_x4_count: x4ByProduct.size,
    stored_purchase_count: purchaseByProduct.size,
    unmapped_in_reconciliation: reportRows.filter((r) => r.mapping_status === 'unmapped').length,
    review_status: reportRows.filter((r) => r.mapping_status === 'review').length,
    verified_status: reportRows.filter((r) => r.mapping_status === 'verified').length,
  },
  rows: reportRows,
}

fs.writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
console.log(`Wrote ${OUT_PATH} (${reportRows.length} rows, confidential — do not publish)`)
