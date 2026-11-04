import { apiRequest } from './client.js'
import { getAdminRequestContext } from './adminSeasonRequest.js'

export const SETTINGS_PROFILE_FIELDS = ['stallName','stallLabel','brandName','whatsappNumber','phone','locationName','locationAddress','locationDetailLines','locationMapUrl']
export const SETTINGS_SEASON_FIELDS = ['stallDates','stallTimings']
const invalid = () => ({ok:false,status:503,error:'invalid_settings_response',message:'The settings response could not be verified for this stall. Reload settings.'})
async function request(init) {
  const context = getAdminRequestContext()
  if (!context.locationModeEnabled) return {ok:false,status:503,error:'location_required',message:'Stall settings require an authorized location workspace.'}
  const result = await apiRequest('/api/admin/settings', init)
  if (!result.ok) return result
  const value = result.data
  if (!value?.ok || value.scope?.businessId !== context.activeBusinessId || value.scope?.locationId !== context.activeLocationId || value.scope?.seasonId !== context.activeSeasonId ||
      !['profile','season'].every(section => Number.isSafeInteger(value.revisions?.[section]) && value.revisions[section] >= 0) || typeof value.permissions?.canUpdate !== 'boolean') return invalid()
  for (const section of ['profile','season']) for (const key of section === 'profile' ? SETTINGS_PROFILE_FIELDS : SETTINGS_SEASON_FIELDS) {
    const field = value[section]?.[key]
    if (['locationDetailLines','stallDates'].includes(key) ? !Array.isArray(field) || field.some(line => typeof line !== 'string') : typeof field !== 'string') return invalid()
  }
  return {ok:true,settings:value}
}
export const fetchStallSettings = () => request()
export const patchStallSettings = body => request({method:'PATCH',body:JSON.stringify(body)})
