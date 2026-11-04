import { canViewSensitiveProductPricing } from './adminRoles.js'
import { customerRequestDb, customerRequestScope } from './adminCustomerRequestScope.js'

/** Pending bills retain their explicitly labelled current estimate. Finalized
 * bills use only immutable server-finalization snapshots, never today's rates. */
export async function billPurchaseSummary(db, request, quotation, role, seasonId) {
  if (!canViewSensitiveProductPricing(role) || !request || !quotation) return null
  db = customerRequestDb(db, seasonId)
  if (!customerRequestScope(db) || !canViewSensitiveProductPricing(customerRequestScope(db).effectiveRole)) return null
  const persisted = await db.prepare('SELECT status, finalization_status FROM customer_requests WHERE id = ?').bind(request.id).first()
  if (persisted?.finalization_status === 'finalized' || persisted?.status === 'closed') {
    return historicalPurchaseSummary(db, request.id, quotation.id)
  }
  let purchaseSubtotalPaise = 0, complete = true
  const lines = []
  for (const item of request.items ?? []) {
    let purchaseUnitPaise = null
    if (item.productId) {
      const rate = await db.prepare('SELECT unit_rate_paise FROM product_purchase_rates WHERE product_id = ? AND effective_to IS NULL').bind(item.productId).first()
      if (Number.isSafeInteger(rate?.unit_rate_paise) && rate.unit_rate_paise >= 0) {
        const pieces = item.packSnapshot?.piecesPerPack
        purchaseUnitPaise = item.unitType === 'piece'
          ? Number.isSafeInteger(pieces) && pieces > 0 ? Math.floor(rate.unit_rate_paise / pieces) : null
          : rate.unit_rate_paise
      }
    }
    if (purchaseUnitPaise == null) complete = false
    else purchaseSubtotalPaise += purchaseUnitPaise * item.quantity
    lines.push({ lineId: item.lineId, purchaseUnitPaise })
  }
  complete &&= Number.isSafeInteger(purchaseSubtotalPaise) && Number.isSafeInteger(quotation.totalPaise)
  return { basis: 'current_purchase_estimate', lines, purchaseSubtotalPaise: complete ? purchaseSubtotalPaise : null,
    profitPaise: complete ? quotation.totalPaise - purchaseSubtotalPaise : null }
}

async function historicalPurchaseSummary(db, requestId, quotationId) {
  const result = await db.prepare(`SELECT s.*, a.amount_due_paise
    FROM bill_item_purchase_costs s JOIN request_payment_accounts a
      ON a.request_id = s.request_id AND a.quotation_id = s.quotation_id
      AND a.business_id = s.business_id AND a.location_id = s.location_id AND a.season_id = s.season_id
    WHERE s.request_id = ? AND s.quotation_id = ? ORDER BY s.quotation_item_id`).bind(requestId, quotationId).all()
  const rows = result.results ?? []
  let subtotal = 0
  const complete = rows.length > 0 && rows.every(row => {
    subtotal += row.purchase_line_paise ?? 0
    return row.bill_line_count === rows.length && row.unavailable_reason == null &&
      Number.isSafeInteger(row.purchase_unit_paise) && row.purchase_unit_paise >= 0 &&
      Number.isSafeInteger(row.purchase_line_paise) && row.purchase_line_paise === row.purchase_unit_paise * row.quantity &&
      Number.isSafeInteger(subtotal) && Number.isSafeInteger(row.amount_due_paise)
  })
  return {
    basis: 'finalization_purchase_snapshot',
    available: complete,
    unavailableReason: complete ? null : rows.length ? 'incomplete_purchase_costs' : 'historical_cost_unavailable',
    capturedAt: rows[0]?.captured_at ?? null,
    lines: rows.map(row => ({ lineId: row.request_line_id, quotationItemId: row.quotation_item_id,
      purchaseUnitPaise: row.purchase_unit_paise, purchaseLinePaise: row.purchase_line_paise,
      unavailableReason: row.unavailable_reason })),
    purchaseSubtotalPaise: complete ? subtotal : null,
    profitPaise: complete ? rows[0].amount_due_paise - subtotal : null,
  }
}
