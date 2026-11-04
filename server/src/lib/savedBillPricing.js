import { customerRequestScope } from './adminCustomerRequestScope.js'

/** Trust persisted, scoped unit snapshots and explicit adjustments, never caller-supplied JSON. */
export async function savedBillPricing(db, quotation) {
  if (!customerRequestScope(db)) return null
  const stored = await db.prepare('SELECT id, customer_request_id, subtotal_paise, adjustment_paise, total_paise FROM quotations WHERE id = ?').bind(quotation.id).first()
  if (!stored) return null
  const result = await db.prepare(`SELECT line_number, product_id, product_name, quantity, unit_rate_paise, line_total_paise, product_details_json
    FROM quotation_items WHERE quotation_id = ? ORDER BY line_number ASC`).bind(quotation.id).all()
  const rows = result.results ?? []
  if (!rows.length || rows.length !== quotation.items?.length) return null
  if (quotation.items.some(item => !rows.some(row => row.line_number === item.lineNumber && (row.product_id ?? null) === (item.productId ?? null)))) return null
  const originals = await db.prepare('SELECT line_id, unit_price_paise FROM customer_request_items WHERE request_id = ?').bind(stored.customer_request_id).all()
  for (const row of rows) {
    const details = row.product_details_json ? JSON.parse(row.product_details_json) : null
    const original = (originals.results ?? []).find(item => item.line_id === row.request_line_id)
    const trustedSnapshot = details?.billing?.version === 1 ? details.billing.sellingUnitPaise === row.unit_rate_paise
      : original && ['box', 'piece'].includes(row.unit_type) && original.unit_price_paise === row.unit_rate_paise
    if (!trustedSnapshot ||
        !Number.isSafeInteger(row.unit_rate_paise) || row.unit_rate_paise <= 0 ||
        !Number.isSafeInteger(row.quantity) || row.quantity < 1 ||
        !Number.isSafeInteger(row.line_total_paise) || row.line_total_paise !== row.unit_rate_paise * row.quantity) return null
  }
  const subtotal = rows.reduce((sum, row) => sum + row.line_total_paise, 0)
  if (!Number.isSafeInteger(subtotal) || stored.subtotal_paise !== subtotal || !Number.isSafeInteger(stored.adjustment_paise) || stored.adjustment_paise > 0 || stored.total_paise !== subtotal + stored.adjustment_paise || stored.total_paise < 0) return null
  return { ...quotation, subtotalPaise: subtotal, adjustmentPaise: stored.adjustment_paise, totalPaise: stored.total_paise,
    items: quotation.items.map(item => {
      const row = rows.find(line => line.line_number === item.lineNumber)
      return { ...item, productName: row.product_name, quantity: row.quantity, unitRatePaise: row.unit_rate_paise, lineTotalPaise: row.line_total_paise }
    }) }
}
