import { canonicalJson, digest, offlineRequestId, sign, transferScope, transferCustomer, validatePayload, verifyTransfer, verify } from '../../shared/handoverProtocol.js'
import { familyPackLine, familyPackAvailable, sameFamilyPack } from '../../shared/familyPackSnapshot.js'

export function sellingLines(items, catalogue, draftId) {
  return items.map(item => {
    if(item.familyPackId)return familyPackLine(item,draftId)
    const product = catalogue.find(row => row.id === item.productId)
    if (!product) throw Error('A request product is missing from the prepared selling catalogue.')
    return { lineId:item.lineId ?? `local-${draftId}-${item.productId}-${item.unitType ?? 'box'}`,productId:product.id,productName:product.name,quantity:item.quantity,unitType:item.unitType ?? 'box',
      packSnapshot:{pack:product.pack ?? '',company:product.company ?? '',piecesPerPack:product.pieces_per_pack ?? 1,allowLooseSale:Number(product.allow_loose_sale ?? 0)},
      sellingUnitPaise:item.unitType === 'piece' ? Math.floor(product.selling_price_paise / product.pieces_per_pack) : product.selling_price_paise }
  })
}

export function assertCompleteFamilyDraft(draft) {
  if(draft.serverSnapshot?.request.items.some(item=>item.familyPackId)&&draft.familyPackSnapshotsVersion!==1)throw Error('This saved draft predates complete Family Pack snapshots. Save a fresh revision as a separate draft online; the old request and pending work are preserved.')
}

export async function assertHandoverPreparation(storage, profile) {
  if (profile?.authorityRevoked || !profile?.writable) throw Error('QR authorization is revoked or read-only. Reconnect to verify access; keep saved bills.')
  const prep=profile.handover, claims=prep?.certificate?.claims
  if (!claims) throw Error('QR preparation is missing. Prepare this phone online in the selected business, stall and season.')
  if (!(Date.parse(claims.expiresAt)>Date.now()) || Date.parse(claims.issuedAt)>Date.now()+300000) throw Error('QR preparation has expired or the device clock is incorrect. Prepare this phone online again.')
  if (canonicalJson(claims.scope)!==canonicalJson(transferScope(profile.scope)) || claims.userId!==profile.scope.userId || claims.deviceId!==profile.scope.deviceId || claims.role!==profile.role) throw Error('QR preparation does not match this user, device, role or workspace. Prepare online again.')
  await verify(claims,prep.certificate.signature,prep.rootKey)
  const identity=await storage.signingIdentity(profile.scope)
  if (canonicalJson(identity.publicKey)!==canonicalJson(claims.publicKey)) throw Error('QR preparation belongs to another device signing key. Prepare online again; keep saved bills.')
}

export async function generateHandover({storage,profile,draft,operations,catalogue,recipientUserId}) {
  if (!profile?.handover || !profile.writable || !draft) throw Error('Prepare QR handover online and select a saved request first.')
  // Read the durable authority rather than trusting a stale component profile.
  const current=await storage.get('profiles',profile.scope,'profile')
  await assertHandoverPreparation(storage,current)
  profile=current
  assertCompleteFamilyDraft(draft)
  const durable=await storage.get('drafts',profile.scope,draft.draftId)
  if(!durable || durable.localRevision!==draft.localRevision || canonicalJson(durable.body)!==canonicalJson(draft.body))throw Error('Wait for this exact draft version to be saved before generating QR.')
  if (!profile.handover.recipients.some(user=>user.userId===recipientUserId)) throw Error('Select a prepared authorized recipient.')
  if (draft.handover || draft.serverSnapshot?.request.status==='void') throw Error('A received or void request cannot be handed over again.')
  const finalized=Boolean(draft.localClosure)||draft.serverSnapshot?.request.status==='closed'
  const rows = operations.filter(row=>row.draftId===draft.draftId).sort((a,b)=>a.order-b.order)
  const source = rows.find(row=>row.payload.kind==='CREATE'&&!['resolved','discarded'].includes(row.state))
  const unsettled = rows.filter(row=>!['synced','resolved','discarded'].includes(row.state))
  if(unsettled.some(row=>row.state!=='pending' || !(finalized?['CREATE','EDIT','AGREEMENT','CLOSE']:['CREATE','EDIT']).includes(row.payload.kind)))throw Error('Resolve failed/conflicting work before exporting this source. Nothing was removed.')
  let requestId = draft.requestId, revision = draft.lastAcknowledgement?.revision ?? draft.expectedRevision, sourceOperationId = null
  if (!requestId) {
    if (!source || source.state !== 'pending') throw Error('Queue request creation before generating a QR.')
    sourceOperationId = source.payload.operationId; requestId = await offlineRequestId(profile.scope,sourceOperationId); revision = null
  } else {
    const creator = draft.serverSnapshot?.request.creatorUserId ?? (source ? profile.scope.userId : null)
    if (creator !== profile.scope.userId) throw Error('Only the original creator can hand over a request. Save its latest source snapshot first.')
  }
  const payload = {v:1,transferId:crypto.randomUUID(),scope:transferScope(profile.scope),requestId,revision,sourceOperationId,creatorUserId:profile.scope.userId,
    recipientUserId,occurredAt:new Date().toISOString(),sourceOccurredAt:source?.payload.occurredAt ?? new Date(draft.serverSnapshot?.request.createdAt ?? draft.savedAt).toISOString(),customer:transferCustomer(draft.body.customer),
    lines:sellingLines(draft.body.items,catalogue,draft.draftId)}
  if(payload.lines.some(line=>line.familyPackId)||draft.serverSnapshot?.request.items.some(item=>item.familyPackId)||rows.some(row=>row.payload.lineSnapshots?.some(line=>line.familyPackId)))payload.v=2
  if(finalized){
    const chain=rows.filter(row=>!['resolved','discarded'].includes(row.state)).map(row=>row.payload)
    if(chain.some(op=>op.kind==='PAYMENT')||!source)throw Error('Finalized offline handoff requires the complete original device history and no source payment captures. Keep existing payments and synchronize them first.')
    payload.v=3;payload.revision=null;payload.sourceOperationId=source.payload.operationId
    payload.requestId=await offlineRequestId(profile.scope,payload.sourceOperationId)
    payload.lines=structuredClone(chain.filter(op=>['CREATE','EDIT'].includes(op.kind)).at(-1)?.lineSnapshots)
    payload.bill={agreedAmountPaise:chain.filter(op=>['CREATE','AGREEMENT'].includes(op.kind)&&op.body.acceptedAmountPaise>0).at(-1)?.body.acceptedAmountPaise,operations:chain}
  }
  validatePayload(payload)
  const cacheKey = await digest({...payload,transferId:null,occurredAt:null,certificate:profile.handover.certificate})
  const previous = await storage.transferExport(profile.scope,cacheKey)
  if (previous) { await verifyTransfer(previous,{rootKey:profile.handover.rootKey,grantRootKey:profile.handover.grantRootKey,scope:profile.scope,recipientUserId}); return previous }
  const key = await storage.signingIdentity(profile.scope)
  if (canonicalJson(key.publicKey) !== canonicalJson(profile.handover.certificate.claims.publicKey)) throw Error('The local signing key does not match online preparation.')
  const envelope = {payload,certificate:profile.handover.certificate,signature:await sign(payload,key.privateKey)}
  await verifyTransfer(envelope,{rootKey:profile.handover.rootKey,grantRootKey:profile.handover.grantRootKey,scope:profile.scope,recipientUserId})
  return storage.transferExport(profile.scope,cacheKey,envelope)
}

export function matchTransferCatalogue(payload,catalogue,familyPacks=[]) {
  return payload.lines.map(line=>{
    if(line.familyPackId){
      const product=familyPacks.find(pack=>pack.familyPackId===line.familyPackId)
      const missing=line.packSnapshot.components.filter(component=>!catalogue.some(row=>row.id===component.productId))
      const changed=line.packSnapshot.components.some(component=>{
        const row=catalogue.find(product=>product.id===component.productId)
        if(!row)return true
        const current=sellingLines([{productId:row.id,quantity:1,unitType:'box'}],catalogue,'component')[0]
        return current.productName!==component.productName||current.sellingUnitPaise!==component.sellingUnitPaise||canonicalJson(current.packSnapshot)!==canonicalJson(component.packSnapshot)||Number(row.active)!==component.active||(row.stock_status??'')!==component.stockStatus
      })
      const matches=product&&familyPackAvailable(product)&&sameFamilyPack(line.packSnapshot,product)&&!missing.length&&!changed
      return {line,product,matches:Boolean(matches),reason:missing.length?'Missing component products.':!product?'Family Pack or selected variant is missing.':!matches?'Family Pack catalogue version, composition, units, availability or selling price differs.':null}
    }
    const product = catalogue.find(row=>row.id===line.productId)
    const current = product && sellingLines([{...line}],catalogue,'preview')[0]
    const matches = current && current.productName===line.productName && current.sellingUnitPaise===line.sellingUnitPaise && canonicalJson(current.packSnapshot)===canonicalJson(line.packSnapshot)
    return {line,product,matches:Boolean(matches)}
  })
}
