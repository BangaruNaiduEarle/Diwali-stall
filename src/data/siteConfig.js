/**
 * Business configuration — import siteConfig in components; do not duplicate fields.
 */
export const siteConfig = {
  brandName: '',

  /** Local WhatsApp/mobile number (10 digits, no country code in UI) */
  whatsappNumber: '9581160835',

  phone: '9581160835',

  location: '',

  stallDates: '',

  stallTimings: '',

  googleMapsUrl: '',
}

export const SITE_LABEL = 'Crackers catalogue'

export function getBrandDisplayName() {
  const name = siteConfig.brandName?.trim()
  return name || SITE_LABEL
}

/** Digits for wa.me links (includes India 91 when needed) */
export function getWhatsAppWaMeDigits() {
  const digits = siteConfig.whatsappNumber?.replace(/\D/g, '') ?? ''
  if (!digits) return ''
  if (digits.startsWith('91') && digits.length >= 12) return digits
  if (digits.length === 10) return `91${digits}`
  return digits
}

/** Number shown in the UI (no country code) */
export function getWhatsAppDisplayNumber() {
  const digits = siteConfig.whatsappNumber?.replace(/\D/g, '') ?? ''
  if (!digits) return ''
  if (digits.startsWith('91') && digits.length > 10) return digits.slice(-10)
  return digits
}

export function getPhoneDisplayNumber() {
  const digits = siteConfig.phone?.replace(/\D/g, '') ?? ''
  if (!digits) return ''
  if (digits.startsWith('91') && digits.length > 10) return digits.slice(-10)
  return digits
}

export function hasStallDates() {
  return Boolean(siteConfig.stallDates?.trim())
}

export function hasLocation() {
  return Boolean(siteConfig.location?.trim())
}

export function hasWhatsApp() {
  return Boolean(getWhatsAppWaMeDigits())
}

export function hasPhone() {
  return Boolean(siteConfig.phone?.trim())
}

export function hasGoogleMapsUrl() {
  return Boolean(siteConfig.googleMapsUrl?.trim())
}
