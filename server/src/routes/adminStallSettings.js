import { getAdminContext } from '../middleware/requireAdmin.js'
import { requireSeasonMembership, requireWritableSeason } from '../middleware/adminSeasonGuards.js'
import { readJsonBody, JSON_HEADERS } from '../lib/http.js'
import { getStallSettings, updateStallSettings } from '../services/adminStallSettings.js'

const headers = {...JSON_HEADERS,'Cache-Control':'no-store'}
export async function handleAdminStallSettings(request, env) {
  const url = new URL(request.url)
  if (!/^\/api\/admin\/settings\/?$/.test(url.pathname)) return null
  try {
    if (!['GET','PATCH'].includes(request.method)) return Response.json({error:'method_not_allowed'},{status:405,headers:{...headers,Allow:'GET, PATCH'}})
    const access = request.method === 'GET' ? requireSeasonMembership(request) : requireWritableSeason(request)
    if (!access.ok) return Response.json({error:access.code,message:access.message},{status:access.status,headers})
    if (url.search) return Response.json({error:'validation_error',message:'Settings scope comes from the authorized workspace, not query parameters.'},{status:400,headers})
    const options = {seasonId:access.auth.activeSeasonId,context:getAdminContext(request)}
    if (request.method === 'GET') return Response.json({ok:true,...await getStallSettings(env.DB,options)},{headers})
    const parsed = await readJsonBody(request)
    if (!parsed.ok) return Response.json({error:parsed.error,message:parsed.message},{status:parsed.status,headers})
    return Response.json({ok:true,...await updateStallSettings(env.DB,parsed.value,options)},{headers})
  } catch (error) {
    if ([400,403,409,428,503].includes(error.status)) return Response.json({error:error.code,message:error.message},{status:error.status,headers})
    if (/no such table: (location_settings|location_season_settings)/i.test(error.message)) return Response.json({error:'settings_unavailable',message:'The stall settings schema is not available.'},{status:503,headers})
    return Response.json({error:'settings_not_confirmed',message:'Settings could not be confirmed. Reload the current settings before retrying.'},{status:503,headers})
  }
}
