import { requireSeasonMembership } from '../middleware/adminSeasonGuards.js'
import { getAdminContext } from '../middleware/requireAdmin.js'
import { getStandaloneReport } from '../services/adminReports.js'

const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
export async function handleAdminReports(request,env) {
  const url=new URL(request.url),match=url.pathname.match(/^\/api\/admin\/reports(?:\/([a-z-]+))?\/?$/)
  if(!match)return null
  try{
    const access=requireSeasonMembership(request)
    if(!access.ok)return Response.json({error:access.code,message:access.message},{status:access.status,headers})
    if(request.method!=='GET')return Response.json({error:'method_not_allowed'},{status:405,headers:{...headers,Allow:'GET'}})
    const result=await getStandaloneReport(env.DB,match[1]??'',url.searchParams,{seasonId:access.auth.activeSeasonId,context:getAdminContext(request)})
    return Response.json(result,{headers})
  }catch(error){
    if([400,403,404,503].includes(error.status))return Response.json({error:error.code,message:error.message},{status:error.status,headers})
    return Response.json({error:'reports_unavailable',message:'Recorded report data could not be read safely. Please try again.'},{status:503,headers})
  }
}
