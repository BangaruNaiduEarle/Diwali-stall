import { apiRequest } from './client.js'
import { validCreatedStall } from '../lib/adminPlatformStall.js'
import { parsePlatformBusinessSeason, sortPlatformBusinessSeasons } from '../lib/adminPlatformSeasonList.js'
import {
  parsePlatformSeasonMember,
  sortPlatformSeasonMembers,
} from '../lib/adminPlatformSeasonMembers.js'

export async function createPlatformLocation(body) {
  const result = await apiRequest('/api/admin/platform/locations', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!result.ok) return result
  if (!validCreatedStall(result.data, body)) {
    return { ok: false, status: result.status, error: 'invalid_response',
      message: 'The server accepted the request but returned an invalid stall response. Refresh before trying again.' }
  }
  return { ok: true, ...result.data }
}

/**
 * @typedef {import('../lib/adminPlatformSeasonList.js').PlatformBusinessSeason} PlatformBusinessSeason
 * @typedef {import('../lib/adminPlatformSeasonMembers.js').PlatformSeasonMember} PlatformSeasonMember
 */

/**
 * @param {unknown} data
 */
function seasonsFromListBody(data) {
  const body = data && typeof data === 'object' ? /** @type {Record<string, unknown>} */ (data) : {}
  const raw = body.seasons
  if (!Array.isArray(raw)) return []
  return sortPlatformBusinessSeasons(raw.map(parsePlatformBusinessSeason).filter(Boolean))
}

/**
 * @param {unknown} data
 */
function seasonFromBody(data) {
  const body = data && typeof data === 'object' ? /** @type {Record<string, unknown>} */ (data) : {}
  return parsePlatformBusinessSeason(body.season)
}

/** @returns {Promise<{ ok: true, seasons: PlatformBusinessSeason[] } | { ok: false, status: number, error: string, message: string }>} */
export async function fetchPlatformBusinessSeasons() {
  const result = await apiRequest('/api/admin/platform/seasons')
  if (!result.ok) return result
  return { ok: true, seasons: seasonsFromListBody(result.data) }
}

/**
 * @param {{ id: string, code: string, label: string }} body
 */
export async function createPlatformBusinessSeason(body) {
  const result = await apiRequest('/api/admin/platform/seasons', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!result.ok) return result
  const season = seasonFromBody(result.data)
  if (!season) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Create season response was invalid.',
    }
  }
  return { ok: true, season, status: result.status }
}

/**
 * @param {string} seasonId
 * @param {{ code?: string, label?: string }} body
 */
export async function updatePlatformBusinessSeason(seasonId, body) {
  const id = String(seasonId ?? '').trim()
  const result = await apiRequest(`/api/admin/platform/seasons/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  if (!result.ok) return result
  const season = seasonFromBody(result.data)
  if (!season) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Update season response was invalid.',
    }
  }
  return { ok: true, season }
}

/** @param {string} seasonId */
export async function archivePlatformBusinessSeason(seasonId) {
  const id = String(seasonId ?? '').trim()
  const result = await apiRequest(`/api/admin/platform/seasons/${encodeURIComponent(id)}/archive`, {
    method: 'POST',
  })
  if (!result.ok) return result
  const season = seasonFromBody(result.data)
  if (!season) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Archive season response was invalid.',
    }
  }
  return { ok: true, season }
}

/** @param {string} seasonId */
export async function reactivatePlatformBusinessSeason(seasonId) {
  const id = String(seasonId ?? '').trim()
  const result = await apiRequest(`/api/admin/platform/seasons/${encodeURIComponent(id)}/reactivate`, {
    method: 'POST',
  })
  if (!result.ok) return result
  const season = seasonFromBody(result.data)
  if (!season) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Reactivate season response was invalid.',
    }
  }
  return { ok: true, season }
}

/**
 * @param {unknown} data
 */
function membersFromBody(data) {
  const body = data && typeof data === 'object' ? /** @type {Record<string, unknown>} */ (data) : {}
  const raw = body.members
  if (!Array.isArray(raw)) return []
  return sortPlatformSeasonMembers(raw.map(parsePlatformSeasonMember).filter(Boolean))
}

/**
 * @param {string} seasonId
 * @returns {Promise<
 *   | { ok: true, season: PlatformBusinessSeason, members: PlatformSeasonMember[] }
 *   | { ok: false, status: number, error: string, message: string }
 * >}
 */
export async function fetchPlatformSeasonMembers(seasonId) {
  const id = String(seasonId ?? '').trim()
  const result = await apiRequest(`/api/admin/platform/seasons/${encodeURIComponent(id)}/members`)
  if (!result.ok) return result
  const season = seasonFromBody(result.data)
  if (!season) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Season members response was invalid.',
    }
  }
  return { ok: true, season, members: membersFromBody(result.data) }
}

/**
 * @param {string} seasonId
 * @param {{ email: string, role: string }} body
 */
export async function assignPlatformSeasonMember(seasonId, body) {
  const id = String(seasonId ?? '').trim()
  const result = await apiRequest(`/api/admin/platform/seasons/${encodeURIComponent(id)}/members`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!result.ok) return result
  const member = parsePlatformSeasonMember(
    result.data && typeof result.data === 'object'
      ? /** @type {Record<string, unknown>} */ (result.data).member
      : null,
  )
  if (!member) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Assign member response was invalid.',
    }
  }
  return { ok: true, member, status: result.status }
}

/**
 * @param {string} seasonId
 * @param {string} userId
 * @param {string} role
 */
export async function updatePlatformSeasonMemberRole(seasonId, userId, role) {
  const sid = String(seasonId ?? '').trim()
  const uid = String(userId ?? '').trim()
  const result = await apiRequest(
    `/api/admin/platform/seasons/${encodeURIComponent(sid)}/members/${encodeURIComponent(uid)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    },
  )
  if (!result.ok) return result
  const member = parsePlatformSeasonMember(
    result.data && typeof result.data === 'object'
      ? /** @type {Record<string, unknown>} */ (result.data).member
      : null,
  )
  if (!member) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Update member role response was invalid.',
    }
  }
  return { ok: true, member }
}

/** @param {string} seasonId @param {string} userId */
export async function disablePlatformSeasonMember(seasonId, userId) {
  return setPlatformSeasonMemberEnabled(seasonId, userId, false)
}

/** @param {string} seasonId @param {string} userId */
export async function enablePlatformSeasonMember(seasonId, userId) {
  return setPlatformSeasonMemberEnabled(seasonId, userId, true)
}

/**
 * @param {string} seasonId
 * @param {string} userId
 * @param {boolean} enabled
 */
async function setPlatformSeasonMemberEnabled(seasonId, userId, enabled) {
  const sid = String(seasonId ?? '').trim()
  const uid = String(userId ?? '').trim()
  const action = enabled ? 'enable' : 'disable'
  const result = await apiRequest(
    `/api/admin/platform/seasons/${encodeURIComponent(sid)}/members/${encodeURIComponent(uid)}/${action}`,
    { method: 'POST' },
  )
  if (!result.ok) return result
  const member = parsePlatformSeasonMember(
    result.data && typeof result.data === 'object'
      ? /** @type {Record<string, unknown>} */ (result.data).member
      : null,
  )
  if (!member) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Membership status response was invalid.',
    }
  }
  return { ok: true, member }
}

const PUBLIC_CATALOGUE_SETTING_PATH = '/api/admin/platform/settings/public-catalogue-season'

/**
 * @param {unknown} data
 */
function publicCatalogueSeasonIdFromBody(data) {
  const body = data && typeof data === 'object' ? /** @type {Record<string, unknown>} */ (data) : {}
  return String(body.publicCatalogueSeasonId ?? '').trim()
}

/** @returns {Promise<{ ok: true, publicCatalogueSeasonId: string } | { ok: false, status: number, error: string, message: string }>} */
export async function fetchPlatformPublicCatalogueSeasonSetting() {
  const result = await apiRequest(PUBLIC_CATALOGUE_SETTING_PATH)
  if (!result.ok) return result
  const publicCatalogueSeasonId = publicCatalogueSeasonIdFromBody(result.data)
  if (!publicCatalogueSeasonId) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Public catalogue setting response was invalid.',
    }
  }
  return { ok: true, publicCatalogueSeasonId }
}

/**
 * @param {string} publicCatalogueSeasonId
 */
export async function updatePlatformPublicCatalogueSeasonSetting(publicCatalogueSeasonId) {
  const id = String(publicCatalogueSeasonId ?? '').trim()
  const result = await apiRequest(PUBLIC_CATALOGUE_SETTING_PATH, {
    method: 'PATCH',
    body: JSON.stringify({ publicCatalogueSeasonId: id }),
  })
  if (!result.ok) return result
  const savedId = publicCatalogueSeasonIdFromBody(result.data)
  if (!savedId) {
    return {
      ok: false,
      status: result.status,
      error: 'invalid_response',
      message: 'Update public catalogue setting response was invalid.',
    }
  }
  return { ok: true, publicCatalogueSeasonId: savedId }
}
