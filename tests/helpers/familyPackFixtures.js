import { familyPackVersion } from '../../src/shared/familyPackSnapshot.js'
import { qrCatalogue } from './handoverFixtures.js'

export async function packFixture({products=qrCatalogue,familyPackId='FP001',name='Family Pack Classic',sellingUnitPaise=50000}={}) {
  const pack={v:1,familyPackId,locationId:'loc-a',variant:{id:familyPackId,slug:'family-classic',label:'Classic'},name,sellingUnitPaise,active:1,archived:0,
    components:products.map((product,index)=>({componentId:String(index+1),productId:product.id,productName:product.name,quantity:index+3,unitLabel:index%2?'packet':'box',sortOrder:index,
      packSnapshot:{pack:product.pack??'',company:product.company??'',piecesPerPack:product.pieces_per_pack??1,allowLooseSale:Number(product.allow_loose_sale??0)},sellingUnitPaise:product.selling_price_paise,active:product.active,stockStatus:product.stock_status??''})),catalogueVersion:''}
  pack.catalogueVersion=await familyPackVersion(pack)
  return pack
}
