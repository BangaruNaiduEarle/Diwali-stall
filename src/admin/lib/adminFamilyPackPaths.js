/**
 * @param {unknown} id Family pack id (e.g. FP001), not slug.
 */
export function adminFamilyPackEditPath(id) {
  const packId = String(id ?? '').trim()
  if (!packId) return '/admin/family-packs'
  return `/admin/family-packs/${encodeURIComponent(packId)}/edit`
}
