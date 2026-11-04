import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStallSettingsStore, settingsForm, settingsPatch, stallWhatsAppUrl } from './stallSettings.js'
import { siteConfig } from '../../data/siteConfig.js'
import { adminDestination, adminRouteAccess } from './adminWorkspaceAccess.js'
import { dailyAdminLinks } from './adminNavigation.js'

const fixture=(location='a',canUpdate=true)=>({scope:{businessId:'business',locationId:location,seasonId:'season'},
  profile:{stallName:location,stallLabel:'',brandName:'Brand '+location,phone:'',whatsappNumber:'',locationName:'Venue '+location,locationAddress:'',locationDetailLines:[],locationMapUrl:''},
  season:{stallDates:[],stallTimings:''},revisions:{profile:2,season:3},permissions:{canUpdate}})
const scope=key=>({key,enabled:true,legacy:false})
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}

test('form builds a minimal typed PATCH and preserves original date-label defaults',()=>{
  const settings=fixture();settings.season.stallDates=[...siteConfig.stallDates]
  const form=settingsForm(settings);assert.equal(settingsPatch(settings,form),null)
  form.profile.phone=' 9876543210 ';form.season.stallDates+='\n2026-11-09'
  assert.deepEqual(settingsPatch(settings,form),{profile:{phone:'9876543210'},expectedProfileRevision:2,season:{stallDates:[...siteConfig.stallDates,'2026-11-09']},expectedSeasonRevision:3})
  assert.deepEqual(settings.season.stallDates,siteConfig.stallDates)
})
test('explicit empty strings and arrays clear optional values without unknown fields',()=>{
  const settings=fixture();settings.profile.phone='9876543210';settings.profile.locationDetailLines=['First'];const form=settingsForm(settings)
  form.profile.phone='';form.profile.locationDetailLines='';form.profile.purchaseRate=10
  assert.deepEqual(settingsPatch(settings,form),{profile:{phone:'',locationDetailLines:[]},expectedProfileRevision:2})
})
test('workspace WhatsApp uses only the selected settings and never an empty-contact fallback',()=>{
  const a=fixture();a.profile.whatsappNumber='9876543210'
  assert.match(stallWhatsAppUrl(a),/^https:\/\/wa.me\/919876543210\?/)
  assert.equal(stallWhatsAppUrl(fixture('b')),null);assert.equal(stallWhatsAppUrl(null),null)
})
test('scope switches clear settings synchronously and discard delayed A loads',async()=>{
  const a=deferred(),b=deferred();let index=0
  const store=createStallSettingsStore({load:()=>[a.promise,b.promise][index++],save:()=>{throw Error('unused')}})
  const first=store.setContext(scope('a')),second=store.setContext(scope('b'))
  assert.equal(store.getSnapshot().settings,null);assert.equal(store.getSnapshot().key,'b')
  b.resolve({ok:true,settings:fixture('b')});await second
  a.resolve({ok:true,settings:fixture('a')});await first
  assert.equal(store.getSnapshot().settings.scope.locationId,'b')
})
test('successful update immediately refreshes shared consumer settings',async()=>{
  const changed=fixture();changed.profile.whatsappNumber='9876543210'
  const store=createStallSettingsStore({load:async()=>({ok:true,settings:fixture()}),save:async()=>({ok:true,settings:changed})})
  await store.setContext(scope('a'));await store.save({profile:{whatsappNumber:'9876543210'},expectedProfileRevision:2})
  assert.equal(store.getSnapshot().settings.profile.whatsappNumber,'9876543210');assert.equal(store.getSnapshot().notice,'Settings saved.')
})
test('late successful A save cannot replace B after a switch',async()=>{
  const pending=deferred();let location='a'
  const store=createStallSettingsStore({load:async()=>({ok:true,settings:fixture(location)}),save:()=>pending.promise})
  await store.setContext(scope('a'));const saving=store.save({});location='b';await store.setContext(scope('b'))
  pending.resolve({ok:true,settings:fixture('a')});assert.equal((await saving).error,'stale_context')
  assert.equal(store.getSnapshot().settings.scope.locationId,'b')
})
test('revision conflicts retain the loaded edit basis, block resubmission and require explicit reload',async()=>{
  let revision=2,saves=0
  const store=createStallSettingsStore({load:async()=>({ok:true,settings:{...fixture(),revisions:{profile:revision,season:3}}}),save:async()=>{saves++;return {ok:false,status:409,error:'revision_conflict'}}})
  await store.setContext(scope('a'));await store.save({})
  assert.equal(store.getSnapshot().settings.revisions.profile,2);assert.equal(store.getSnapshot().conflict,true)
  assert.equal((await store.save({})).ok,false);assert.equal(saves,1)
  revision=3;await store.reload();assert.equal(store.getSnapshot().blocked,false);assert.equal(store.getSnapshot().settings.revisions.profile,3)
})
test('Admin and changed server permissions do not permit a save through the shared model',async()=>{
  let calls=0
  const store=createStallSettingsStore({load:async()=>({ok:true,settings:fixture('a',false)}),save:async()=>{calls++;return {ok:true}}})
  await store.setContext(scope('a'));assert.equal((await store.save({})).status,403);assert.equal(calls,0)
})
test('authorization/network errors and logout preserve no cross-scope cached settings',async()=>{
  const store=createStallSettingsStore({load:async()=>({ok:true,settings:fixture()}),save:async()=>({ok:false,status:403,error:'forbidden',message:'Removed'})})
  await store.setContext(scope('a'));await store.save({});assert.equal(store.getSnapshot().blocked,true)
  store.invalidate();assert.equal(store.getSnapshot().settings,null)
  const failing=createStallSettingsStore({load:async()=>{throw Error('offline')},save:async()=>{}})
  await failing.setContext(scope('b'));assert.equal(failing.getSnapshot().status,'error');assert.equal(failing.getSnapshot().settings,null)
})
test('legacy defaults do not trigger scoped API requests or mutate siteConfig',async()=>{
  const before=JSON.stringify(siteConfig);let calls=0
  const store=createStallSettingsStore({load:async()=>{calls++},save:async()=>{calls++}})
  await store.setContext({key:'legacy',enabled:false,legacy:true})
  assert.equal(store.getSnapshot().status,'legacy');assert.equal(calls,0);assert.equal(JSON.stringify(siteConfig),before)
})
test('settings route/navigation permits scoped read roles and excludes Platform-only identities',()=>{
  const row={location:{id:'a'},business:{id:'business'},operatingSeason:{id:'season'},effectiveRole:'admin',capabilities:{read:true,write:true}}
  const session={status:'authenticated',locationModeEnabled:true,activeLocationId:'a',activeBusinessId:'business',activeSeasonId:'season',effectiveRole:'admin',authorizedLocations:[row],capabilities:{read:true,write:true}}
  assert.equal(adminDestination('/admin/settings').path,'/admin/settings');assert.equal(adminRouteAccess(session,'/admin/settings').allowed,true)
  assert.equal(dailyAdminLinks(session).some(link=>link.to==='/admin/settings'),true)
  assert.equal(adminRouteAccess({...session,platformAdmin:true,authorizedLocations:[]},'/admin/settings').allowed,false)
})
