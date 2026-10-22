import { resolveApiUrl } from './resolveApiUrl.js'

/**
 * @returns {Promise<{ ok: true, familyPacks: unknown[] } | { ok: false, message: string }>}
 */
export async function fetchPublicFamilyPacks() {
  const url = resolveApiUrl('/api/public/family-packs')
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      return { ok: false, message: 'Could not load family packs.' }
    }
    const data = await res.json()
    const familyPacks = Array.isArray(data?.familyPacks) ? data.familyPacks : []
    return { ok: true, familyPacks }
  } catch {
    return { ok: false, message: 'Could not load family packs.' }
  }
}

/**
 * @param {string} slug
 */
export async function fetchPublicFamilyPackBySlug(slug) {
  const url = resolveApiUrl(`/api/public/family-packs/${encodeURIComponent(slug)}`)
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (res.status === 404) {
      return { ok: false, notFound: true, message: 'Family pack not found.' }
    }
    if (!res.ok) {
      return { ok: false, message: 'Could not load family pack.' }
    }
    const data = await res.json()
    if (!data?.familyPack) {
      return { ok: false, message: 'Invalid family pack response.' }
    }
    return { ok: true, familyPack: data.familyPack }
  } catch {
    return { ok: false, message: 'Could not load family pack.' }
  }
}
