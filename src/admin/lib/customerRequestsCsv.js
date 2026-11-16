import { customerRequestStatusLabel } from './customerRequestStatus.js'

/** Quote every cell and neutralize spreadsheet formulas, including leading whitespace. */
export function requestCsvCell(value) {
  let text = String(value ?? '')
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

const amount = paise => Number.isSafeInteger(paise) && paise >= 0 ? (paise / 100).toFixed(2) : ''
const csvRow = cells => cells.map(requestCsvCell).join(',') + '\r\n'

/** Fetch bounded pages only on demand. Keep CSV parts rather than a second full request list. */
export async function customerRequestsCsv(fetchPage, filters, owner, isCurrent = () => true) {
  const parts = ['\uFEFF', csvRow([
    'Reference', 'Customer', 'Phone', 'Status', 'Selling Amount', 'Agreed Amount',
    'Items Count', 'Created Date', ...(owner ? ['Purchased Amount', 'Purchase Calculation Basis'] : []),
  ])]
  let totalPages = 1
  for (let page = 1; page <= totalPages; page++) {
    if (!isCurrent()) throw new Error('Request context changed. Please export again.')
    const result = await fetchPage({ ...filters, page, limit: 100 })
    if (!isCurrent()) throw new Error('Request context changed. Please export again.')
    if (!result.ok) throw new Error(result.message || 'Unable to export requests.')
    totalPages = Number(result.pagination?.totalPages ?? 0)
    for (const request of result.requests) {
      const audit = request.auditSummary
      parts.push(csvRow([
        request.publicReference || request.id, request.customerName, request.customerPhone,
        customerRequestStatusLabel(request.status), amount(audit?.sellingSubtotalPaise),
        amount(audit?.acceptedAmountPaise ?? request.paymentSummary?.amountDuePaise),
        request.itemCount ?? 0, request.createdAt,
        ...(owner ? [amount(audit?.purchaseSubtotalPaise),
          audit?.purchaseBasis === 'current_purchase_estimate' ? 'Current purchase estimate'
            : audit?.purchaseBasis === 'finalization_purchase_snapshot' ? 'Finalization purchase snapshot' : 'Unavailable'] : []),
      ]))
    }
  }
  return parts
}
