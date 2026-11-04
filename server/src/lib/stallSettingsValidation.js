const profileLimits = { stallName: 200, stallLabel: 120, brandName: 120, whatsappNumber: 16, phone: 16,
  locationName: 200, locationAddress: 1000, locationMapUrl: 2048 }
const clean = value => typeof value === 'string' && [...value].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
const dateLabel = value => {
  let parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  let year, month, day
  if (parts) [, year, month, day] = parts
  else {
    parts = /^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})$/.exec(value)
    if (!parts) return false
    year = parts[3]; month = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(parts[1]) + 1; day = parts[2]
  }
  const parsed = new Date(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.getUTCFullYear() === Number(year) && parsed.getUTCMonth() + 1 === Number(month) && parsed.getUTCDate() === Number(day)
}
export function validateStallSettingsUpdate(body) {
  const bad = message => ({ ok: false, status: 400, code: 'validation_error', message })
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('A settings object is required.')
  if (Object.keys(body).some(key => !['profile','season','expectedProfileRevision','expectedSeasonRevision'].includes(key))) return bad('Unsupported settings field.')
  const data = {}
  for (const section of ['profile','season']) {
    if (!Object.hasOwn(body, section)) continue
    const input = body[section]
    if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length) return bad('Supply at least one setting in each included section.')
    data[section] = {}
    const revisionKey = section === 'profile' ? 'expectedProfileRevision' : 'expectedSeasonRevision'
    if (body[revisionKey] == null) return { ok: false, status: 428, code: 'revision_required', message: `Supply ${revisionKey} from the current settings.` }
    if (!Number.isSafeInteger(body[revisionKey]) || body[revisionKey] < 0 || body[revisionKey] >= Number.MAX_SAFE_INTEGER) return bad('Invalid settings revision.')
    data[revisionKey] = body[revisionKey]
    for (const [key, raw] of Object.entries(input)) {
      if (section === 'profile' && key === 'locationDetailLines' || section === 'season' && key === 'stallDates') {
        const limit = key === 'stallDates' ? 366 : 8, length = key === 'stallDates' ? 40 : 160
        if (!Array.isArray(raw) || raw.length > limit || raw.some(v => !clean(v) || !v.trim() || v.length > length)) return bad(`Invalid ${key}.`)
        const values = raw.map(v => v.trim())
        if (new Set(values).size !== values.length || key === 'stallDates' && values.some(v => !dateLabel(v))) return bad(`Invalid ${key}.`)
        data[section][key] = values
        continue
      }
      const max = section === 'profile' ? Object.hasOwn(profileLimits,key) ? profileLimits[key] : undefined : key === 'stallTimings' ? 160 : undefined
      if (!max || !clean(raw) || raw.length > max) return bad(`Invalid or unsupported ${key}.`)
      const value = raw.trim()
      if (key === 'stallName' && !value) return bad('Stall name cannot be empty.')
      if (['phone','whatsappNumber'].includes(key) && value && !/^\+?\d{10,15}$/.test(value)) return bad(`Invalid ${key}.`)
      if (key === 'locationMapUrl' && value) {
        try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) return bad('Map URL must be a public HTTPS URL.') }
        catch { return bad('Invalid map URL.') }
      }
      data[section][key] = value
    }
  }
  if (!data.profile && !data.season) return bad('Supply profile or season settings.')
  for (const key of ['expectedProfileRevision','expectedSeasonRevision']) if (Object.hasOwn(body,key) && (!Number.isSafeInteger(body[key]) || body[key] < 0 || body[key] >= Number.MAX_SAFE_INTEGER)) return bad('Invalid settings revision.')
  return { ok: true, data }
}
