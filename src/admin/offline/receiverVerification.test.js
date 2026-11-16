import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { qrFixture, qrScope } from '../../../tests/helpers/handoverFixtures.js'
import { sign } from '../../shared/handoverProtocol.js'
import { verifyReceivedBill } from './receiverVerification.js'

test('scanner restart isolates old verification results, failures and cleanup from the latest attempt', async () => {
  const source=readFileSync(new URL('../components/OfflineHandover.jsx',import.meta.url),'utf8')
  // Execute the component's actual handlers with controlled async verification.
  // No camera, browser storage, crypto or acceptance operations are needed.
  const reset=source.match(/  function resetReceiver\([^]*?\n  }/)[0]
  const receive=source.match(/  async function receive\([^]*?\n  }/)[0]
  const cleanup=source.match(/useEffect\(\(\)=>\(\)=>\{([^}]+)\},\[\]\)/)[1]
  const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
  function harness() {
    const state={preview:null,error:'',progress:'',scanning:false,scannerSession:0},pending=[]
    const verificationAttempt={current:0},checking={current:false},collector={current:null}
    const make=new Function('verificationAttempt','checking','collector','createFrameCollector','verifyReceivedBill','storage','profile',
      'setPreview','setError','setProgress','setScanning','setScannerSession',`${reset}\n${receive}\nreturn {resetReceiver,receive,cleanup:()=>{${cleanup}}}`)
    const handlers=make(verificationAttempt,checking,collector,()=>frame=>({received:1,total:1,envelope:frame}),
      ()=>{const work=deferred();pending.push(work);return work.promise},{},{scope:{}},
      value=>{state.preview=value},value=>{state.error=value},value=>{state.progress=value},value=>{state.scanning=value},value=>{state.scannerSession=value})
    handlers.resetReceiver(true)
    return{...handlers,state,pending,checking}
  }
  for(const staleFailure of [false,true]) {
    const h=harness(),oldPayload={id:'old'},newPayload={id:'new'}
    const old=h.receive(oldPayload)
    h.resetReceiver(true)
    const latest=h.receive(newPayload)
    const waiting={...h.state}
    if(staleFailure)h.pending[0].reject(Error('obsolete failure'))
    else h.pending[0].resolve(oldPayload)
    await old
    assert.deepEqual(h.state,waiting,'old completion cannot replace new progress, error or preview')
    assert.equal(h.checking.current,true,'old finally cannot release the latest verification lock')
    await h.receive({id:'extra frame'})
    assert.equal(h.pending.length,2,'additional frames cannot start concurrent verification')
    h.pending[1].resolve(newPayload);await latest
    assert.equal(h.state.preview,newPayload)
    assert.equal(h.state.error,'')
    assert.match(h.state.progress,/Complete sequence verified/)
  }
  const h=harness(),old=h.receive({id:'old'})
  h.resetReceiver(true)
  const latest=h.receive({id:'new'})
  h.pending[1].resolve({});await latest
  const completed={...h.state}
  h.pending[0].resolve({});await old
  assert.deepEqual(h.state,completed,'late old success cannot overwrite a completed new preview')
  for(const action of ['resetReceiver','cleanup']) {
    const h=harness(),work=h.receive({id:'abandoned'})
    h[action]()
    const stopped={...h.state}
    h.pending[0].resolve({});await work
    assert.deepEqual(h.state,stopped,`${action} prevents stale completion updates`)
  }
  assert.match(source,/onClick=\{\(\)=>resetReceiver\(true\)\}>Start camera scanner/)
  assert.match(source,/onClick=\{\(\)=>resetReceiver\(\)\}>Stop camera/)
  assert.match(source,/onClick=\{\(\)=>resetReceiver\(\)\}>Cancel preview/)
  assert.match(source,/handledScan\.current=scanRequest;onScanHandled\?\.\(\)\s+resetReceiver\(\)/)
  assert.match(source,/const attempt=resetReceiver\(\);for\(const frame[^]*?if\(attempt!==verificationAttempt.current\)break/)
  assert.match(source,/!controller.signal.aborted&&attempt===verificationAttempt.current/)
  assert.match(source,/\},\[scanning,scannerSession\]\)/)
})

test('receiver verification finishes offline or rejects clearly for recipient, preparation, signature and stalled storage', async () => {
  const fixture=await qrFixture({recipient:'super'})
  const scope={...qrScope,userId:'super',deviceId:'receiver-phone'}
  const receiver=await qrFixture({rootPair:fixture.rootPair,userId:scope.userId,deviceId:scope.deviceId})
  const claims={...receiver.certificate.claims,role:'super_admin'}
  const profile={scope,role:'super_admin',writable:true,handover:{rootKey:fixture.rootKey,
    certificate:{claims,signature:await sign(claims,fixture.rootPair.privateKey)},recipients:[]}}
  let current=profile
  const storage={get:async()=>current,signingIdentity:async()=>({publicKey:claims.publicKey})}
  const args={storage,scope,envelope:fixture.envelope}
  const originalFetch=globalThis.fetch
  globalThis.fetch=()=>{throw Error('Unexpected network call')}
  try {
    assert.deepEqual(await verifyReceivedBill(args),fixture.envelope)
    await assert.rejects(verifyReceivedBill({...args,scope:{...scope,userId:'other'}}),/intended recipient.*different user/)
    const tampered=structuredClone(fixture.envelope);tampered.payload.lines[0].quantity++
    await assert.rejects(verifyReceivedBill({...args,envelope:tampered}),/signature verification failed/)
    current={...profile,handover:undefined}
    await assert.rejects(verifyReceivedBill(args),/preparation is missing/)
    current={...profile,handover:{...profile.handover,certificate:{...profile.handover.certificate,claims:{...claims,expiresAt:'2000-01-01T00:00:00.000Z'}}}}
    await assert.rejects(verifyReceivedBill(args),/expired/)
    current={...profile,authorityRevoked:true}
    await assert.rejects(verifyReceivedBill(args),/revoked/)
    await assert.rejects(verifyReceivedBill({...args,storage:{get:()=>new Promise(()=>{})},timeoutMs:10}),/timed out while reading/)
    // A rejection must replace the progress message as well as display the error.
    const source=readFileSync(new URL('../components/OfflineHandover.jsx',import.meta.url),'utf8')
    assert.match(source,/catch\(reason\).*setProgress\('Verification failed\. No bill was imported\.'\)/)
  } finally {globalThis.fetch=originalFetch}
})
