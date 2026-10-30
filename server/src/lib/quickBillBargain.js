import { canViewSensitiveProductPricing } from './adminRoles.js'

/** ₹500 margin on resolved final subtotal (informational floor). */
export const QUICK_BILL_BARGAIN_FLOOR_MARGIN_PAISE = 50_000

/** @typedef {'selling' | 'bargain'} QuickBillPricingMode */

/**
 * @param {unknown} raw
 * @param {unknown} adminRole
 */
export function parseQuickBillPricingMode(raw, adminRole) {
  const modeRaw = raw === undefined || raw === null ? 'selling' : String(raw).trim().toLowerCase()
  if (modeRaw !== 'selling' && modeRaw !== 'bargain') {
    return {
      ok: false,
      errors: { pricingMode: 'Pricing mode must be selling or bargain.' },
    }
  }
  const pricingMode = /** @type {QuickBillPricingMode} */ (modeRaw)
  if (pricingMode === 'bargain' && !canViewSensitiveProductPricing(adminRole)) {
    return {
      ok: false,
      status: 403,
      code: 'bargain_not_allowed',
      message: 'Bargain mode is only available to owner and super admin.',
    }
  }
  return { ok: true, pricingMode }
}

/**
 * @param {unknown} body
 * @param {QuickBillPricingMode} pricingMode
 */
export function parseQuickBillAcceptedAmountPaise(body, pricingMode) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: { _body: 'JSON object required.' } }
  }
  const record = /** @type {Record<string, unknown>} */ (body)
  const hasAcceptedPaise =
    record.acceptedAmountPaise !== undefined || record.accepted_amount_paise !== undefined
  const hasAcceptedInr =
    record.acceptedAmountInr !== undefined || record.accepted_amount_inr !== undefined

  if (pricingMode === 'selling') {
    if (hasAcceptedPaise || hasAcceptedInr) {
      return {
        ok: false,
        errors: { acceptedAmountPaise: 'Accepted amount is only used in bargain mode.' },
      }
    }
    return { ok: true, acceptedAmountPaise: null }
  }

  if (!hasAcceptedPaise && !hasAcceptedInr) {
    return {
      ok: false,
      errors: { acceptedAmountPaise: 'Accepted amount is required in bargain mode.' },
    }
  }

  if (hasAcceptedPaise) {
    const raw = record.acceptedAmountPaise ?? record.accepted_amount_paise
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) {
      return {
        ok: false,
        errors: { acceptedAmountPaise: 'Accepted amount must be a whole number of paise (0 or more).' },
      }
    }
    const paise = Math.round(n)
    if (paise < 0) {
      return {
        ok: false,
        errors: { acceptedAmountPaise: 'Accepted amount must be a whole number of paise (0 or more).' },
      }
    }
    return { ok: true, acceptedAmountPaise: paise }
  }

  const inrRaw = record.acceptedAmountInr ?? record.accepted_amount_inr
  const inr = Number(inrRaw)
  if (!Number.isFinite(inr) || inr < 0) {
    return {
      ok: false,
      errors: { acceptedAmountPaise: 'Accepted amount must be zero or a positive rupee amount.' },
    }
  }
  return { ok: true, acceptedAmountPaise: Math.round(inr * 100) }
}

/**
 * Customer-agreed amount on request detail (Owner/Super Admin) — not tied to Quick Bill bargain checkout.
 *
 * @param {Record<string, unknown>} record
 */
/**
 * Optional customer-agreed amount (adjust bill save) — empty means not recording agreement yet.
 *
 * @param {Record<string, unknown>} record
 */
export function parseOptionalCustomerAgreedAmountInrPaise(record) {
  const inrRaw = record.acceptedAmountInr ?? record.accepted_amount_inr
  if (inrRaw === undefined || inrRaw === null || String(inrRaw).trim() === '') {
    return { ok: true, provided: false, acceptedAmountPaise: null }
  }
  const parsed = parseCustomerAgreedAmountInrPaise(record)
  if (!parsed.ok) return parsed
  return { ok: true, provided: true, acceptedAmountPaise: parsed.acceptedAmountPaise }
}

export function parseCustomerAgreedAmountInrPaise(record) {
  const inrRaw = record.acceptedAmountInr ?? record.accepted_amount_inr
  if (inrRaw === undefined || inrRaw === null || String(inrRaw).trim() === '') {
    return { ok: false, errors: { acceptedAmountInr: 'Enter the customer-agreed amount in rupees.' } }
  }
  const inr = Number(inrRaw)
  if (!Number.isFinite(inr) || inr <= 0) {
    return {
      ok: false,
      errors: { acceptedAmountInr: 'Customer-agreed amount must be a positive rupee amount.' },
    }
  }
  const paise = Math.round(inr * 100)
  if (!Number.isInteger(paise) || paise <= 0) {
    return {
      ok: false,
      errors: { acceptedAmountInr: 'Customer-agreed amount could not be converted to paise.' },
    }
  }
  return { ok: true, acceptedAmountPaise: paise }
}

/**
 * Same basis as Quick Bill preview “Final subtotal” (Final where set, else Selling per line).
 * @param {number} acceptedAmountPaise
 * @param {number} finalSubtotalPaise
 */
export function buildAcceptedBelowFinalSubtotalWarning(acceptedAmountPaise, finalSubtotalPaise) {
  if (
    Number.isInteger(finalSubtotalPaise) &&
    finalSubtotalPaise > 0 &&
    Number.isInteger(acceptedAmountPaise) &&
    acceptedAmountPaise < finalSubtotalPaise
  ) {
    return {
      code: 'accepted_below_final_subtotal',
      message:
        'Accepted amount is below the Final subtotal shown in bargain mode. Checkout is still allowed; verify before billing.',
    }
  }
  return null
}

/** Quick Bill bargain audit fields — owner/super_admin only in API responses. */
export const RESTRICTED_QUICK_BILL_BARGAIN_PREVIEW_KEYS = [
  'sellingSubtotalPaise',
  'finalSubtotalPaise',
  'finalSubtotalStrictPaise',
  'bargainFloorPaise',
  'acceptedAmountPaise',
]

/**
 * @param {Record<string, unknown> | null | undefined} preview
 * @param {unknown} role
 */
export function filterQuickBillPreviewForRole(preview, role) {
  if (!preview || canViewSensitiveProductPricing(role)) return preview
  const next = { ...preview }
  for (const key of RESTRICTED_QUICK_BILL_BARGAIN_PREVIEW_KEYS) {
    delete next[key]
  }
  if (next.pricingMode === 'bargain') {
    next.pricingMode = 'selling'
  }
  return next
}
