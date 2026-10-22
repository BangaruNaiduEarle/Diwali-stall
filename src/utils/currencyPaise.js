/** @param {number} paise */
export function paiseToInr(paise) {
  const p = Number(paise)
  if (!Number.isInteger(p)) return 0
  return p / 100
}
