import { getAdminContext } from '../middleware/requireAdmin.js'
import { requireSeasonMembership, requireWritableSeason } from '../middleware/adminSeasonGuards.js'
import { readJsonBody, JSON_HEADERS } from '../lib/http.js'
import { registerOfflineDevice, offlineCatalogue, offlineRequestSnapshot, synchronizeOfflineOperation } from '../services/adminOfflineSync.js'
import { prepareHandover } from '../services/adminHandover.js'
import { prepareOfflineAuthorization, listOfflineAuthorizations, issueOfflineAuthorization, revokeOfflineAuthorization, listBillingPermissions, setBillingPermission } from '../services/adminOfflineGrants.js'

export async function handleAdminOfflineRoutes(request, env, identity) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/admin/offline/')) return null
  const headers = { ...JSON_HEADERS, 'Cache-Control': 'no-store' }
  try {
    const read = request.method === 'GET'
    const access = read ? requireSeasonMembership(request) : requireWritableSeason(request)
    if (!access.ok) return Response.json({ error: access.code, message: access.message }, { status: access.status, headers })
    const options = { seasonId: access.auth.activeSeasonId, context: getAdminContext(request), email: identity.email }
    let result
    if (read && url.pathname === '/api/admin/offline/catalogue') result = await offlineCatalogue(env.DB, options)
    if (read && url.pathname === '/api/admin/offline/grants') result = await listOfflineAuthorizations(env.DB, options)
    if (read && url.pathname === '/api/admin/offline/billing-permissions') result = await listBillingPermissions(env.DB,options)
    if (request.method==='POST' && url.pathname==='/api/admin/offline/billing-permissions') {
      const parsed=await readJsonBody(request)
      if(!parsed.ok)return Response.json({error:parsed.error,message:parsed.message},{status:parsed.status,headers})
      result=await setBillingPermission(env.DB,parsed.value,options)
    }
    const match = url.pathname.match(/^\/api\/admin\/offline\/requests\/([A-Za-z0-9-]{1,128})$/)
    if (read && match) result = await offlineRequestSnapshot(env.DB, match[1], options)
    if (request.method === 'POST' && ['/api/admin/offline/devices', '/api/admin/offline/sync', '/api/admin/offline/handover/prepare','/api/admin/offline/grants/prepare','/api/admin/offline/grants/issue','/api/admin/offline/grants/revoke'].includes(url.pathname)) {
      const parsed = await readJsonBody(request, 131072)
      if (!parsed.ok) return Response.json({ error: parsed.error, message: parsed.message }, { status: parsed.status, headers })
      result = url.pathname.endsWith('/grants/prepare') ? await prepareOfflineAuthorization(env.DB,parsed.value,options,env)
        : url.pathname.endsWith('/grants/issue') ? await issueOfflineAuthorization(env.DB,parsed.value,options,env)
        : url.pathname.endsWith('/grants/revoke') ? await revokeOfflineAuthorization(env.DB,parsed.value,options)
        : url.pathname.endsWith('/devices') ? await registerOfflineDevice(env.DB, parsed.value, options)
        : url.pathname.endsWith('/handover/prepare') ? await prepareHandover(env.DB, parsed.value, options, env)
          : await synchronizeOfflineOperation(env.DB, parsed.value, { ...options, handoverEnv: env, grantEnv:env })
    }
    if (!result) return Response.json({ error: 'not_found' }, { status: 404, headers })
    return Response.json(result, { status: result.ok ? 200 : result.status ?? 400, headers })
  } catch (error) {
    if (/no such (?:table|view): (?:live_)?billing_finalization_permissions|no such column: billing_permission_id/i.test(String(error?.message))) return Response.json({error:'billing_permission_schema_required',message:'Billing Finalization requires local migration 0029. Existing permissions are unchanged.'},{status:503,headers})
    if (/billing_permission_authority_changed|billing_permission_immutable_or_revoke_denied/.test(String(error?.message))) return Response.json({error:'billing_permission_denied',message:'Billing delegation authority changed. Refresh and try again.'},{status:403,headers})
    if (/UNIQUE constraint failed: billing_finalization_permissions/.test(String(error?.message))) return Response.json({error:'permission_conflict',message:'Another permission change was saved. Refresh before retrying.'},{status:409,headers})
    if (/no such (?:table|view): (?:offline_final_price_|live_offline_final_price_)/i.test(String(error?.message))) return Response.json({error:'offline_grant_schema_required',message:'Offline Owner authorization requires prepared migration 0028. No migration was applied; ordinary offline billing remains available.'},{status:503,headers})
    if (/offline_grant_authority_changed|offline_grant_immutable_or_revoke_denied/.test(String(error?.message))) return Response.json({error:'offline_grant_denied',message:'Owner authorization changed before commit. Refresh and review; pending work is preserved.'},{status:403,headers})
    if (/no such table: (handover_device_keys|request_handover_claims)/i.test(String(error?.message))) return Response.json({error:'handover_schema_required',message:'Secure QR handover requires prepared migration 0024. No migration was applied; existing offline work is preserved.'},{status:503,headers})
    if (![400,403,404,409,428,503].includes(error?.status)) throw error
    return Response.json({ error: error.code, message: error.message }, { status: error.status, headers })
  }
}
