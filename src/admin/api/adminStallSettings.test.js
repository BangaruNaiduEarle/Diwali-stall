import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchStallSettings, patchStallSettings } from './adminStallSettings.js'
import { clearAdminActiveSeasonId, setAdminActiveSeasonId, setAdminLocationSelection, setAdminContextSwitching } from './adminSeasonRequest.js'

export const fixture = (location='a',canUpdate=true) => ({ok:true,scope:{businessId:'business',locationId:location,seasonId:'season'},
  profile:{stallName:location,stallLabel:'',brandName:'Brand '+location,phone:'',whatsappNumber:'',locationName:'Venue '+location,locationAddress:'',locationDetailLines:[],locationMapUrl:''},
  season:{stallDates:[],stallTimings:''},revisions:{profile:0,season:0},permissions:{canUpdate}})
const context = (location='a') => {setAdminActiveSeasonId('season');setAdminLocationSelection({locationModeEnabled:true,activeBusinessId:'business',activeLocationId:location})}
function setup(t,fetcher) {const old=globalThis.fetch;globalThis.fetch=fetcher;context();t.after(()=>{globalThis.fetch=old;clearAdminActiveSeasonId()})}
const response = value => Response.json(value)

test('GET uses the existing confirmed stall/season headers and includes session credentials',async t=>{
  setup(t,async(url,options)=>{assert.equal(url,'/api/admin/settings');assert.equal(options.headers.get('X-Admin-Location-Id'),'a');assert.equal(options.headers.get('X-Admin-Season-Id'),'season');assert.equal(options.credentials,'include');return response(fixture())})
  assert.equal((await fetchStallSettings()).settings.scope.locationId,'a')
})
test('PATCH forwards only the supplied changed fields/revisions without financial If-Match headers',async t=>{
  const body={profile:{phone:'9876543210'},expectedProfileRevision:0}
  setup(t,async(url,options)=>{assert.equal(options.method,'PATCH');assert.deepEqual(JSON.parse(options.body),body);assert.equal(options.headers.has('If-Match'),false);return response({...fixture(),changed:true})})
  assert.equal((await patchStallSettings(body)).ok,true)
})
test('late A response is rejected after selecting B',async t=>{
  let finish
  setup(t,()=>new Promise(resolve=>{finish=resolve}))
  const pending=fetchStallSettings();context('b');finish(response(fixture('a')))
  assert.equal((await pending).error,'stale_context')
})
test('same-generation foreign stall or season payloads cannot populate the settings context',async t=>{
  setup(t,async()=>response(fixture('b')))
  assert.equal((await fetchStallSettings()).error,'invalid_settings_response')
  globalThis.fetch=async()=>response({...fixture(),scope:{...fixture().scope,seasonId:'other'}})
  assert.equal((await fetchStallSettings()).ok,false)
})
test('malformed payloads fail closed instead of trusting a partial cached settings object',async t=>{
  setup(t,async()=>response({...fixture(),profile:{phone:'9876543210'}}))
  assert.equal((await fetchStallSettings()).error,'invalid_settings_response')
})
test('Admin server read-only permission and original empty defaults are retained exactly',async t=>{
  setup(t,async()=>response(fixture('a',false)))
  const result=await fetchStallSettings();assert.equal(result.settings.permissions.canUpdate,false);assert.equal(result.settings.profile.phone,'')
})
test('server authorization and revision failures remain explicit',async t=>{
  setup(t,async()=>Response.json({error:'revision_conflict',message:'Reload settings.'},{status:409}))
  assert.equal((await patchStallSettings({})).error,'revision_conflict')
  globalThis.fetch=async()=>Response.json({error:'forbidden',message:'Membership changed.'},{status:403})
  assert.equal((await patchStallSettings({})).status,403)
})
test('switching, legacy mode and network failure never fall back to another stall or static contacts',async t=>{
  let calls=0;setup(t,async()=>{calls++;throw Error('offline')})
  setAdminContextSwitching(true);assert.equal((await fetchStallSettings()).ok,false);assert.equal(calls,0)
  setAdminContextSwitching(false);assert.equal((await fetchStallSettings()).error,'network_error')
  clearAdminActiveSeasonId();assert.equal((await fetchStallSettings()).error,'location_required');assert.equal(calls,1)
})
