/** Financial snapshot CAS; timestamps alone have only second precision in SQLite. */
const financialColumns = [
  ['accepted_amount_paise', 'acceptedAmountPaise'], ['total_paise', 'totalPaise'],
  ['subtotal_paise', 'subtotalPaise'], ['adjustment_paise', 'adjustmentPaise'],
  ['pricing_mode', 'pricingMode'], ['selling_subtotal_paise', 'sellingSubtotalPaise'],
  ['final_subtotal_paise', 'finalSubtotalPaise'], ['bargain_floor_paise', 'bargainFloorPaise'],
]

export function activeQuotationSnapshot(quotation) {
  const ownership = `guard_quote.customer_request_id = customer_requests.id
    AND guard_quote.location_id = customer_requests.location_id
    AND guard_quote.season_id = customer_requests.season_id AND guard_quote.status != 'void'`
  if (!quotation) return { sql: `NOT EXISTS (SELECT 1 FROM quotations guard_quote WHERE ${ownership})`, values: [] }
  return {
    sql: `EXISTS (SELECT 1 FROM quotations guard_quote WHERE ${ownership} AND guard_quote.id = ?
      AND ${financialColumns.map(([column]) => `guard_quote.${column} IS ?`).join(' AND ')})`,
    values: [quotation.id, ...financialColumns.map(([, key]) => quotation[key] ?? null)],
  }
}

export const transactionChanged = () => ({ ok: false, status: 409, code: 'transaction_changed',
  message: 'The request or active quotation changed or was finalized. Refresh before retrying.' })

/** First statement of one D1 batch. A stale snapshot fails an existing NOT NULL
 * constraint, rolling back the entire replacement, including item deletion. */
export function quotationReplacementGuard(db, request, quotation, season) {
  const snapshot = activeQuotationSnapshot(quotation)
  return db.prepare(`UPDATE customer_requests SET status = CASE WHEN
    status IS ? AND finalization_status IS ? AND status NOT IN ('closed', 'void')
    AND finalization_status IS NOT 'finalized' AND ${snapshot.sql}
    THEN status ELSE NULL END WHERE id = ? AND season_id = ?`)
    .bind(request.status, request.finalization_status ?? null, ...snapshot.values, request.id, season)
}
