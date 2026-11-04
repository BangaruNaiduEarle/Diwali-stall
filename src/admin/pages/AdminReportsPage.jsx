import { useEffect, useState } from 'react'
import Button from '../../components/ui/Button.jsx'
import { useAdminSession } from '../context/AdminSessionContext.jsx'
import { fetchReport, fetchReportList } from '../api/adminReports.js'
import { REPORTS, reportFields, reportQuery, reportValue } from '../lib/reports.js'
import { canViewSensitiveProductPricing } from '../lib/adminRoles.js'

const initialFilters=()=>({from:'',toExclusive:'',limit:'25',requestId:''})
function ErrorState({error,retry}) {
  return <div className="admin-state admin-state--error" role="alert"><p>{error.status===401?'Your session expired. Sign in again to load reports.':error.status===403?'Report access was denied. Your stall membership or role may have changed.':error.message}</p><Button variant="secondary" onClick={retry}>Retry reports</Button></div>
}
function Values({fields,record}) {
  return <dl className="grid min-w-0 gap-3 sm:grid-cols-2">{fields.filter(({key})=>Object.hasOwn(record,key)).map(({key,label,type})=><div key={key} className="min-w-0"><dt className="text-xs text-[var(--color-muted)]">{label}</dt><dd className="mt-1 break-words font-medium [overflow-wrap:anywhere]">{reportValue(record[key],type)}</dd></div>)}</dl>
}
function ReportData({type,query,role,setPage}) {
  const [state,setState]=useState({status:'loading'}),[attempt,setAttempt]=useState(0)
  useEffect(()=>{
    let current=true
    fetchReport(type,query,role).then(result=>{if(current)setState(result.ok?{status:'ready',data:result.report}:{status:'error',error:result})})
    return ()=>{current=false}
  },[type,query,role,attempt])
  function retry(){setState({status:'loading'});setAttempt(n=>n+1)}
  if(state.status==='loading')return <p className="admin-state" role="status">Loading selected stall report…</p>
  if(state.status==='error')return <ErrorState error={state.error} retry={retry}/>
  const data=state.data
  return <section aria-label="Report results" data-report={type}>
    <div className="admin-panel mt-4"><h2 className="text-lg font-semibold">{REPORTS[type].label}</h2><p className="mb-4 text-sm text-[var(--color-muted)]">Full filtered summary · Asia/Kolkata · INR</p><Values fields={reportFields(type,'summary',role)} record={data.summary}/></div>
    {type==='profit'?<p className="admin-state mt-4">Historical profit uses immutable transaction-time purchase costs. Missing or incomplete snapshots mean profit is unavailable. Family Pack profit is unavailable until its valuation model is defined. Known-subset values cover complete-cost bills only.</p>:null}
    {type==='products'?<p className="admin-state mt-4">Quantities retain their recorded units.{canViewSensitiveProductPricing(role)?' Saved line gross is before bill adjustments and negotiated totals; no final revenue is allocated to products. Family Pack profit is unavailable.':' This operational report shows recorded quantities only.'}</p>:null}
    {type==='bills'?<p className="mt-4 text-sm text-[var(--color-muted)]">Balances are current recorded balances, not historical balances at the date cutoff.</p>:null}
    {type==='seasons'?<p className="mt-4 text-sm text-[var(--color-muted)]">Only the selected authorized season is included. Change Season in the workspace header to read another season.</p>:null}
    <p className="my-4 text-sm" role="status">{data.pagination.total} {['bills','profit'].includes(type)?'bills':'groups'} · Page {data.pagination.page} of {data.pagination.totalPages || 1}</p>
    {!data.rows.length?<p className="admin-state" role="status">No recorded results match these filters.</p>:<div className="grid min-w-0 gap-4 lg:grid-cols-2">{data.rows.map((row,index)=><article className="admin-panel min-w-0" key={index} aria-label={`Report row ${index+1}`}><Values fields={reportFields(type,'columns',role)} record={row}/>{type==='profit'&&!row.costAvailable?<p className="mt-3 text-sm">Profit unavailable — historical costs are missing, incomplete or unsupported (including Family Packs).</p>:null}</article>)}</div>}
    <p className="mt-4 text-xs text-[var(--color-muted)]">Generated {data.generatedAt ?? 'time unavailable'}. Unknown dates are excluded from date-filtered results; coverage counts describe the entire selected stall and season.</p>
    <ReportPager pagination={data.pagination} setPage={setPage}/>
  </section>
}
function ReportPager({pagination,setPage}) {
  return <nav aria-label="Report pagination" className="mt-6 flex flex-wrap gap-3"><Button variant="secondary" disabled={pagination.page<=1} onClick={()=>setPage(pagination.page-1)}>Previous report page</Button><Button variant="secondary" disabled={pagination.page>=pagination.totalPages||pagination.page>=10000} onClick={()=>setPage(pagination.page+1)}>Next report page</Button></nav>
}
function WorkspaceReports({role}) {
  const [listing,setListing]=useState({status:'loading'}),[reload,setReload]=useState(0),[type,setType]=useState(''),[draft,setDraft]=useState(initialFilters),[filters,setFilters]=useState(initialFilters),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0)
  useEffect(()=>{
    let current=true
    fetchReportList(role).then(result=>{if(!current)return;setListing(result.ok?{status:'ready',reports:result.reports}:{status:'error',error:result});if(result.ok)setType(result.reports[0]??'')})
    return ()=>{current=false}
  },[role,reload])
  const query=reportQuery(filters,page)
  function select(value){setType(value);setDraft(initialFilters());setFilters(initialFilters());setPage(1)}
  function field(key,value){setDraft(current=>({...current,[key]:value}))}
  if(listing.status==='loading')return <p className="admin-state" role="status">Loading authorized reports…</p>
  if(listing.status==='error')return <ErrorState error={listing.error} retry={()=>{setListing({status:'loading'});setReload(n=>n+1)}}/>
  if(!type)return <p className="admin-state">No reports are authorized for this workspace.</p>
  return <>
    <form className="admin-panel grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Report filters" onSubmit={e=>{e.preventDefault();setFilters({...draft});setPage(1);setRefresh(n=>n+1)}}>
      <label className="admin-field"><span className="admin-label">Report</span><select className="admin-input" aria-label="Report" value={type} onChange={e=>select(e.target.value)}>{listing.reports.map(key=><option key={key} value={key}>{REPORTS[key].label}</option>)}</select></label>
      <label className="admin-field"><span className="admin-label">Start date (included)</span><input type="date" className="admin-input min-w-0" aria-label="Start date (included)" min="1970-01-01" value={draft.from} onChange={e=>field('from',e.target.value)}/></label>
      <label className="admin-field"><span className="admin-label">End date (excluded)</span><input type="date" className="admin-input min-w-0" aria-label="End date (excluded)" min="1970-01-01" value={draft.toExclusive} onChange={e=>field('toExclusive',e.target.value)}/></label>
      <label className="admin-field"><span className="admin-label">Rows per page</span><select className="admin-input" aria-label="Rows per page" value={draft.limit} onChange={e=>field('limit',e.target.value)}>{[1,10,25,50,100].map(limit=><option key={limit} value={limit}>{limit}</option>)}</select></label>
      <label className="admin-field"><span className="admin-label">Request ID (optional)</span><input className="admin-input" aria-label="Request ID (optional)" maxLength={128} value={draft.requestId} onChange={e=>field('requestId',e.target.value)}/></label>
      {type==='collections'?<>{[['dateBasis','Payment date basis',['received','occurred']],['paymentMethod','Payment method',['','CASH','UPI','CARD','BANK','OTHER']],['recordingMode','Recording mode',['','ONLINE','OFFLINE']]].map(([key,label,options])=><label className="admin-field" key={key}><span className="admin-label">{label}</span><select className="admin-input" aria-label={label} value={draft[key]??(key==='dateBasis'?'received':'')} onChange={e=>field(key,e.target.value)}>{options.map(value=><option key={value} value={value}>{value||'All'}</option>)}</select></label>)}</>:null}
      {type==='products'?<>{[['productId','Product ID'],['familyPackId','Family Pack ID']].map(([key,label])=><label className="admin-field" key={key}><span className="admin-label">{label}</span><input className="admin-input" aria-label={label} maxLength={128} value={draft[key]??''} onChange={e=>field(key,e.target.value)}/></label>)}<label className="admin-field"><span className="admin-label">Unit</span><select className="admin-input" aria-label="Unit" value={draft.unitType??''} onChange={e=>field('unitType',e.target.value)}>{['','box','piece','unknown'].map(unit=><option key={unit} value={unit}>{unit||'All'}</option>)}</select></label></>:null}
      <div className="flex flex-wrap items-end gap-3"><Button type="submit">Apply report filters</Button><Button variant="secondary" onClick={()=>{setDraft(initialFilters());setFilters(initialFilters());setPage(1);setRefresh(n=>n+1)}}>Reset filters</Button></div>
      <p className="text-sm text-[var(--color-muted)] sm:col-span-2 lg:col-span-3">Dates use Asia/Kolkata. {type==='collections'?'Choose server receipt time or recorded occurrence time.':'Dates refer to server finalization.'} Use the workspace Season and Active stall selectors to change the authorized report scope. Reports require a connection; pending offline transactions are not included.</p>
    </form>
    <ReportData key={JSON.stringify([type,query,refresh])} type={type} query={query} role={role} setPage={setPage}/>
  </>
}
export default function AdminReportsPage() {
  const session=useAdminSession()
  const key=JSON.stringify([session.userId,session.email,session.contextKey,session.activeBusinessId,session.activeLocationId,session.activeSeasonId,session.permissionRole,session.seasonSwitching])
  return <div className="admin-page min-w-0"><header className="admin-page__head"><div><p className="admin-page__eyebrow">Selected stall</p><h1 className="admin-page__title">Reports</h1><p className="admin-page__subtitle">{session.location?.name??'Choose an authorized stall'} · {session.activeSeasonId??''}</p></div></header>
    {!session.locationModeEnabled?<p className="admin-state">Reports require the authorized stall and season workspace. Existing single-stall billing is unchanged.</p>:session.seasonSwitching?<p className="admin-state" role="status">Switching report workspace…</p>:<WorkspaceReports key={key} role={session.permissionRole}/>}</div>
}
