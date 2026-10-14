import { getStallDatesList } from '../data/siteConfig'

export const CUSTOMER_STORAGE_KEY = 'crackers_customer_details'

const MAX = {
  name: 80,
  mobile: 15,
  area: 120,
  pickupDate: 40,
  note: 300,
}

export function normalizeCustomerDetails(raw) {
  if (!raw || typeof raw !== 'object') {
    return emptyCustomerDetails()
  }
  return {
    name: String(raw.name ?? '').trim().slice(0, MAX.name),
    mobile: String(raw.mobile ?? '').trim().slice(0, MAX.mobile),
    area: String(raw.area ?? '').trim().slice(0, MAX.area),
    pickupDate: String(raw.pickupDate ?? '').trim().slice(0, MAX.pickupDate),
    note: String(raw.note ?? '').trim().slice(0, MAX.note),
  }
}

export function emptyCustomerDetails() {
  return {
    name: '',
    mobile: '',
    area: '',
    pickupDate: '',
    note: '',
  }
}

export function loadCustomerDetailsFromStorage() {
  try {
    const raw = localStorage.getItem(CUSTOMER_STORAGE_KEY)
    if (!raw) return emptyCustomerDetails()
    return normalizeCustomerDetails(JSON.parse(raw))
  } catch {
    return emptyCustomerDetails()
  }
}

export function saveCustomerDetailsToStorage(details) {
  try {
    localStorage.setItem(CUSTOMER_STORAGE_KEY, JSON.stringify(normalizeCustomerDetails(details)))
  } catch {
    /* quota / private mode */
  }
}

export function getMobileDigits(mobile) {
  return String(mobile ?? '').replace(/\D/g, '')
}

export function validateCustomerDetails(details) {
  const normalized = normalizeCustomerDetails(details)
  const errors = {}

  if (!normalized.name) {
    errors.name = 'Name is required.'
  } else if (normalized.name.length < 2) {
    errors.name = 'Enter your name (at least 2 characters).'
  }

  const digits = getMobileDigits(normalized.mobile)
  if (!normalized.mobile?.trim()) {
    errors.mobile = 'Please enter a valid 10-digit mobile number.'
  } else if (digits.length !== 10) {
    errors.mobile = 'Please enter a valid 10-digit mobile number.'
  }

  if (normalized.area.length > MAX.area) {
    errors.area = 'Area is too long.'
  }
  if (normalized.note.length > MAX.note) {
    errors.note = 'Note is too long.'
  }

  if (normalized.pickupDate) {
    const allowed = getStallDatesList()
    if (allowed.length > 0 && !allowed.includes(normalized.pickupDate)) {
      errors.pickupDate = 'Please choose a stall date: November 6, 7, or 8, 2026.'
    }
  }

  return errors
}

export function isCustomerDetailsValid(details) {
  return Object.keys(validateCustomerDetails(details)).length === 0
}
