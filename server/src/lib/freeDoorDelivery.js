/** Free door delivery applies at this order total (INR) and above. */
export const FREE_DOOR_DELIVERY_MIN_INR = 1000

export const FREE_DOOR_DELIVERY_MIN_PAISE = FREE_DOOR_DELIVERY_MIN_INR * 100

/** @param {number} totalPaise */
export function isFreeDoorDeliveryEligiblePaise(totalPaise) {
  const n = Number(totalPaise)
  return Number.isFinite(n) && n >= FREE_DOOR_DELIVERY_MIN_PAISE
}
