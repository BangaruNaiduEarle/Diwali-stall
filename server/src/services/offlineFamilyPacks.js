import { familyPackVersion, validateFamilyPackSnapshot, familyPackAvailable, sameFamilyPack } from '../../../src/shared/familyPackSnapshot.js'
import { lineTotalPaise, sumPaise } from './money.js'

const fail = message => {throw Object.assign(Error(message),{status:409,code:'family_pack_catalogue_conflict'})}
export async function offlineFamilyPack(db,locationId,familyPackId) {
  const row=await db.prepare('SELECT id,slug,name,pack_label,selling_price_paise,active,archived FROM family_packs WHERE id=? AND location_id=?').bind(familyPackId,locationId).first()
  if(!row)fail('Family Pack is missing from this stall catalogue.')
  // LEFT JOIN retains missing/foreign references so no component is silently omitted.
  const result=await db.prepare(`SELECT fpi.id,fpi.product_id,fpi.quantity,fpi.unit_label,fpi.sort_order,p.name,p.pack,p.company,p.pieces_per_pack,p.allow_loose_sale,p.selling_price_paise,p.active,p.stock_status,
    CASE WHEN p.location_id=? AND EXISTS(SELECT 1 FROM categories c WHERE c.slug=p.category_slug AND c.location_id=p.location_id) THEN 1 ELSE 0 END owned
    FROM family_pack_items fpi LEFT JOIN products p ON p.id=fpi.product_id WHERE fpi.family_pack_id=? ORDER BY fpi.sort_order,fpi.id LIMIT 81`).bind(locationId,familyPackId).all()
  if(result.results.some(component=>component.owned!==1))fail('Family Pack contains a missing or foreign component product.')
  const snapshot={v:1,familyPackId:row.id,locationId,variant:{id:row.id,slug:row.slug,label:row.pack_label??''},name:row.name,sellingUnitPaise:row.selling_price_paise,active:row.active,archived:row.archived,
    components:result.results.map(component=>({componentId:String(component.id),productId:component.product_id,productName:component.name,quantity:component.quantity,unitLabel:component.unit_label,sortOrder:component.sort_order,
      packSnapshot:{pack:component.pack??'',company:component.company??'',piecesPerPack:component.pieces_per_pack??1,allowLooseSale:Number(component.allow_loose_sale??0)},sellingUnitPaise:component.selling_price_paise,active:component.active,stockStatus:component.stock_status??''})),catalogueVersion:''}
  snapshot.catalogueVersion=await familyPackVersion(snapshot)
  try{validateFamilyPackSnapshot(snapshot)}catch{fail('Family Pack has incomplete, unsupported or oversized component definitions.')}
  if(!familyPackAvailable(snapshot))fail('Family Pack or one of its components is inactive, archived or sold out.')
  return snapshot
}
export async function offlineFamilyPackCatalogue(db,locationId) {
  const rows=await db.prepare('SELECT id FROM family_packs WHERE location_id=? AND active=1 AND archived=0 ORDER BY id LIMIT 501').bind(locationId).all()
  if(rows.results.length>500)fail('Family Pack catalogue exceeds the offline limit of 500 packs.')
  const familyPacks=[],familyPackIssues=[]
  for(const row of rows.results){try{familyPacks.push(await offlineFamilyPack(db,locationId,row.id))}catch(error){if(error.code!=='family_pack_catalogue_conflict')throw error;familyPackIssues.push({familyPackId:row.id,message:error.message})}}
  return {familyPacks,familyPackIssues}
}
export async function validateOfflineFamilyPacks(db,scope,lines,requestId) {
  const packs=[]
  for(const line of lines.filter(line=>line.familyPackId)){
    const pack=line.packSnapshot,current=await offlineFamilyPack(db,scope.locationId,line.familyPackId)
    if(!sameFamilyPack(pack,current))fail('Family Pack catalogue version, composition, units or price changed. The original snapshot is preserved; review the conflict explicitly.')
    if(requestId){
      const prior=await db.prepare('SELECT line_id,pack_snapshot FROM customer_request_items WHERE request_id=? AND family_pack_id=?').bind(requestId,line.familyPackId).first()
      if(prior&&(prior.line_id!==line.lineId||prior.pack_snapshot!==JSON.stringify(pack))) {
        let saved;try{saved=JSON.parse(prior.pack_snapshot)}catch{fail('Historical Family Pack composition is not available.')}
        if(prior.line_id!==line.lineId||!sameFamilyPack(saved,pack))fail('The original Family Pack line snapshot cannot be replaced with a newer catalogue definition.')
      }
    }
    packs.push(pack)
  }
  return packs
}
export function familyPackGuards(db,scope,pack,requestId) {
  const guard=(predicate,binds)=>db.prepare(`UPDATE customer_requests SET status=CASE WHEN ${predicate} THEN status ELSE NULL END WHERE id=? AND location_id=? AND season_id=?`).bind(...binds,requestId,scope.locationId,scope.seasonId)
  const statements=[guard(`EXISTS(SELECT 1 FROM family_packs WHERE id=? AND location_id=? AND slug IS ? AND name IS ? AND COALESCE(pack_label,'') IS ? AND selling_price_paise IS ? AND active=1 AND archived=0)
    AND (SELECT count(*) FROM family_pack_items WHERE family_pack_id=?)=?`,[pack.familyPackId,scope.locationId,pack.variant.slug,pack.name,pack.variant.label,pack.sellingUnitPaise,pack.familyPackId,pack.components.length])]
  for(let start=0;start<pack.components.length;start+=8){
    const chunk=pack.components.slice(start,start+8)
    statements.push(guard(chunk.map(()=>`EXISTS(SELECT 1 FROM family_pack_items WHERE id=? AND family_pack_id=? AND product_id=? AND quantity IS ? AND unit_label IS ? AND sort_order IS ?)`).join(' AND '),chunk.flatMap(component=>[Number(component.componentId),pack.familyPackId,component.productId,component.quantity,component.unitLabel,component.sortOrder])))
  }
  return statements
}
export function appendOfflineFamilyPackPricing(resolved,items,packs) {
  if(!resolved.ok)return resolved
  const lines=items.map(item=>{
    if(!item.familyPackId)return resolved.lines.find(line=>line.productId===item.productId&&line.unitType===(item.unitType??'box'))
    const pack=packs.find(pack=>pack.familyPackId===item.familyPackId)
    if(!pack)fail('A verified Family Pack snapshot is required for offline checkout.')
    return {productId:null,familyPackId:pack.familyPackId,productName:pack.name,quantity:item.quantity,unitType:'box',unitPricePaise:pack.sellingUnitPaise,finalUnitPaise:pack.sellingUnitPaise}
  })
  const subtotal=sumPaise(lines.filter(line=>line.familyPackId).map(line=>lineTotalPaise(line.quantity,line.unitPricePaise)))
  return {...resolved,lines,audit:{...resolved.audit,sellingSubtotalPaise:sumPaise([resolved.audit.sellingSubtotalPaise,subtotal]),finalSubtotalPaise:sumPaise([resolved.audit.finalSubtotalPaise,subtotal]),bargainFloorPaise:sumPaise([resolved.audit.bargainFloorPaise,subtotal])}}
}
