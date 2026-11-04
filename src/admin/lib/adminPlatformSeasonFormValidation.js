const SEASON_ID_PATTERN = /^season-[a-z0-9][a-z0-9-]{0,62}$/i
const SEASON_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/i

/**
 * @param {string} id
 * @returns {string | null}
 */
export function validatePlatformSeasonId(id) {
  const trimmed = String(id ?? '').trim()
  if (!trimmed) return 'Season id is required.'
  if (!SEASON_ID_PATTERN.test(trimmed)) {
    return 'Season id must start with "season-" and use letters, digits, or hyphens only.'
  }
  return null
}

/**
 * @param {string} code
 * @returns {string | null}
 */
export function validatePlatformSeasonCode(code) {
  const trimmed = String(code ?? '').trim()
  if (!trimmed) return 'Season code is required.'
  if (!SEASON_CODE_PATTERN.test(trimmed)) {
    return 'Season code must use letters, digits, underscores, or hyphens.'
  }
  return null
}

/**
 * @param {string} label
 * @returns {string | null}
 */
export function validatePlatformSeasonLabel(label) {
  const trimmed = String(label ?? '').trim()
  if (!trimmed) return 'Label is required.'
  return null
}

/**
 * @param {{ id?: string, code?: string, label?: string }} values
 * @returns {{ ok: true, id: string, code: string, label: string } | { ok: false, message: string, field?: 'id' | 'code' | 'label' }}
 */
export function validatePlatformSeasonCreateForm(values) {
  const idErr = validatePlatformSeasonId(values.id ?? '')
  if (idErr) return { ok: false, message: idErr, field: 'id' }
  const codeErr = validatePlatformSeasonCode(values.code ?? '')
  if (codeErr) return { ok: false, message: codeErr, field: 'code' }
  const labelErr = validatePlatformSeasonLabel(values.label ?? '')
  if (labelErr) return { ok: false, message: labelErr, field: 'label' }
  return {
    ok: true,
    id: String(values.id).trim(),
    code: String(values.code).trim(),
    label: String(values.label).trim(),
  }
}

/**
 * @param {{ code?: string, label?: string }} values
 * @returns {{ ok: true, code: string, label: string } | { ok: false, message: string, field?: 'code' | 'label' }}
 */
export function validatePlatformSeasonEditForm(values) {
  const codeErr = validatePlatformSeasonCode(values.code ?? '')
  if (codeErr) return { ok: false, message: codeErr, field: 'code' }
  const labelErr = validatePlatformSeasonLabel(values.label ?? '')
  if (labelErr) return { ok: false, message: labelErr, field: 'label' }
  return {
    ok: true,
    code: String(values.code).trim(),
    label: String(values.label).trim(),
  }
}
