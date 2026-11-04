import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allowedReports, reportFields, reportQuery, reportValue } from './reports.js'
import { adminDestination, adminRouteAccess } from './adminWorkspaceAccess.js'
import { dailyAdminLinks } from './adminNavigation.js'
test('money presentation preserves zero, losses and unavailable rather than estimating',()=>{
  assert.equal(reportValue(null,'money'),'Unavailable');assert.equal(reportValue(0,'money'),'₹0.00');assert.equal(reportValue(-101,'money'),'−₹1.01');assert.equal(reportValue(100,'money'),'₹1.00');assert.equal(reportValue(1.1,'money'),'Unavailable')
})
test('Admin projections allow only operational reports and omit privileged fields',()=>{
  assert.deepEqual(allowedReports('admin'),['bills','products']);assert.equal(allowedReports('owner').length,6);assert.deepEqual(allowedReports(null),['bills','products'])
  for(const type of ['bills','products'])assert.equal(reportFields(type,'columns','admin').some(field=>field.privateValue),false)
})
test('query dates and payment/unit filters stay in the backend contract without timezone arithmetic',()=>{
  assert.equal(reportQuery({from:'2026-11-04',toExclusive:'2026-11-05',requestId:'',limit:'1',recordingMode:'OFFLINE'},2),'from=2026-11-04&toExclusive=2026-11-05&limit=1&recordingMode=OFFLINE&page=2')
})
test('unavailable boolean cost coverage and unknown values are explicit',()=>{
  assert.equal(reportValue(false,'boolean'),'No — unavailable');assert.equal(reportValue(null),'Unavailable');assert.equal(reportValue(''),'Unavailable')
})
test('Reports destination/navigation require the existing authorized operational tuple',()=>{
  const tuple={business:{id:'b'},location:{id:'a'},operatingSeason:{id:'s'},effectiveRole:'admin',capabilities:{read:true}}
  const session={status:'authenticated',locationModeEnabled:true,activeBusinessId:'b',activeLocationId:'a',activeSeasonId:'s',effectiveRole:'admin',capabilities:{read:true},authorizedLocations:[tuple]}
  assert.equal(adminDestination('/admin/reports').path,'/admin/reports');assert.equal(adminRouteAccess(session,'/admin/reports').allowed,true)
  assert.equal(dailyAdminLinks(session).some(link=>link.to==='/admin/reports'),true)
  assert.equal(adminRouteAccess({...session,platformAdmin:true,authorizedLocations:[]},'/admin/reports').allowed,false)
  assert.equal(adminRouteAccess({...session,seasonSwitching:true},'/admin/reports').allowed,false)
})
