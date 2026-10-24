/**
 * Business configuration — import siteConfig in components; do not duplicate fields.
 */
export const siteConfig = {
  brandName: '',

  /** Local WhatsApp/mobile number (10 digits, no country code in UI) */
  whatsappNumber: '9392748665',

  phone: '9392748665',

  locationName: 'AU Exhibition Ground',

  /** Full address / plus code for maps and reference */
  locationAddress:
    'P8HG+GRV, Andhra Univ Rd, AU North Campus, Andhra University, Visakhapatnam, Andhra Pradesh 530003, India',

  /** Short lines shown on the Location page card (not duplicated in components) */
  locationDetailLines: [
    'Andhra University North Campus',
    'Visakhapatnam, Andhra Pradesh – 530003',
  ],

  locationMapUrl:
    'https://www.google.com/maps/search/?api=1&query=AU+Exhibition+Ground+Visakhapatnam',

  stallDates: ['November 6, 2026', 'November 7, 2026', 'November 8, 2026'],

  stallTimings: '9:00 AM – 10:00 PM',

  /** @deprecated use locationMapUrl */
  googleMapsUrl:
    'https://www.google.com/maps/search/?api=1&query=AU+Exhibition+Ground+Visakhapatnam',
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

export function getStallDatesList() {
  const d = siteConfig.stallDates
  if (Array.isArray(d)) {
    return d.map((entry) => String(entry).trim()).filter(Boolean)
  }
  if (typeof d === 'string' && d.trim()) {
    return [d.trim()]
  }
  return []
}

/** Compact range label, e.g. "6 – 8 November 2026" */
export function getStallDatesRangeLabel() {
  const list = getStallDatesList()
  if (!list.length) return ''
  if (list.length === 1) return list[0]

  const parsed = list.map((label) => {
    const match = label.match(/^(\w+)\s+(\d{1,2}),\s*(\d{4})$/)
    if (!match) return null
    return { month: match[1], day: Number.parseInt(match[2], 10), year: match[3] }
  })

  if (parsed.every(Boolean) && parsed.every((p) => p.month === parsed[0].month && p.year === parsed[0].year)) {
    return `${parsed[0].day} – ${parsed[parsed.length - 1].day} ${parsed[0].month} ${parsed[0].year}`
  }

  return list.join(' · ')
}

export function getStallDatesSummary() {
  return getStallDatesRangeLabel() || getStallDatesList().join(' · ')
}

export function getLocationMapUrl() {
  return siteConfig.locationMapUrl?.trim() || siteConfig.googleMapsUrl?.trim() || ''
}

/** Hero / footer one-line location */
export function getLocationHeroLine() {
  const name = siteConfig.locationName?.trim()
  if (!name) return ''
  if (/visakhapatnam/i.test(name)) return name
  return `${name}, Visakhapatnam`
}

export function hasStallDates() {
  return getStallDatesList().length > 0
}

export function hasLocation() {
  return Boolean(siteConfig.locationName?.trim() || siteConfig.locationAddress?.trim())
}

export function hasWhatsApp() {
  return Boolean(getWhatsAppWaMeDigits())
}

export function hasPhone() {
  return Boolean(siteConfig.phone?.trim())
}

export function hasGoogleMapsUrl() {
  return Boolean(getLocationMapUrl())
}
