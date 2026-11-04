/** Use existing, server-authorized active seasonal business contexts only. */
export function stallBusinesses(locations) {
  const businesses = new Map()
  for (const row of locations) {
    if (row.business?.type === 'seasonal' && row.business.status === 'active' &&
        row.operatingSeason?.id === 'season-2026' && row.operatingSeason.status === 'active' &&
        row.association?.operatingYear === 2026 && row.association.status === 'active' &&
        row.location?.status === 'active') businesses.set(row.business.id, row.business)
  }
  return [...businesses.values()]
}

export function stallOwners(members) {
  return members.filter(member => member.role === 'owner' && !member.userDisabled && !member.membershipDisabled)
}

export function buildStallRequest(form, businesses, owners) {
  const name = String(form.name ?? '').trim()
  const slug = String(form.slug ?? '').trim().toLowerCase()
  if (!businesses.some(row => row.id === form.businessId)) return { ok: false, message: 'Select an active seasonal business.' }
  if (!owners.some(row => row.userId === form.ownerUserId)) return { ok: false, message: 'Select an enabled 2026 owner.' }
  if (!name || name.length > 200) return { ok: false, message: 'Enter a stall display name of up to 200 characters.' }
  if (slug.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return { ok: false, message: 'Enter a unique stall code using letters, digits and single hyphens (up to 64 characters).' }
  }
  return { ok: true, body: { businessId: form.businessId, ownerUserId: form.ownerUserId,
    name, slug, seasonId: 'season-2026', operatingYear: 2026 } }
}

export function validCreatedStall(data, body) {
  return Boolean(data?.location?.id && data.location.businessId === body.businessId &&
    data.location.name === body.name && data.location.slug === body.slug && data.location.status === 'active' &&
    data.association?.locationId === data.location.id && data.association.seasonId === 'season-2026' &&
    data.association.operatingYear === 2026 && data.association.status === 'active' &&
    data.owner?.userId === body.ownerUserId && data.owner.seasonRole === 'owner' && data.owner.locationRole === 'owner')
}

/** A failed session refresh must not turn a successful creation into a retryable creation. */
export async function createStallAndRefresh(body, { create, refreshSession }) {
  const result = await create(body)
  if (!result.ok) return result
  let refreshed = false
  try { refreshed = (await refreshSession()).ok } catch { /* Creation already succeeded. */ }
  return { ...result, refreshed }
}
