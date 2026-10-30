import { formatINR } from '../../utils/currency.js'
import { paiseToInrHelper } from './moneyDisplay.js'

/** @param {unknown} paise */
export function formatListAuditPaise(paise) {
  const p = Number(paise)
  if (!Number.isInteger(p) || p < 0) return null
  return formatINR(paiseToInrHelper(p))
}
