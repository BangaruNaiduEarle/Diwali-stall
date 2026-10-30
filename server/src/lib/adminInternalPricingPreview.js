import {
  isLooseQuotationProductName,
  stripLooseProductNameSuffix,
  withLooseProductNameSuffix,
} from './customerFacingQuotationTotal.js'
import { QUICK_BILL_BARGAIN_FLOOR_MARGIN_PAISE } from './quickBillBargain.js'
import { resolveQuickBillProductPricing } from '../services/adminQuickBill.js'
import { lineTotalPaise, sumPaise } from '../services/money.js'

/**
 * @param {Record<string, unknown>[] | null | undefined} requestItems
 */
function mapRequestItemsToQuickBillInputs(requestItems) {
  /** @type {{ productId: string, quantity: number, unitType: 'box' | 'piece' }[]} */
  const quickBillItems = []
  for (const line of requestItems ?? []) {
    if (!line || typeof line !== 'object') continue
    if (line.familyPackId || line.lineType === 'family_pack') continue
    const productId = line.productId
    if (!productId) continue
    const quantity = Number(line.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) continue
    const loose = isLooseQuotationProductName(String(line.productName ?? ''))
    quickBillItems.push({
      productId: String(productId),
      quantity,
      unitType: loose ? 'piece' : 'box',
    })
  }
  return quickBillItems
}

/**
 * Owner/Super Admin catalogue estimate for manual stall bills without saved bargain audit.
 *
 * @param {D1Database} db
 * @param {Record<string, unknown>[] | null | undefined} requestItems
 */
export async function buildManualRequestInternalPricingPreview(db, requestItems) {
  const view = await buildRequestInternalPricingView(db, requestItems)
  if (!view) return null
  return {
    kind: 'estimate',
    sellingSubtotalPaise: view.sellingSubtotalPaise,
    finalSubtotalPaise: view.finalSubtotalPaise,
    bargainFloorPaise: view.bargainFloorPaise,
  }
}

/**
 * Per-line Selling/Final (internal only). Subtotals are sums of line totals — same rules as Quick Bill preview.
 *
 * @param {D1Database} db
 * @param {Record<string, unknown>[] | null | undefined} requestItems
 */
export async function buildRequestInternalPricingView(db, requestItems) {
  /** @type {Array<
   *   | { kind: 'pack', req: Record<string, unknown> }
   *   | { kind: 'product', req: Record<string, unknown>, qb: { productId: string, quantity: number, unitType: 'box' | 'piece' } }
   * >} */
  const ordered = []

  for (const line of requestItems ?? []) {
    if (!line || typeof line !== 'object') continue
    const isPack = line.familyPackId || line.lineType === 'family_pack'
    if (isPack) {
      ordered.push({ kind: 'pack', req: line })
      continue
    }
    const productId = line.productId
    if (!productId) continue
    const quantity = Number(line.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) continue
    const loose = isLooseQuotationProductName(String(line.productName ?? ''))
    ordered.push({
      kind: 'product',
      req: line,
      qb: {
        productId: String(productId),
        quantity,
        unitType: loose ? 'piece' : 'box',
      },
    })
  }

  if (!ordered.length) return null

  const quickBillItems = ordered
    .filter((e) => e.kind === 'product')
    .map((e) => /** @type {Extract<typeof e, { kind: 'product' }>} */ (e).qb)

  /** @type {Awaited<ReturnType<typeof resolveQuickBillProductPricing>> | null} */
  let resolved = null
  if (quickBillItems.length) {
    const result = await resolveQuickBillProductPricing(db, quickBillItems)
    if (result.ok) resolved = result
  }

  /** @type {Record<string, unknown>[]} */
  const items = []
  /** @type {number[]} */
  const sellingLineTotals = []
  /** @type {number[]} */
  const finalLineTotals = []
  let productIndex = 0

  for (const entry of ordered) {
    if (entry.kind === 'pack') {
      const req = entry.req
      const qty = Number(req.quantity)
      const unitPaise = req.unitPricePaise == null ? null : Number(req.unitPricePaise)
      const sellingUnitPaise =
        Number.isInteger(unitPaise) && unitPaise > 0 ? unitPaise : null
      const sellingLinePaise =
        sellingUnitPaise != null && Number.isInteger(qty) && qty > 0
          ? lineTotalPaise(qty, sellingUnitPaise)
          : null
      if (sellingLinePaise != null) sellingLineTotals.push(sellingLinePaise)
      items.push({
        lineNumber: req.lineNumber ?? null,
        lineType: 'family_pack',
        productName: String(req.productName ?? 'Family pack'),
        quantity: qty,
        unitType: 'box',
        sellingUnitPaise,
        sellingLinePaise,
        finalUnitPaise: null,
        finalLinePaise: null,
        finalUsesSellingFallback: false,
      })
      continue
    }

    if (!resolved?.ok) continue
    const req = entry.req
    const rLine = resolved.lines[productIndex]
    productIndex += 1
    if (!rLine) continue

    const unitType = rLine.unitType === 'piece' ? 'piece' : 'box'
    const baseName = stripLooseProductNameSuffix(String(rLine.productName))
    const productName = unitType === 'piece' ? withLooseProductNameSuffix(baseName) : baseName

    const catalogueSellingUnitPaise = Number(rLine.unitPricePaise)
    const lockedUnitPaise = req.unitPricePaise == null ? null : Number(req.unitPricePaise)
    const sellingUnitPaise =
      Number.isInteger(lockedUnitPaise) && lockedUnitPaise > 0
        ? lockedUnitPaise
        : catalogueSellingUnitPaise

    const finalUnitPaise = Number(rLine.finalUnitPaise)
    const qty = Number(rLine.quantity)
    const finalUsesSellingFallback = Boolean(rLine.finalUsesSellingFallback)

    const sellingLinePaise =
      Number.isInteger(sellingUnitPaise) && sellingUnitPaise > 0 && Number.isInteger(qty) && qty > 0
        ? lineTotalPaise(qty, sellingUnitPaise)
        : null
    const finalLinePaise =
      Number.isInteger(finalUnitPaise) && finalUnitPaise > 0 && Number.isInteger(qty) && qty > 0
        ? lineTotalPaise(qty, finalUnitPaise)
        : null

    if (sellingLinePaise != null) sellingLineTotals.push(sellingLinePaise)
    if (finalLinePaise != null) finalLineTotals.push(finalLinePaise)

    items.push({
      lineNumber: req.lineNumber ?? null,
      lineType: 'product',
      productId: rLine.productId,
      productName,
      company: rLine.company ?? null,
      quantity: qty,
      unitType,
      sellingUnitPaise:
        Number.isInteger(sellingUnitPaise) && sellingUnitPaise > 0 ? sellingUnitPaise : null,
      sellingLinePaise,
      finalUnitPaise:
        Number.isInteger(finalUnitPaise) && finalUnitPaise > 0 ? finalUnitPaise : null,
      finalLinePaise,
      finalUsesSellingFallback,
    })
  }

  if (!items.length) return null

  const sellingSubtotalPaise = sellingLineTotals.length ? sumPaise(sellingLineTotals) : null
  const finalSubtotalPaise = finalLineTotals.length ? sumPaise(finalLineTotals) : null
  const bargainFloorPaise =
    finalSubtotalPaise != null ? finalSubtotalPaise + QUICK_BILL_BARGAIN_FLOOR_MARGIN_PAISE : null

  return {
    items,
    sellingSubtotalPaise,
    finalSubtotalPaise,
    bargainFloorPaise,
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} request
 */
export function manualRequestEligibleForInternalPricingPreview(request) {
  if (!request || typeof request !== 'object') return false
  if (String(request.source ?? '') !== 'manual') return false
  const assigned = String(request.assignedToEmail ?? '').trim()
  return assigned.length > 0
}
