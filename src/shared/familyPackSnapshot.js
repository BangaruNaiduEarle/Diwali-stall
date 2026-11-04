import { canonicalJson, digest } from './handoverProtocol.js'

const fail = message => { throw Object.assign(Error(message),{status:400,code:'invalid_family_pack'}) }
const keys = (value,allowed) => {if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!allowed.includes(key)) || allowed.some(key=>!Object.hasOwn(value,key)))fail('Incomplete or unsupported Family Pack snapshot.')}
const id = value => typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(value)
const str = (value,max) => typeof value==='string' && value.length<=max
export function validateFamilyPackSnapshot(pack) {
  keys(pack,['v','familyPackId','locationId','variant','name','sellingUnitPaise','active','archived','components','catalogueVersion'])
  keys(pack.variant,['id','slug','label'])
  if(pack.v!==1 || !/^FP\d{3,}$/.test(pack.familyPackId) || !id(pack.locationId) || pack.variant.id!==pack.familyPackId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pack.variant.slug) || !str(pack.variant.slug,80) || !str(pack.variant.label,40) || !str(pack.name,120) || !pack.name.trim() || !Number.isSafeInteger(pack.sellingUnitPaise) || pack.sellingUnitPaise<=0 || ![0,1].includes(pack.active) || ![0,1].includes(pack.archived) || !/^[a-f0-9]{64}$/.test(pack.catalogueVersion))fail('Invalid Family Pack identity, variant, price or version.')
  if(!Array.isArray(pack.components)||pack.components.length<1||pack.components.length>80)fail('Family Packs require 1–80 explicit components. Empty or nested packs are unsupported.')
  const ids=new Set(),products=new Set()
  for(const component of pack.components){
    keys(component,['componentId','productId','productName','quantity','unitLabel','sortOrder','packSnapshot','sellingUnitPaise','active','stockStatus'])
    keys(component.packSnapshot,['pack','company','piecesPerPack','allowLooseSale'])
    const snapshot=component.packSnapshot
    if(!/^[1-9]\d{0,14}$/.test(component.componentId)||!id(component.productId)||!str(component.productName,300)||!component.productName.trim()||!Number.isInteger(component.quantity)||component.quantity<1||component.quantity>999||!str(component.unitLabel,80)||!Number.isSafeInteger(component.sortOrder)||component.sortOrder<0||!str(snapshot.pack,300)||!str(snapshot.company,300)||!Number.isInteger(snapshot.piecesPerPack)||snapshot.piecesPerPack<1||snapshot.piecesPerPack>100000||![0,1].includes(snapshot.allowLooseSale)||!Number.isSafeInteger(component.sellingUnitPaise)||component.sellingUnitPaise<=0||![0,1].includes(component.active)||!str(component.stockStatus,80))fail('Invalid Family Pack component identity, quantity, units or selling snapshot.')
    if(ids.has(component.componentId)||products.has(component.productId))fail('Duplicate Family Pack component.')
    ids.add(component.componentId);products.add(component.productId)
  }
}
export async function familyPackVersion(pack) {
  const {catalogueVersion:_version,...definition}=pack
  return digest(definition)
}
export async function verifyFamilyPackSnapshot(pack) {
  validateFamilyPackSnapshot(pack)
  if(await familyPackVersion(pack)!==pack.catalogueVersion)fail('Family Pack catalogue version does not match its captured composition.')
}
export function familyPackAvailable(pack) {return pack.active===1&&pack.archived===0&&pack.components.every(component=>component.active===1&&!['soldout','sold-out'].includes(component.stockStatus))}
export function familyPackLine(item,draftId) {
  const pack=item.familyPackSnapshot
  if(!pack)fail('This historical Family Pack has no complete saved composition. Its original version cannot be reconstructed from the current catalogue.')
  validateFamilyPackSnapshot(pack)
  if(pack.familyPackId!==item.familyPackId)fail('Selected Family Pack differs from its saved variant.')
  return {lineId:item.lineId??`local-${draftId}-${item.familyPackId}`,familyPackId:item.familyPackId,productName:pack.name,quantity:item.quantity,unitType:'box',packSnapshot:pack,sellingUnitPaise:pack.sellingUnitPaise}
}
export function transferProductIds(lines) {return [...new Set(lines.flatMap(line=>line.familyPackId?line.packSnapshot.components.map(component=>component.productId):[line.productId]))]}
export function sameFamilyPack(first,second) {return Boolean(first&&second)&&canonicalJson(first)===canonicalJson(second)}
