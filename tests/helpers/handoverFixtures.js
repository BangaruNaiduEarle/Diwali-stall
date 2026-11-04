import { publicJwk, sign, transferScope, offlineRequestId } from '../../src/shared/handoverProtocol.js'

export const qrScope = { businessId:'shop',locationId:'loc-a',seasonId:'season-2026',userId:'owner',deviceId:'owner-device-1' }
export const qrCatalogue = [{id:'P001',name:'Product A',pack:'10 pieces',company:'Maker',category_slug:'cat-a',selling_price_paise:10000,pieces_per_pack:10,allow_loose_sale:1,active:1,stock_status:'available'}]
export async function qrFixture({rootPair,devicePair,recipient='owner',userId='admin',deviceId='admin-device-1',lines}={}) {
  rootPair??=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify'])
  devicePair??=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify'])
  const rootKey=publicJwk(await crypto.subtle.exportKey('jwk',rootPair.publicKey)),publicKey=publicJwk(await crypto.subtle.exportKey('jwk',devicePair.publicKey))
  const claims={v:1,scope:transferScope(qrScope),userId,deviceId,role:'admin',publicKey,issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()}
  const certificate={claims,signature:await sign(claims,rootPair.privateKey)}
  const sourceOperationId=crypto.randomUUID()
  const payload={v:1,transferId:crypto.randomUUID(),scope:transferScope(qrScope),requestId:await offlineRequestId(qrScope,sourceOperationId),revision:null,sourceOperationId,
    creatorUserId:userId,recipientUserId:recipient,occurredAt:new Date().toISOString(),sourceOccurredAt:new Date(Date.now()-1000).toISOString(),customer:{name:'QR Customer',mobile:'9876543210'},
    lines:lines??[{lineId:'line-'+crypto.randomUUID(),productId:'P001',productName:'Product A',quantity:2,unitType:'box',packSnapshot:{pack:'10 pieces',company:'Maker',piecesPerPack:10,allowLooseSale:1},sellingUnitPaise:10000}]}
  return {rootPair,devicePair,rootKey,certificate,payload,envelope:{payload,certificate,signature:await sign(payload,devicePair.privateKey)}}
}
