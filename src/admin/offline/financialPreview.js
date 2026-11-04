import { rupeesToPaise } from '../lib/billAdjustment.js'

// Read-only estimates from the receiving owner's scoped preparation. Never sent in QR.
export function offlineFinancialPreview(draft,catalogue,privateCatalogue) {
  let selling=0,negotiated=0,purchase=0,final=0,purchaseComplete=true,finalComplete=true
  const lines=draft.body.items.map(item=>{
    if(item.familyPackId){const amount=item.familyPackSnapshot?.sellingUnitPaise??null;selling+=(amount??0)*item.quantity;negotiated+=(amount??0)*item.quantity;purchaseComplete=false;finalComplete=false;return {productId:item.familyPackId,sellingUnit:amount,purchaseUnit:null,negotiatedUnit:amount}}
    const product=catalogue.find(row=>row.id===item.productId),privateProduct=privateCatalogue.find(row=>row.id===item.productId)
    const unit=amount=>Number.isSafeInteger(amount)&&amount>=0 ? item.unitType==='piece' ? Number.isInteger(product?.pieces_per_pack)&&product.pieces_per_pack>0?Math.floor(amount/product.pieces_per_pack):null : amount : null
    const sellingUnit=unit(product?.selling_price_paise),purchaseUnit=unit(privateProduct?.purchase_unit_paise),finalUnit=unit(privateProduct?.final_price_paise)
    const override=String(item.priceInr??'').trim()?rupeesToPaise(item.priceInr,true):null
    selling+=(sellingUnit??0)*item.quantity; negotiated+=(override??sellingUnit??0)*item.quantity
    if(purchaseUnit===null)purchaseComplete=false;else purchase+=purchaseUnit*item.quantity
    if(finalUnit===null)finalComplete=false;else final+=finalUnit*item.quantity
    return {productId:item.productId,sellingUnit,purchaseUnit,negotiatedUnit:override??sellingUnit}
  })
  const discount=rupeesToPaise(draft.discountInr||'0')??0,agreed=rupeesToPaise(draft.agreedInr||'',true)
  const total=agreed??Math.max(0,negotiated-discount)
  const safe=value=>Number.isSafeInteger(value)?value:null
  const profit=purchaseComplete&&safe(total)!==null&&safe(purchase)!==null?safe(total-purchase):null
  return {lines,selling:safe(selling),total:safe(total),purchase:purchaseComplete?safe(purchase):null,profit,
    margin:profit!==null&&total>0?100*profit/total:null,reference:finalComplete?safe(final+50000):null}
}
