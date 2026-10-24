import { isFamilyPackEstimateItem, normalizeEstimateItem } from './estimateHelpers.js'

export const ESTIMATE_HISTORY_STORAGE_KEY = 'crackers_estimate_history'
export const ESTIMATE_HISTORY_MAX = 30
export const ESTIMATE_SHARED_STATUS = 'shared'

/**
 * @typedef {{
 *   lineType: 'product',
 *   productId: string,
 *   quantity: number,
 *   unit?: string | null,
 * }} ProductHistoryLine
 * @typedef {{
 *   lineType: 'family_pack',
 *   familyPackId: string,
 *   quantity: number,
 *   unit?: string | null,
 *   label?: string | null,
 *   snapshotPricePaise?: number,
 * }} FamilyPackHistoryLine
 * @typedef {ProductHistoryLine | FamilyPackHistoryLine} EstimateHistoryLine
 * @typedef {{
 *   id: string,
 *   reference: string,
 *   sharedAt: string,
 *   status: typeof ESTIMATE_SHARED_STATUS,
 *   submissionFingerprint: string,
 *   items: EstimateHistoryLine[],
 * }} SharedEstimateRecord
 */

function createEstimateReference() {
  const timePart = Date.now().toString(36).toUpperCase()
  const randPart = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `EST-${timePart}-${randPart}`
}

/**
 * Stable dedupe key for history lines (one billable line per product or pack).
 * @param {EstimateHistoryLine | Record<string, unknown>} line
 */
export function historyLineKey(line) {
  if (line.lineType === 'family_pack' || (typeof line.familyPackId === 'string' && line.familyPackId.trim())) {
    return `fp:${String(line.familyPackId).trim()}`
  }
  return `p:${String(line.productId ?? '').trim()}`
}

/**
 * @param {unknown} raw
 * @returns {EstimateHistoryLine | null}
 */
export function normalizeHistoryLine(raw) {
  if (!raw || typeof raw !== 'object') return null
  const source = /** @type {Record<string, unknown>} */ (raw)
  /** @type {Record<string, unknown>} */
  const forNormalize = { ...source }
  if (typeof forNormalize.familyPackId === 'string' && forNormalize.familyPackId.trim()) {
    if (!forNormalize.snapshotName && typeof forNormalize.label === 'string' && forNormalize.label.trim()) {
      forNormalize.snapshotName = forNormalize.label.trim()
    }
  }

  const item = normalizeEstimateItem(forNormalize)
  if (!item) return null

  const unit =
    typeof source.unit === 'string' ? source.unit.trim() || null : null

  if (isFamilyPackEstimateItem(item)) {
    const label =
      (typeof item.snapshotName === 'string' && item.snapshotName.trim()) ||
      (typeof source.label === 'string' && source.label.trim()) ||
      null
    /** @type {FamilyPackHistoryLine} */
    const line = {
      lineType: 'family_pack',
      familyPackId: item.familyPackId,
      quantity: item.quantity,
      unit: unit ?? 'Family pack',
      ...(label ? { label } : {}),
    }
    if (Number.isInteger(item.snapshotPricePaise) && item.snapshotPricePaise > 0) {
      line.snapshotPricePaise = item.snapshotPricePaise
    } else if (
      Number.isInteger(Number(source.snapshotPricePaise)) &&
      Number(source.snapshotPricePaise) > 0
    ) {
      line.snapshotPricePaise = Number(source.snapshotPricePaise)
    }
    return line
  }

  if (typeof item.productId !== 'string' || !item.productId.trim()) return null

  /** @type {ProductHistoryLine} */
  return {
    lineType: 'product',
    productId: item.productId,
    quantity: item.quantity,
    ...(unit ? { unit } : {}),
  }
}

/**
 * @param {unknown} raw
 * @returns {SharedEstimateRecord | null}
 */
export function normalizeSharedEstimateRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (raw)
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  const reference = typeof o.reference === 'string' ? o.reference.trim() : ''
  const sharedAt = typeof o.sharedAt === 'string' ? o.sharedAt : ''
  const status = o.status === ESTIMATE_SHARED_STATUS ? ESTIMATE_SHARED_STATUS : null
  const submissionFingerprint =
    typeof o.submissionFingerprint === 'string' ? o.submissionFingerprint : ''
  if (!id || !reference || !sharedAt || !status || !submissionFingerprint) return null
  if (!Array.isArray(o.items)) return null
  const items = []
  const seen = new Set()
  for (const entry of o.items) {
    const line = normalizeHistoryLine(entry)
    if (!line) continue
    const key = historyLineKey(line)
    if (!key || seen.has(key)) continue
    seen.add(key)
    items.push(line)
  }
  if (!items.length) return null
  return { id, reference, sharedAt, status, submissionFingerprint, items }
}

/** Remove legacy shared-estimate history from localStorage (session-only in UI). */
export function clearEstimateHistoryLocalStorage() {
  try {
    localStorage.removeItem(ESTIMATE_HISTORY_STORAGE_KEY)
  } catch {
    /* private mode / SSR */
  }
}

/** @returns {SharedEstimateRecord[]} — session-only; always []. */
export function loadEstimateHistoryFromStorage() {
  return []
}

/** @param {SharedEstimateRecord[]} _records */
export function saveEstimateHistoryToStorage(_records) {
  /* session-only — no localStorage persistence */
}

/**
 * @param {string} fingerprint
 * @param {SharedEstimateRecord[]} records
 */
export function findSharedEstimateByFingerprint(fingerprint, records) {
  const fp = String(fingerprint ?? '')
  if (!fp) return null
  return records.find((r) => r.submissionFingerprint === fp) ?? null
}

/**
 * @param {{ submissionFingerprint: string, items: EstimateHistoryLine[], reference?: string }} input
 * @param {SharedEstimateRecord[]} [existing]
 * @returns {{ record: SharedEstimateRecord | null, created: boolean, records: SharedEstimateRecord[] }}
 */
export function appendSharedEstimate(input, existing = loadEstimateHistoryFromStorage()) {
  const fingerprint = String(input.submissionFingerprint ?? '')
  if (!fingerprint) {
    return { record: null, created: false, records: existing }
  }

  const serverReference =
    typeof input.reference === 'string' && input.reference.trim() ? input.reference.trim() : ''

  const duplicate = findSharedEstimateByFingerprint(fingerprint, existing)
  if (duplicate) {
    if (serverReference && duplicate.reference !== serverReference) {
      const updated = { ...duplicate, reference: serverReference }
      const records = existing.map((r) => (r.id === duplicate.id ? updated : r))
      saveEstimateHistoryToStorage(records)
      return { record: updated, created: false, records }
    }
    return { record: duplicate, created: false, records: existing }
  }

  const items = []
  const seen = new Set()
  for (const entry of input.items ?? []) {
    const line = normalizeHistoryLine(entry)
    if (!line) continue
    const key = historyLineKey(line)
    if (!key || seen.has(key)) continue
    seen.add(key)
    items.push(line)
  }
  if (!items.length) {
    return { record: null, created: false, records: existing }
  }

  /** @type {SharedEstimateRecord} */
  const record = {
    id: `hist_${crypto.randomUUID()}`,
    reference: serverReference || createEstimateReference(),
    sharedAt: new Date().toISOString(),
    status: ESTIMATE_SHARED_STATUS,
    submissionFingerprint: fingerprint,
    items,
  }

  const records = [record, ...existing].slice(0, ESTIMATE_HISTORY_MAX)
  saveEstimateHistoryToStorage(records)
  return { record, created: true, records }
}
