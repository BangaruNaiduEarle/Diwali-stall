/** @param {unknown} paise */
export function paiseToInrHelper(paise) {
  const p = Number(paise)
  if (!Number.isFinite(p)) return 0
  return p / 100
}
