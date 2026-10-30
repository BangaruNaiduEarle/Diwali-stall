/** Mirrors server customer request rules for Quick Bill checkout UX. */
export const QUICK_BILL_CUSTOMER_LIMITS = {
  nameMin: 2,
  nameMax: 80,
  phoneDigits: 10,
}

function phoneDigits(mobile) {
  return String(mobile ?? '').replace(/\D/g, '')
}

/**
 * @param {string} name
 * @param {string} mobile
 * @returns {{ field: 'name' | 'mobile', message: string }[]}
 */
export function listQuickBillCustomerValidationIssues(name, mobile) {
  /** @type {{ field: 'name' | 'mobile', message: string }[]} */
  const issues = []
  const trimmedName = String(name ?? '').trim()
  if (!trimmedName) {
    issues.push({ field: 'name', message: 'Customer name is required.' })
  } else if (trimmedName.length < QUICK_BILL_CUSTOMER_LIMITS.nameMin) {
    issues.push({ field: 'name', message: 'Customer name is too short.' })
  } else if (trimmedName.length > QUICK_BILL_CUSTOMER_LIMITS.nameMax) {
    issues.push({ field: 'name', message: 'Customer name is too long.' })
  }

  const digits = phoneDigits(mobile)
  if (!digits) {
    issues.push({ field: 'mobile', message: 'Mobile number is required.' })
  } else if (digits.length !== QUICK_BILL_CUSTOMER_LIMITS.phoneDigits) {
    issues.push({ field: 'mobile', message: 'Enter a valid 10-digit mobile number.' })
  }

  return issues
}

/**
 * @param {string} name
 * @param {string} mobile
 */
export function quickBillCustomerCanCheckout(name, mobile) {
  return listQuickBillCustomerValidationIssues(name, mobile).length === 0
}
