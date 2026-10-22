const FP_ID_RE = /^FP\d{3,}$/

/**
 * Pack id usable for upload sign + PUT persist (route param or draft created on /new).
 * @param {string | null | undefined} routePackId
 * @param {string | null | undefined} draftPackId
 */
export function effectiveFamilyPackId(routePackId, draftPackId) {
  const id = String(routePackId ?? draftPackId ?? '').trim()
  return FP_ID_RE.test(id) ? id : null
}

/**
 * @param {{ isCreateRoute: boolean, routePackId: string | null, draftPackId: string | null }} opts
 * @returns {{ mode: 'create' | 'update', id: string | null }}
 */
export function familyPackSaveTarget(opts) {
  const id = effectiveFamilyPackId(opts.routePackId, opts.draftPackId)
  if (id) return { mode: 'update', id }
  if (opts.isCreateRoute) return { mode: 'create', id: null }
  return { mode: 'update', id: opts.routePackId }
}

/**
 * After images persist on /new, switch URL to /:id/edit without interrupting upload.
 * @param {boolean} isCreateRoute
 * @param {string | null} routePackId
 * @param {string | null} draftPackId
 */
export function shouldNavigateToEditAfterImagePersist(isCreateRoute, routePackId, draftPackId) {
  return isCreateRoute && !routePackId && Boolean(effectiveFamilyPackId(null, draftPackId))
}
