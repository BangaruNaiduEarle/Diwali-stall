import { canViewSensitiveProductPricing } from './adminRoles.js'
import { customerRequestDb, customerRequestScope } from './adminCustomerRequestScope.js'

/** Pending bills retain their explicitly labelled current estimate. Finalized
 * bills use only immutable server-finalization snapshots, never today's rates. */
export async function billPurchaseSummary(db, request, quotation, role, seasonId) {
  if (!canViewSensitiveProductPricing(role) || !request || !quotation) return null
  db = customerRequestDb(db, seasonId)
  if (!customerRequestScope(db) || !canViewSensitiveProductPricing(customerRequestScope(db).effectiveRole)) return null
  const persisted = (await purchaseRequestStates(db, [request.id])).get(String(request.id))
  if (!persisted) return null
  if (isHistorical(persisted)) {
    return historicalPurchaseSummary(db, request.id, quotation.id)
  }
  if (!Number.isSafeInteger(persisted.revision)) return unavailableCurrentSummary()
  // Supplied detail items may predate the first state read. Reload only the
  // purchase inputs within this scope, bracketed by persisted revision reads.
  const itemsResult = await db.prepare(`SELECT request_id, product_id, quantity, unit_type, pack_snapshot
    FROM customer_request_items WHERE request_id = ?`).bind(request.id).all()
  const items = (itemsResult.results ?? []).map(purchaseItem)
  const rates = new Map()
  const ids = [...new Set(items.map(item => item.productId).filter(Boolean))]
  for (let start = 0; start < ids.length; start += 90) {
    const chunk = ids.slice(start, start + 90)
    const result = await db.prepare(`SELECT product_id, unit_rate_paise FROM product_purchase_rates WHERE product_id IN (${chunk.map(() => '?').join(',')}) AND effective_to IS NULL`).bind(...chunk).all()
    for (const rate of result.results ?? []) rates.set(rate.product_id, rate)
  }
  const latest = (await purchaseRequestStates(db, [request.id])).get(String(request.id))
  if (!latest) return null
  if (isHistorical(latest)) return historicalPurchaseSummary(db, request.id, quotation.id)
  if (latest.revision !== persisted.revision) return unavailableCurrentSummary()
  return currentPurchaseSummary(items, rates)
}

const isHistorical = row => row.finalization_status === 'finalized' || row.status === 'closed'
const unavailableCurrentSummary = () => ({ basis: 'current_purchase_estimate', purchaseSubtotalPaise: null })

async function purchaseRequestStates(db, ids) {
  // State-only reads need no child hydration; the scoped boundary still checks
  // location/season. Callers bound each group to at most 90 request IDs.
  const result = await db.prepare(`SELECT id AS request_id, status, finalization_status, revision
    FROM customer_requests WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()
  return new Map((result.results ?? []).map(row => [String(row.request_id), row]))
}

function purchaseItem(row) {
  let packSnapshot = null
  // Only loose product lines need this metadata. Invalid required metadata
  // makes the estimate unavailable without failing the surrounding response.
  if (row.product_id && row.unit_type === 'piece' && row.pack_snapshot) {
    try { packSnapshot = JSON.parse(row.pack_snapshot) } catch { /* unavailable */ }
  }
  return { productId: row.product_id, quantity: row.quantity, unitType: row.unit_type, packSnapshot }
}

function currentPurchaseSummary(items, rates) {
  let purchaseSubtotalPaise = 0, complete = true
  for (const item of items) {
    let purchaseUnitPaise = null
    if (item.productId) {
      const rate = rates.get(item.productId)
      if (Number.isSafeInteger(rate?.unit_rate_paise) && rate.unit_rate_paise >= 0) {
        const pieces = item.packSnapshot?.piecesPerPack
        purchaseUnitPaise = item.unitType === 'piece'
          ? Number.isSafeInteger(pieces) && pieces > 0 ? Math.floor(rate.unit_rate_paise / pieces) : null
          : rate.unit_rate_paise
      }
    }
    if (purchaseUnitPaise == null) complete = false
    else purchaseSubtotalPaise += purchaseUnitPaise * item.quantity
  }
  complete &&= Number.isSafeInteger(purchaseSubtotalPaise)
  return { basis: 'current_purchase_estimate', purchaseSubtotalPaise: complete ? purchaseSubtotalPaise : null }
}

async function historicalPurchaseSummary(db, requestId, quotationId) {
  const result = await db.prepare(`SELECT s.*, a.amount_due_paise
    FROM bill_item_purchase_costs s JOIN request_payment_accounts a
      ON a.request_id = s.request_id AND a.quotation_id = s.quotation_id
      AND a.business_id = s.business_id AND a.location_id = s.location_id AND a.season_id = s.season_id
    WHERE s.request_id = ? AND s.quotation_id = ? ORDER BY s.quotation_item_id`).bind(requestId, quotationId).all()
  const rows = result.results ?? []
  return summarizeHistoricalPurchaseRows(rows)
}

function summarizeHistoricalPurchaseRows(rows) {
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

/** Batch the same detail summaries for one list page, without per-request reads. */
export async function listBillPurchaseSummaries(db, requests, quotations, role, seasonId) {
  const summaries = new Map()
  if (role !== 'owner') return summaries
  db = customerRequestDb(db, seasonId)
  if (customerRequestScope(db)?.effectiveRole !== 'owner') return summaries
  for (let start = 0; start < requests.length; start += 90) {
    const chunk = requests.slice(start, start + 90).filter(req => quotations.has(String(req.id)))
    if (!chunk.length) continue
    const ids = chunk.map(req => req.id)
    const states = await purchaseRequestStates(db, ids)
    const pendingIds = ids.filter(id => states.has(String(id)) && !isHistorical(states.get(String(id))))
    const itemsByRequest = new Map()
    if (pendingIds.length) {
      const result = await db.prepare(`SELECT request_id, product_id, quantity, unit_type, pack_snapshot
        FROM customer_request_items WHERE request_id IN (${pendingIds.map(() => '?').join(',')})`)
        .bind(...pendingIds).all()
      for (const row of result.results ?? []) {
        const items = itemsByRequest.get(String(row.request_id)) ?? []
        items.push(purchaseItem(row))
        itemsByRequest.set(String(row.request_id), items)
      }
    }
    const productIds = [...new Set(pendingIds.flatMap(id => (itemsByRequest.get(String(id)) ?? []).map(item => item.productId)).filter(Boolean))]
    const rates = new Map()
    for (let rateStart = 0; rateStart < productIds.length; rateStart += 90) {
      const rateIds = productIds.slice(rateStart, rateStart + 90)
      const result = await db.prepare(`SELECT product_id, unit_rate_paise FROM product_purchase_rates WHERE product_id IN (${rateIds.map(() => '?').join(',')}) AND effective_to IS NULL`).bind(...rateIds).all()
      for (const rate of result.results ?? []) rates.set(rate.product_id, rate)
    }
    // Finalization and edits can commit during the input reads. Recheck after
    // rates: only unchanged pending revisions may publish a current estimate.
    // This last state read is the estimate's observation point; later commits
    // cannot retroactively make a response an up-to-date view of the database.
    const latest = pendingIds.length ? await purchaseRequestStates(db, pendingIds) : new Map()
    for (const id of pendingIds) {
      const key = String(id), state = latest.get(key)
      if (!state) { states.delete(key); continue }
      if (!isHistorical(state)) {
        summaries.set(key, state.revision === states.get(key).revision
          ? currentPurchaseSummary(itemsByRequest.get(key) ?? [], rates)
          : unavailableCurrentSummary())
      }
      states.set(key, state)
    }
    const finalizedIds = ids.filter(id => states.has(String(id)) && isHistorical(states.get(String(id))))
    if (finalizedIds.length) {
      const result = await db.prepare(`SELECT s.*, a.amount_due_paise
        FROM bill_item_purchase_costs s JOIN request_payment_accounts a
          ON a.request_id = s.request_id AND a.quotation_id = s.quotation_id
          AND a.business_id = s.business_id AND a.location_id = s.location_id AND a.season_id = s.season_id
        WHERE s.request_id IN (${finalizedIds.map(() => '?').join(',')}) ORDER BY s.quotation_item_id`)
        .bind(...finalizedIds).all()
      const costsByRequest = new Map()
      for (const row of result.results ?? []) {
        const key = String(row.request_id)
        if (row.quotation_id !== quotations.get(key)?.id) continue
        const rows = costsByRequest.get(key) ?? []
        rows.push(row)
        costsByRequest.set(key, rows)
      }
      for (const id of finalizedIds) {
        summaries.set(String(id), summarizeHistoricalPurchaseRows(costsByRequest.get(String(id)) ?? []))
      }
    }
  }
  return summaries
}
