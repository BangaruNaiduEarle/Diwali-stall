import {
  buildCustomerRequestBodyFromParts,
  buildSubmissionFingerprintFromParts,
  createSubmitGuard,
  idempotencyKeyFromFingerprint,
} from '../../server/src/lib/storefrontCustomerRequestPayload.js'
import { getMobileDigits, normalizeCustomerDetails } from './customerDetailsHelpers.js'

export { createSubmitGuard, idempotencyKeyFromFingerprint }

/**
 * @param {import('./customerDetailsHelpers.js').ReturnType<typeof normalizeCustomerDetails>} details
 * @param {{ productId: string, quantity: number }[]} estimateItems
 */
export function buildCustomerRequestBody(details, estimateItems) {
  const normalized = normalizeCustomerDetails(details)
  return buildCustomerRequestBodyFromParts(
    {
      name: normalized.name,
      mobile: getMobileDigits(normalized.mobile),
      area: normalized.area,
      pickupDate: normalized.pickupDate,
      note: normalized.note,
    },
    estimateItems,
  )
}

/**
 * @param {import('./customerDetailsHelpers.js').ReturnType<typeof normalizeCustomerDetails>} details
 * @param {{ productId: string, quantity: number }[]} estimateItems
 */
export function buildSubmissionFingerprint(details, estimateItems) {
  const normalized = normalizeCustomerDetails(details)
  return buildSubmissionFingerprintFromParts(
    {
      name: normalized.name,
      mobile: getMobileDigits(normalized.mobile),
      area: normalized.area,
      pickupDate: normalized.pickupDate,
      note: normalized.note,
    },
    estimateItems,
  )
}
