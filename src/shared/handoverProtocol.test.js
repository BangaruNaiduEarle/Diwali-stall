import assert from 'node:assert/strict'
import { test } from 'node:test'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { qrFixture,qrScope } from '../../tests/helpers/handoverFixtures.js'
import { verifyTransfer,encodeFrames,createFrameCollector,sign } from './handoverProtocol.js'

test('real QR generation, image decoding and offline multi-frame assembly verify the signed request',async()=>{
  const {envelope,rootKey}=await qrFixture(),frames=encodeFrames(envelope),collect=createFrameCollector()
  let result
  for(const frame of frames.toReversed?frames.toReversed():[...frames].reverse()){
    const symbol=QRCode.create(frame,{errorCorrectionLevel:'M'}),scale=5,padding=4,width=(symbol.modules.size+padding*2)*scale,pixels=new Uint8ClampedArray(width*width*4).fill(255)
    for(let row=0;row<symbol.modules.size;row++)for(let col=0;col<symbol.modules.size;col++)if(symbol.modules.get(row,col))for(let y=0;y<scale;y++)for(let x=0;x<scale;x++){
      const offset=(((row+padding)*scale+y)*width+(col+padding)*scale+x)*4;pixels[offset]=pixels[offset+1]=pixels[offset+2]=0
    }
    const decoded=jsQR(pixels,width,width)
    assert.equal(decoded?.data,frame)
    result=collect(decoded.data);collect(decoded.data)
  }
  assert.deepEqual(result.envelope,envelope)
  await verifyTransfer(result.envelope,{rootKey,scope:qrScope,recipientUserId:'owner'})
})
test('rejects tampering, forged certificates, unsupported version, privileged fields, recipient and scope changes',async()=>{
  const fixture=await qrFixture(),options={rootKey:fixture.rootKey,scope:qrScope,recipientUserId:'owner'}
  for(const change of [value=>value.payload.lines[0].quantity++,value=>value.payload.v=99,value=>value.payload.lines[0].purchasePricePaise=1,value=>value.certificate.claims.role='owner',value=>value.payload.customer.mobile='123',value=>value.payload.recipientUserId='super',value=>value.payload.scope.locationId='loc-b']){
    const copy=structuredClone(fixture.envelope);change(copy);await assert.rejects(verifyTransfer(copy,options))
  }
  const other=await qrFixture();await assert.rejects(verifyTransfer(other.envelope,options),/signature/)
  await assert.rejects(verifyTransfer(fixture.envelope,{...options,recipientUserId:'super'}),/different user/)
  await assert.rejects(verifyTransfer(fixture.envelope,{...options,now:Date.now()+8*86400000}),/expired/)
  await verifyTransfer(fixture.envelope,{...options,now:Date.now()+8*86400000,allowExpired:true})
})
test('50-line requests are framed completely; mixed/conflicting frames, oversize and malformed input fail safely',async()=>{
  const fixture=await qrFixture()
  fixture.payload.lines=Array.from({length:50},(_,i)=>({...fixture.payload.lines[0],lineId:'line-'+i,productId:'product-'+i,productName:'Long product name '.repeat(12)+i}))
  fixture.envelope.signature=await sign(fixture.payload,fixture.devicePair.privateKey)
  const frames=encodeFrames(fixture.envelope),collect=createFrameCollector();let complete
  assert.ok(frames.length>10)
  for(const frame of frames)complete=collect(frame)
  assert.equal(complete.envelope.payload.lines.length,50)
  await verifyTransfer(complete.envelope,{rootKey:fixture.rootKey,scope:qrScope,recipientUserId:'owner'})
  const partial=createFrameCollector();partial(frames[0]);assert.throws(()=>partial(frames[0].slice(0,-1)+'A'),/Conflicting/)
  const other=encodeFrames((await qrFixture()).envelope);assert.throws(()=>partial(other[0]),/Another transfer/)
  assert.throws(()=>createFrameCollector()('not a QR'),/supported/)
  fixture.payload.lines.push(fixture.payload.lines[0]);assert.throws(()=>encodeFrames(fixture.envelope),/1–50/)
})
