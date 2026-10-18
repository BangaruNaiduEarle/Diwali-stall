import {
  buildQuoteLinesForRequestItems,
  createOrGetQuotationForRequest,
  mapBuiltQuoteLineToApi,
} from './adminQuotations.js'
import { createManualCustomerRequest, resolveRequestProducts } from './publicCustomerRequests.js'

/**
 * @param {D1Database} db
 * @param {{ productId: string, quantity: number }[]} items
 */
export async function previewQuickBill(db, items) {
  const resolved = await resolveRequestProducts(db, items)
  if (!resolved.ok) {
    return resolved
  }

  const requestItems = resolved.lines.map((line, index) => ({
    line_number: index + 1,
    product_id: line.productId,
    product_name: line.productName,
    quantity: line.quantity,
  }))

  const built = await buildQuoteLinesForRequestItems(db, requestItems)
  if (!built.ok) {
    return built
  }

  return {
    ok: true,
    preview: {
      items: built.quoteLines.map(mapBuiltQuoteLineToApi),
      subtotalPaise: built.subtotalPaise,
      totalPaise: built.totalPaise,
    },
  }
}

/**
 * @param {D1Database} db
 * @param {import('../lib/customerRequestValidation.js').NormalizedCustomerRequest} data
 * @param {{ createdByEmail?: string }} opts
 */
export async function checkoutQuickBill(db, data, opts = {}) {
  const requestId = crypto.randomUUID()
  const created = await createManualCustomerRequest(db, data, { requestId })
  if (!created.ok) {
    return created
  }

  const quote = await createOrGetQuotationForRequest(db, requestId, {
    createdByEmail: opts.createdByEmail ?? null,
  })
  if (!quote.ok) {
    return {
      ...quote,
      request: created.request,
      requestId,
    }
  }

  return {
    ok: true,
    request: created.request,
    quotation: quote.quotation,
    quotationCreated: quote.created,
  }
}
