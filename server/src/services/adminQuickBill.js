import { customerRequestDb, customerRequestScope } from '../lib/adminCustomerRequestScope.js'
import { prepareAtomicQuickBill, commitAtomicQuickBill } from './adminQuickBillAtomic.js'
import {
  stripLooseProductNameSuffix,
  withLooseProductNameSuffix,
} from '../lib/customerFacingQuotationTotal.js'
import {
  buildAcceptedBelowFinalSubtotalWarning,
  QUICK_BILL_BARGAIN_FLOOR_MARGIN_PAISE,
} from '../lib/quickBillBargain.js'
import { mapBuiltQuoteLineToApi } from './adminQuotations.js'
import { resolveQuickBillAssignee } from './adminCustomerRequests.js'
import { lineTotalPaise, sumPaise } from './money.js'
import { appendOfflineFamilyPackPricing } from './offlineFamilyPacks.js'

const QUICK_BILL_PRODUCT_SQL = `
  SELECT id, name, company, active, stock_status,
         selling_price_paise, final_price_paise, pieces_per_pack, allow_loose_sale
  FROM products
  WHERE id = ? AND season_id = ?
`.trim()

/** @param {string} seasonId */
function requireSeasonId(seasonId) {
  return String(seasonId ?? '').trim()
}

/** @param {Record<string, unknown>} row @returns {number | null} */
function catalogueBoxSellingPricePaise(row) {
  const selling = Number(row.selling_price_paise)
  if (!Number.isInteger(selling) || selling <= 0) return null
  return selling
}

/** @param {Record<string, unknown>} row */
function hasCatalogueFinalBoxPrice(row) {
  const final = Number(row.final_price_paise)
  return Number.isInteger(final) && final > 0
}

/** @param {Record<string, unknown>} row @returns {number | null} */
function catalogueBoxFinalOrSellingPaise(row) {
  if (hasCatalogueFinalBoxPrice(row)) {
    return Number(row.final_price_paise)
  }
  return catalogueBoxSellingPricePaise(row)
}

/**
 * @param {number} boxPaise
 * @param {number} piecesPerPack
 */
function looseUnitPaiseFromBox(boxPaise, piecesPerPack) {
  return Math.floor(boxPaise / piecesPerPack)
}

/**
 * @param {D1Database} db
 * @param {{ productId: string, quantity: number, unitType?: 'box' | 'piece' }[]} items
 * @param {string} seasonId
 */
export async function resolveQuickBillProductPricing(db, items, seasonId, context) {
  db = customerRequestDb(db, seasonId, context)
  const season = requireSeasonId(seasonId)
  if (!season) {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Active business season is required for quick bill access.',
    }
  }
  /** @type {Record<string, string>} */
  const fieldErrors = {}
  /** @type {string[]} */
  const missingSellingPriceProductIds = []
  /** @type {{
   *   productId: string,
   *   familyPackId: null,
   *   productName: string,
   *   quantity: number,
   *   unitPricePaise: number,
   *   unitType: 'box' | 'piece',
   * }[]} */
  const lines = []
  /** @type {number[]} */
  const sellingLineTotals = []
  /** @type {number[]} */
  const finalResolvedLineTotals = []
  /** @type {number[]} */
  const finalStrictLineTotals = []

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    const unitType = item.unitType === 'piece' ? 'piece' : 'box'
    const productId = item.productId
    const quantity = item.quantity

    const row = await db.prepare(QUICK_BILL_PRODUCT_SQL).bind(productId, season).first()
    if (!row) {
      fieldErrors[`items[${i}].productId`] = 'Product not found.'
      continue
    }
    if (Number(row.active) !== 1) {
      fieldErrors[`items[${i}].productId`] = 'Product is not available.'
      continue
    }
    const stock = String(row.stock_status ?? '')
    if (stock === 'soldout' || stock === 'sold-out') {
      fieldErrors[`items[${i}].productId`] = 'Product is sold out.'
      continue
    }

    const sellingBoxPaise = customerRequestScope(db) && !Number.isSafeInteger(row.selling_price_paise)
      ? null : catalogueBoxSellingPricePaise(row)
    if (sellingBoxPaise === null) {
      missingSellingPriceProductIds.push(productId)
      continue
    }

    const finalBoxPaise = catalogueBoxFinalOrSellingPaise(row)
    if (finalBoxPaise === null) {
      missingSellingPriceProductIds.push(productId)
      continue
    }

    let sellingUnitPaise = sellingBoxPaise
    let finalUnitPaise = finalBoxPaise

    if (unitType === 'piece') {
      if (Number(row.allow_loose_sale) !== 1) {
        fieldErrors[`items[${i}].unitType`] = 'Loose-piece sale is not allowed for this product.'
        continue
      }
      const pieces = Number(row.pieces_per_pack)
      if (!Number.isInteger(pieces) || pieces < 1 || (customerRequestScope(db) && !Number.isSafeInteger(row.pieces_per_pack))) {
        fieldErrors[`items[${i}].unitType`] = 'Pieces per pack is not configured for loose sale.'
        continue
      }
      sellingUnitPaise = looseUnitPaiseFromBox(sellingBoxPaise, pieces)
      finalUnitPaise = looseUnitPaiseFromBox(finalBoxPaise, pieces)
      if (!Number.isInteger(sellingUnitPaise) || sellingUnitPaise <= 0) {
        fieldErrors[`items[${i}].unitType`] = 'Loose-piece price could not be calculated.'
        continue
      }
      if (!Number.isInteger(finalUnitPaise) || finalUnitPaise <= 0) {
        fieldErrors[`items[${i}].unitType`] = 'Loose-piece price could not be calculated.'
        continue
      }
    }

    const qty = quantity
    sellingLineTotals.push(lineTotalPaise(qty, sellingUnitPaise))
    finalResolvedLineTotals.push(lineTotalPaise(qty, finalUnitPaise))
    if (hasCatalogueFinalBoxPrice(row)) {
      finalStrictLineTotals.push(lineTotalPaise(qty, finalUnitPaise))
    }

    const companyRaw = row.company
    const company =
      companyRaw != null && String(companyRaw).trim() ? String(companyRaw).trim() : null

    lines.push({
      productId,
      familyPackId: null,
      productName: String(row.name),
      company,
      quantity: qty,
      unitPricePaise: sellingUnitPaise,
      finalUnitPaise,
      unitType,
      finalUsesSellingFallback: !hasCatalogueFinalBoxPrice(row),
      catalogueSnapshot: {
        selling_price_paise: row.selling_price_paise ?? null,
        final_price_paise: row.final_price_paise ?? null,
        pieces_per_pack: row.pieces_per_pack ?? null,
        allow_loose_sale: row.allow_loose_sale ?? null,
      },
    })
  }

  if (Object.keys(fieldErrors).length) {
    return { ok: false, status: 400, error: 'validation_error', fields: fieldErrors }
  }
  if (missingSellingPriceProductIds.length) {
    return {
      ok: false,
      status: 400,
      code: 'missing_selling_price',
      message: 'Selling price missing for one or more products.',
      missingProductIds: [...new Set(missingSellingPriceProductIds)],
    }
  }

  const sellingSubtotalPaise = sumPaise(sellingLineTotals)
  const finalSubtotalPaise = sumPaise(finalResolvedLineTotals)
  const finalSubtotalStrictPaise = sumPaise(finalStrictLineTotals)
  const bargainFloorPaise = finalSubtotalPaise + QUICK_BILL_BARGAIN_FLOOR_MARGIN_PAISE

  return {
    ok: true,
    lines,
    audit: {
      sellingSubtotalPaise,
      finalSubtotalPaise,
      finalSubtotalStrictPaise,
      bargainFloorPaise,
    },
  }
}

/** @deprecated use resolveQuickBillProductPricing */
export async function resolveQuickBillProductLines(db, items, seasonId, _adminRole, context) {
  db = customerRequestDb(db, seasonId, context)
  const resolved = await resolveQuickBillProductPricing(db, items, seasonId)
  if (!resolved.ok) return resolved
  return { ok: true, lines: resolved.lines }
}

/**
 * @param {{
 *   productId: string,
 *   productName: string,
 *   quantity: number,
 *   unitPricePaise: number,
 *   unitType: 'box' | 'piece',
 * }[]} lines
 */
export function buildQuickBillQuoteLines(lines) {
  /** @type {{
   *   line_number: number,
   *   product_id: string,
   *   product_name: string,
   *   quantity: number,
   *   unit_rate_paise: number,
   *   line_total_paise: number,
   *   unit_type: 'box' | 'piece',
   * }[]} */
  const quoteLines = lines.map((line, index) => {
    const unitRatePaise = line.unitPricePaise
    const lineTotal = lineTotalPaise(line.quantity, unitRatePaise)
    const unitLabel = line.unitType === 'piece' ? ' (loose pc)' : ''
    return {
      line_number: index + 1,
      product_id: line.productId,
      ...(line.familyPackId?{family_pack_id:line.familyPackId}:{}),
      product_name: `${line.productName}${unitLabel}`,
      quantity: line.quantity,
      unit_rate_paise: unitRatePaise,
      line_total_paise: lineTotal,
      unit_type: line.unitType,
    }
  })

  const subtotalPaise = sumPaise(quoteLines.map((l) => l.line_total_paise))
  return { ok: true, quoteLines, subtotalPaise, totalPaise: subtotalPaise }
}

/**
 * @param {import('../lib/quickBillBargain.js').QuickBillPricingMode} pricingMode
 * @param {Record<string, number>} audit
 * @param {number | null} acceptedAmountPaise
 */
export function buildQuickBillQuotationAudit(pricingMode, audit, acceptedAmountPaise) {
  if (pricingMode === 'bargain') {
    return {
      pricingMode: 'bargain',
      sellingSubtotalPaise: audit.sellingSubtotalPaise,
      finalSubtotalPaise: audit.finalSubtotalPaise,
      bargainFloorPaise: audit.bargainFloorPaise,
      acceptedAmountPaise,
    }
  }
  return {
    pricingMode: 'selling',
    sellingSubtotalPaise: audit.sellingSubtotalPaise,
    finalSubtotalPaise: null,
    bargainFloorPaise: null,
    acceptedAmountPaise: null,
  }
}

/**
 * @param {Record<string, unknown>} previewBase
 * @param {import('../lib/quickBillBargain.js').QuickBillPricingMode} pricingMode
 * @param {Record<string, number>} audit
 */
function attachBargainFieldsToPreview(previewBase, pricingMode, audit) {
  const preview = {
    ...previewBase,
    pricingMode,
    sellingSubtotalPaise: audit.sellingSubtotalPaise,
  }
  if (pricingMode === 'bargain') {
    preview.finalSubtotalPaise = audit.finalSubtotalPaise
    preview.finalSubtotalStrictPaise = audit.finalSubtotalStrictPaise
    preview.bargainFloorPaise = audit.bargainFloorPaise
  }
  return preview
}

/**
 * @param {D1Database} db
 * @param {{ productId: string, quantity: number, unitType?: 'box' | 'piece' }[]} items
 * @param {{ pricingMode?: import('../lib/quickBillBargain.js').QuickBillPricingMode, seasonId?: string }} [opts]
 */
export async function previewQuickBill(db, items, opts = {}) {
  db = customerRequestDb(db, opts.seasonId, opts.context)
  const pricingMode = opts.pricingMode ?? 'selling'
  const resolved = await resolveQuickBillProductPricing(db, items, opts.seasonId)
  if (!resolved.ok) {
    return resolved
  }

  const built = buildQuickBillQuoteLines(resolved.lines)
  if (!built.ok) {
    return built
  }

  const previewBase = {
    items: built.quoteLines.map((line) => ({
      ...mapBuiltQuoteLineToApi(line),
      unitType: line.unit_type,
    })),
    subtotalPaise: built.subtotalPaise,
    totalPaise: built.totalPaise,
  }

  return {
    ok: true,
    preview: attachBargainFieldsToPreview(previewBase, pricingMode, resolved.audit),
  }
}

/**
 * @param {import('../lib/customerRequestValidation.js').NormalizedCustomerRequest} data
 * @param {{
 *   productId: string,
 *   familyPackId: null,
 *   productName: string,
 *   quantity: number,
 *   unitPricePaise: number,
 *   unitType: 'box' | 'piece',
 * }[]} resolvedLines
 */
export function mapQuickBillLinesForRequestInsert(resolvedLines) {
  return resolvedLines.map((line) => ({
    productId: line.productId,
    familyPackId: null,
    productName:
      line.unitType === 'piece'
        ? withLooseProductNameSuffix(line.productName)
        : stripLooseProductNameSuffix(line.productName),
    quantity: line.quantity,
    unitPricePaise: line.unitPricePaise,
  }))
}

/**
 * @param {D1Database} db
 * @param {import('../lib/customerRequestValidation.js').NormalizedCustomerRequest} data
 * @param {{
 *   createdByEmail?: string,
 *   adminRole?: unknown,
 *   pricingMode?: import('../lib/quickBillBargain.js').QuickBillPricingMode,
 *   acceptedAmountPaise?: number | null,
 *   seasonId?: string,
 *   idempotencyKey?: string,
 * }} opts
 */
export async function checkoutQuickBill(db, data, opts = {}) {
  db = customerRequestDb(db, opts.seasonId, opts.context, true)
  const season = requireSeasonId(opts.seasonId)
  if (!season) {
    return {
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Active business season is required for quick bill access.',
    }
  }

  const operation = await prepareAtomicQuickBill(db, data, opts)
  if (operation && !operation.ok) return operation
  if (operation?.replay) return operation.replay
  let assignee = null
  if (data.assigneeUserId) {
    if (!customerRequestScope(db)) return { ok: false, status: 400, code: 'location_required', message: 'Select an authorized location for atomic checkout handover.' }
    assignee = await resolveQuickBillAssignee(db, { assigneeUserId: data.assigneeUserId }, season)
    if (!assignee.ok) return assignee
  }

  const pricingMode = opts.pricingMode ?? 'selling'
  let resolved = await resolveQuickBillProductPricing(db, data.items.filter(item=>!item.familyPackId), season)
  if(data.items.some(item=>item.familyPackId)){
    if(!opts.offlineFamilyPacks)return {ok:false,status:400,code:'family_pack_snapshot_required',message:'Family Pack checkout requires verified offline snapshots.'}
    resolved=appendOfflineFamilyPackPricing(resolved,data.items,opts.offlineFamilyPacks)
  }
  if (!resolved.ok) {
    return resolved
  }

  /** @type {{ code: string, message: string }[]} */
  const warnings = []
  let acceptedAmountPaise = null
  if (pricingMode === 'bargain') {
    acceptedAmountPaise = opts.acceptedAmountPaise ?? null
    const warning = buildAcceptedBelowFinalSubtotalWarning(
      Number(acceptedAmountPaise),
      resolved.audit.finalSubtotalPaise,
    )
    if (warning) warnings.push(warning)
  }

  return commitAtomicQuickBill(db, data, { ...opts, assigneeEmail: assignee?.email }, operation, {
    resolved, built: buildQuickBillQuoteLines(resolved.lines.map(line => ({
      ...line, productName: line.familyPackId ? line.productName : stripLooseProductNameSuffix(line.productName),
    }))),
    audit: buildQuickBillQuotationAudit(pricingMode, resolved.audit, acceptedAmountPaise), warnings,
  })
}
