import { apiRequest } from './client.js'
import { getAdminRequestContext } from './adminSeasonRequest.js'
import { allowedReports, REPORTS } from '../lib/reports.js'

const invalid=()=>({ok:false,status:503,error:'invalid_report_response',message:'The report response could not be verified for this stall and season. Retry loading reports.'})
async function request(path,role) {
  const context=getAdminRequestContext()
  if(!context.locationModeEnabled)return {ok:false,status:503,error:'location_required',message:'Reports require an authorized stall and season workspace.'}
  const result=await apiRequest('/api/admin/reports'+path,{cache:'no-store'})
  if(!result.ok)return result
  const data=result.data
  if(!data?.ok || data.scope?.businessId!==context.activeBusinessId || data.scope?.locationId!==context.activeLocationId || data.scope?.seasonId!==context.activeSeasonId || data.timeZone!=='Asia/Kolkata')return invalid()
  const allowed=allowedReports(role)
  if(!path){
    if(!Array.isArray(data.reports)||data.reports.some(type=>!Object.hasOwn(REPORTS,type)))return invalid()
    return {ok:true,reports:data.reports.filter(type=>allowed.includes(type))}
  }
  const type=path.slice(1).split('?')[0]
  if(!allowed.includes(type) || data.report!==type || data.currency!=='INR' || !Array.isArray(data.rows) || data.rows.length>100 || !data.summary || typeof data.summary!=='object' || Array.isArray(data.summary))return invalid()
  const paging=data.pagination
  if(!paging || !['page','limit','total','totalPages'].every(key=>Number.isSafeInteger(paging[key])&&paging[key]>=0) || paging.page<1 || paging.limit<1 || paging.limit>100)return invalid()
  // Validate the scalar contract; render only allowlisted descriptors, never arbitrary API keys.
  for(const record of [data.summary,...data.rows]){
    if(!record || typeof record!=='object' || Array.isArray(record))return invalid()
    for(const value of Object.values(record))if(value!==null && !['string','boolean','number'].includes(typeof value) || typeof value==='number'&&!Number.isSafeInteger(value))return invalid()
  }
  if(role!=='owner'&&role!=='super_admin'){
    const forbidden=/cost|profit|margin|purchase|recordedQuotationTotal|recordedAdjustment|recordedLineSales|allocatedFinalRevenue/i
    if([data.summary,...data.rows].some(record=>Object.keys(record).some(key=>forbidden.test(key))))return invalid()
    if(type==='bills'&&['amountDuePaise','knownAmountDuePaise'].some(key=>Object.hasOwn(data.summary,key)))return invalid()
  }
  return {ok:true,report:data}
}
export const fetchReportList=role=>request('',role)
export const fetchReport=(type,query,role)=>allowedReports(role).includes(type)?request('/'+type+(query?'?'+query:''),role):Promise.resolve({ok:false,status:403,error:'forbidden',message:'This report requires Owner or Super Admin permission.'})
