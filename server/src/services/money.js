/**
 * Exact money: integer paise (1 INR = 100 paise). No floating-point for totals.
 */

/** @param {number} inrWholeOrDecimal */
export function inrToPaise(inrWholeOrDecimal) {
  const n = Number(inrWholeOrDecimal)
  if (!Number.isFinite(n)) {
    throw new TypeError('Invalid INR amount')
  }
  return Math.round(n * 100)
}

/** @param {number} paise */
export function paiseToInr(paise) {
  const p = Number(paise)
  if (!Number.isFinite(p) || !Number.isInteger(p)) {
    throw new TypeError('Invalid paise amount')
  }
  return p / 100
}

/** @param {number} quantity @param {number} unitRatePaise */
export function lineTotalPaise(quantity, unitRatePaise) {
  const q = Number(quantity)
  const u = Number(unitRatePaise)
  if (!Number.isInteger(q) || q < 1) throw new TypeError('Invalid quantity')
  if (!Number.isInteger(u) || u < 0) throw new TypeError('Invalid unit rate paise')
  return q * u
}

/** @param {number[]} lineTotalsPaise */
export function sumPaise(lineTotalsPaise) {
  let sum = 0
  for (const line of lineTotalsPaise) {
    const v = Number(line)
    if (!Number.isInteger(v) || v < 0) throw new TypeError('Invalid line total paise')
    sum += v
  }
  return sum
}
