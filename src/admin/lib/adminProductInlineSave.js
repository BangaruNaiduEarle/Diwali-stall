import { updateAdminProduct, updateAdminPurchaseRate } from '../api/adminApi.js'
import {
  finalPriceInrForProductWrite,
  sellingPriceInrForProductWrite,
} from './adminProductSellingPricePayload.js'

const COMPANY_MAX_LENGTH = 120

/** @typedef {'name' | 'company' | 'pack' | 'purchaseRateInr' | 'sellingPriceInr' | 'finalPriceInr' | 'piecesPerPack' | 'allowLooseSale'} AdminProductInlineField */

/**
 * @param {string} productId
 * @param {AdminProductInlineField} field
 * @param {string} draft
 */
export async function saveAdminProductInlineField(productId, field, draft) {
  const id = String(productId ?? '').trim()
  if (!id) return { ok: false, message: 'Missing product id.' }

  if (field === 'name') {
    const name = String(draft ?? '').trim()
    if (!name) return { ok: false, message: 'Product name is required.' }
    return updateAdminProduct(id, { name })
  }

  if (field === 'company') {
    const company = String(draft ?? '').trim()
    if (company.length > COMPANY_MAX_LENGTH) {
      return { ok: false, message: 'Company too long.' }
    }
    return updateAdminProduct(id, { company: company || null })
  }

  if (field === 'pack') {
    return updateAdminProduct(id, { pack: String(draft ?? '').trim() })
  }

  if (field === 'sellingPriceInr') {
    const raw = String(draft ?? '').trim()
    if (raw === '') {
      return updateAdminProduct(id, { sellingPriceInr: null })
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, message: 'Enter a valid selling price.' }
    }
    return updateAdminProduct(id, { sellingPriceInr: n })
  }

  if (field === 'finalPriceInr') {
    const raw = String(draft ?? '').trim()
    if (raw === '') {
      return updateAdminProduct(id, { finalPriceInr: null })
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, message: 'Enter a valid final price.' }
    }
    return updateAdminProduct(id, { finalPriceInr: n })
  }

  if (field === 'piecesPerPack') {
    const raw = String(draft ?? '').trim()
    if (raw === '') {
      return updateAdminProduct(id, { piecesPerPack: null })
    }
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0) {
      return { ok: false, message: 'Pieces per Pack must be a positive whole number.' }
    }
    return updateAdminProduct(id, { piecesPerPack: n })
  }

  if (field === 'allowLooseSale') {
    const yes = draft === '1' || draft === 'true' || String(draft).toLowerCase() === 'yes'
    return updateAdminProduct(id, { allowLooseSale: yes })
  }

  if (field === 'purchaseRateInr') {
    const raw = String(draft ?? '').trim()
    if (!raw) return { ok: false, message: 'Enter a purchase rate.' }
    const purchaseRateInr = Number(raw)
    if (!Number.isFinite(purchaseRateInr) || purchaseRateInr < 0) {
      return { ok: false, message: 'Enter a valid purchase rate.' }
    }
    return updateAdminPurchaseRate(id, purchaseRateInr)
  }

  return { ok: false, message: 'Unsupported field.' }
}

/**
 * @param {Record<string, unknown>} row
 * @param {AdminProductInlineField} field
 * @param {Awaited<ReturnType<typeof saveAdminProductInlineField>>} result
 * @param {string} draft
 */
export function mergeAdminProductRowAfterInlineSave(row, field, result, draft) {
  if (!result.ok) return row

  if (field === 'purchaseRateInr') {
    const purchaseRateInr = Number(draft)
    return {
      ...row,
      hasPurchaseRate: true,
      purchaseRateInr: Number.isFinite(purchaseRateInr) ? purchaseRateInr : row.purchaseRateInr,
    }
  }

  const product = result.product
  if (product && typeof product === 'object') {
    return { ...row, ...product, id: row.id ?? product.id }
  }

  if (field === 'name') return { ...row, name: String(draft).trim() }
  if (field === 'company') return { ...row, company: String(draft).trim() || null }
  if (field === 'pack') return { ...row, pack: String(draft).trim() }
  if (field === 'sellingPriceInr') {
    const sellingPriceInr = sellingPriceInrForProductWrite({ sellingPriceInr: draft })
    return {
      ...row,
      sellingPriceInr: sellingPriceInr ?? null,
      hasSellingPrice: sellingPriceInr != null && sellingPriceInr > 0,
    }
  }
  if (field === 'finalPriceInr') {
    const finalPriceInr = finalPriceInrForProductWrite({ finalPriceInr: draft })
    return {
      ...row,
      finalPriceInr: finalPriceInr ?? null,
      hasFinalPrice: finalPriceInr != null && finalPriceInr > 0,
    }
  }
  if (field === 'piecesPerPack') {
    const raw = String(draft ?? '').trim()
    const piecesPerPack = raw === '' ? null : Number(raw)
    return {
      ...row,
      piecesPerPack: Number.isInteger(piecesPerPack) && piecesPerPack > 0 ? piecesPerPack : null,
    }
  }
  if (field === 'allowLooseSale') {
    const yes = draft === '1' || draft === 'true' || String(draft).toLowerCase() === 'yes'
    return { ...row, allowLooseSale: yes }
  }

  return row
}
