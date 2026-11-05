// Informational signed snapshot only. Never used for payable or payment totals.
export function finalPricePreview(items,products,prices){
  const lines=items.map(item=>{
    const product=products.find(row=>row.id===item.productId)
    const price=prices.find(row=>row.productId===item.productId)?.finalPricePaise
    let unit=Number.isSafeInteger(price)&&price>=0?price:null
    if(item.familyPackId)unit=null
    else if(item.unitType==='piece')unit=unit!==null&&Number.isInteger(product?.pieces_per_pack)&&product.pieces_per_pack>0?Math.floor(unit/product.pieces_per_pack):null
    const total=unit!==null&&Number.isSafeInteger(item.quantity)&&item.quantity>0&&Number.isSafeInteger(unit*item.quantity)?unit*item.quantity:null
    return {name:product?.name??item.familyPackSnapshot?.name??item.familyPackId??item.productId,unit,total,quantity:item.quantity,unitType:item.unitType??'box'}
  })
  const sum=lines.reduce((value,row)=>value+(row.total??0),0)
  return {lines,total:lines.length&&lines.every(row=>row.total!==null)&&Number.isSafeInteger(sum)?sum:null}
}
