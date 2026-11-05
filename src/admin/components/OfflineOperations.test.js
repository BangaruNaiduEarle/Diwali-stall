import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import WebSocket from '../../../server/node_modules/ws/wrapper.mjs'
import { build } from '../../../server/node_modules/esbuild/lib/main.js'
import { Browser } from '../../../server/scripts/offline-qr-pack-browser-client.mjs'
import { qrFixture,qrCatalogue } from '../../../tests/helpers/handoverFixtures.js'
import { publicJwk,sign,digest,encodeFrames,transferScope } from '../../shared/handoverProtocol.js'

// Focused component regressions, not the deferred final manual E2E cycle.
// Camera frame delivery is simulated; verification/assembly/IndexedDB are real.
test('Owner grant controls, Admin cached authorization and scanner preview/acceptance use real local storage', {timeout:90000},async()=>{
  const fixture=await qrFixture(),frames=encodeFrames(fixture.envelope)
  const root=fixture.rootPair,rootKey=publicJwk(await crypto.subtle.exportKey('jwk',root.publicKey))
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import Authorization from './src/admin/components/OfflineAuthorization.jsx';
    import Handover from './src/admin/components/OfflineHandover.jsx';
    import{openOfflineStorage}from'./src/admin/offline/storage.js';
    const catalogue=${JSON.stringify(qrCatalogue)},rootKey=${JSON.stringify(rootKey)};
    const storage=await openOfflineStorage();const device=await storage.device();
    const scope=userId=>({businessId:'shop',locationId:'loc-a',seasonId:'season-2026',userId,deviceId:device.deviceId});
    window.localStore=storage;window.device=device;
    function App(){const[profile,setProfile]=useState(null),[scanner,setScanner]=useState(false),[scan,setScan]=useState(0);
      window.showRole=async role=>{const userId=role==='admin'?'admin':'owner';let saved=await storage.get('profiles',scope(userId),'profile');if(!saved){saved={scope:scope(userId),role,writable:true};await storage.activate(saved,catalogue)}setScanner(false);setProfile(saved)};
      window.scanBill=async prep=>{window.receiverPreparation=prep||window.receiverPreparation;const saved={scope:scope('owner'),role:'owner',writable:true};await storage.activate(saved,catalogue);const prepared=await storage.saveHandoverPreparation(saved.scope,window.receiverPreparation);setProfile(prepared);setScanner(true);setScan(n=>n+1)};
      return profile?scanner?<Handover scanRequest={scan} storage={storage} profile={profile} catalogue={catalogue} operations={[]} canAccept={true} canPrepare={false} disabled={false} onPrepared={setProfile} onAccepted={async draft=>{window.accepted=draft}}/>:<Authorization storage={storage} profile={profile} online={true} authenticated={true} disabled={false} onPrepared={setProfile}/>:<p>Ready</p>;
    }createRoot(document.getElementById('root')).render(<App/>);
  `},bundle:true,write:false,outfile:'operations.js',format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'simulated-camera-only',setup(b){b.onResolve({filter:/offline\/qrCamera\.js$/},()=>({path:'camera',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export async function startQrCamera(video,onFrame,{signal}){window.cameraCallback=onFrame;window.cameraStarts=(window.cameraStarts||0)+1;signal.addEventListener('abort',()=>{window.cameraStops=(window.cameraStops||0)+1});return()=>{}}`}))}}]})
  const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve))
  globalThis.WebSocket??=WebSocket
  const trace=[],origin='http://127.0.0.1:5197'
  const browser=new Browser('offline-operations-components',await mkdtemp(join(tmpdir(),'diwali-offline-operations-')),port,trace)
  let registered,issued=null,revoked=false
  browser.intercept=async p=>{
    const url=new URL(p.request.url)
    if(url.origin!==origin)return browser.call('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'})
    let response
    if(url.pathname==='/operations.js')response=new Response(js,{headers:{'Content-Type':'text/javascript'}})
    else if(url.pathname.startsWith('/api/')){
      let result={ok:true}
      const body=p.request.postData?JSON.parse(p.request.postData):null
      if(url.pathname.endsWith('/grants/prepare')){
        registered=body
        if(issued&&!revoked){
          const prices=[{productId:'P001',finalPricePaise:8000}]
          const claims={v:1,type:'diwali-offline-final-price',grantId:issued.grantId,scope:transferScope({businessId:'shop',locationId:'loc-a',seasonId:'season-2026'}),userId:'admin',deviceId:body.deviceId,ownerUserId:'owner',publicKey:body.publicKey,canFinalize:issued.canFinalize,issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),finalPricesDigest:await digest(prices)}
          result.authorization={rootKey,grant:{claims,signature:await sign(claims,root.privateKey)},finalPrices:prices}
        }else result.authorization=null
      }else if(url.pathname.endsWith('/grants/issue')){issued=body;revoked=false;result.grantId=body.grantId}
      else if(url.pathname.endsWith('/grants/revoke')){revoked=true}
      else if(url.pathname.endsWith('/grants'))result={ok:true,devices:registered?[{userId:'admin',deviceId:registered.deviceId,name:'Registered Admin',email:'admin@test.com'}]:[],grants:issued?[{id:issued.grantId,userId:'admin',deviceId:issued.deviceId,canFinalize:Number(issued.canFinalize),issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),revokedAt:revoked?new Date().toISOString():null}]:[]}
      response=Response.json(result)
    }else response=new Response('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/operations.js"></script></body></html>',{headers:{'Content-Type':'text/html'}})
    await browser.call('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:response.status,responseHeaders:[...response.headers].map(([name,value])=>({name,value})),body:Buffer.from(await response.text()).toString('base64')})
  }
  try{
    await browser.launch();await browser.call('Page.navigate',{url:origin});await browser.wait('Boolean(window.showRole)')
    await browser.eval("window.showRole('admin')");await browser.click('Register / refresh Owner authorization')
    await browser.wait("document.body.textContent.includes('Device authorization key registered')")
    assert.ok(registered.publicKey);assert.equal(registered.deviceToken.length,64)
    await browser.eval("window.showRole('owner')");await browser.click('Load Admin devices & grants')
    await browser.field('Registered Admin device',JSON.stringify(['admin',registered.deviceId]))
    await browser.field('Grant duration','4')
    await browser.eval("document.querySelector('input[type=checkbox]').click()")
    await browser.click('Issue signed device grant')
    await browser.wait("document.body.textContent.includes('Owner grant saved')")
    assert.equal(issued.canFinalize,true);assert.equal(issued.hours,4)
    await browser.eval("window.showRole('admin')");await browser.click('Register / refresh Owner authorization')
    await browser.wait("document.body.textContent.includes('Signed Owner authorization verified')")
    assert.equal(await browser.eval("(async()=>{const d=window.device;return(await window.localStore.get('profiles',{businessId:'shop',locationId:'loc-a',seasonId:'season-2026',userId:'admin',deviceId:d.deviceId},'profile')).authorization.grant.claims.canFinalize})()"),true)
    await browser.call('Page.reload',{ignoreCache:true});await browser.wait('Boolean(window.showRole)')
    await browser.eval("window.showRole('admin')")
    const proof=await browser.eval(`(async()=>{const scope={businessId:'shop',locationId:'loc-a',seasonId:'season-2026',userId:'admin',deviceId:window.device.deviceId};const draft=(await window.localStore.saveDraft(scope,{body:{customer:{name:'Reloaded grant',mobile:'9876543210'},items:[{productId:'P001',quantity:1,unitType:'box'}]}})).draft;const created=await window.localStore.saveDraft(scope,draft,{kind:'CREATE',body:{customer:draft.body.customer,items:draft.body.items,pricingMode:'selling'}});const agreed=await window.localStore.saveDraft(scope,created.draft,{kind:'AGREEMENT',body:{acceptedAmountPaise:100}});return {proof:agreed.operation.authorization.proof,deviceId:scope.deviceId,extractable:(await window.localStore.signingIdentity(scope)).privateKey.extractable}})()`)
    assert.equal(proof.deviceId,registered.deviceId);assert.equal(proof.extractable,false);assert.ok(proof.proof.length>50)
    const ownerPublicKey=await browser.eval("(async()=> (await window.localStore.signingIdentity({businessId:'shop',locationId:'loc-a',seasonId:'season-2026',userId:'owner',deviceId:window.device.deviceId})).publicKey)()")
    const ownerClaims={v:1,scope:{businessId:'shop',locationId:'loc-a',seasonId:'season-2026'},userId:'owner',deviceId:registered.deviceId,role:'owner',publicKey:ownerPublicKey,issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()}
    const prep={rootKey,grantRootKey:rootKey,certificate:{claims:ownerClaims,signature:await sign(ownerClaims,root.privateKey)},recipients:[]}
    await browser.eval(`window.scanBill(${JSON.stringify(prep)})`);await browser.wait('Boolean(window.cameraCallback)')
    await browser.eval(`window.cameraCallback(${JSON.stringify(frames[0])})`)
    assert.equal(await browser.eval("document.body.textContent.includes('Verified request preview')"),false)
    for(const frame of frames.slice(1))await browser.eval(`window.cameraCallback(${JSON.stringify(frame)})`)
    await browser.wait("document.body.textContent.includes('Verified request preview')")
    assert.ok(await browser.eval('window.cameraStops>=1'))
    await browser.click('Accept provisionally and save to outbox');await browser.wait('Boolean(window.accepted)')
    assert.equal(await browser.eval("(async()=>{const rows=await window.localStore.list('outbox',window.accepted.scope);return rows[0].payload.kind})()"),'HANDOVER')
    await browser.eval('window.scanBill()');await browser.wait('window.cameraStarts>=2')
    for(const frame of frames)await browser.eval(`window.cameraCallback(${JSON.stringify(frame)})`)
    await browser.wait("document.body.textContent.includes('Verified request preview')")
    await browser.click('Accept provisionally and save to outbox')
    assert.equal(await browser.eval("(async()=> (await window.localStore.list('outbox',window.accepted.scope)).length)()"),1)
    assert.equal(trace.filter(row=>row.interceptionError).length,0,JSON.stringify(trace))
  }finally{await browser.close()}
})
