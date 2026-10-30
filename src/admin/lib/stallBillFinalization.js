/** @typedef {'pending' | 'finalized'} StallFinalizationStatus */

/**
 * @param {Record<string, unknown> | null | undefined} request
 * @returns {{ status: StallFinalizationStatus, label: string, badgeClass: string } | null}
 */
/** @param {unknown} source */
export function requestSourceUsesFinalizationWorkflow(source) {
  const s = String(source ?? '').trim()
  return s === 'manual' || s === 'web'
}

export function stallBillFinalizationDisplay(request) {
  if (!requestSourceUsesFinalizationWorkflow(request?.source)) return null
  const status = String(request?.finalizationStatus ?? '').trim()
  if (status === 'pending') {
    return {
      status: 'pending',
      label: 'Pending finalization',
      badgeClass: 'admin-badge admin-badge--stall-pending',
    }
  }
  if (status === 'finalized') {
    return {
      status: 'finalized',
      label: 'Finalized',
      badgeClass: 'admin-badge admin-badge--stall-finalized',
    }
  }
  return null
}

export const STALL_FINALIZATION_FILTER_OPTIONS = Object.freeze([
  { value: '', label: 'All requests' },
  { value: 'pending', label: 'Pending finalization' },
  { value: 'finalized', label: 'Finalized' },
])
