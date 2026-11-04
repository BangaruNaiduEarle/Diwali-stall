import { validateFamilyPackSnapshot } from '../../shared/familyPackSnapshot.js'

export default function FamilyPackSnapshotPreview({pack,quantity=1}) {
  try{validateFamilyPackSnapshot(pack)}catch{return <p role="alert">The original Family Pack has no complete supported snapshot. Its composition will not be reconstructed or replaced from today's catalogue.</p>}
  return <div aria-label="Complete Family Pack snapshot">
    <p>{pack.name} · {pack.familyPackId} · selected variant {pack.variant.id} / {pack.variant.slug} · {pack.variant.label} · {quantity} whole packs at ₹{(pack.sellingUnitPaise/100).toFixed(2)} each</p>
    <p style={{overflowWrap:'anywhere'}}>Captured catalogue version: {pack.catalogueVersion}</p>
    <ol>{pack.components.map(component=><li key={component.componentId}>
      {component.productName} ({component.productId}) · component {component.componentId} · {component.quantity} per pack / {component.quantity*quantity} total · unit label: {component.unitLabel||'unspecified'} · product pack: {component.packSnapshot.pack} · {component.packSnapshot.company} · {component.packSnapshot.piecesPerPack} pieces / product pack · catalogue selling ₹{(component.sellingUnitPaise/100).toFixed(2)} · loose sale {component.packSnapshot.allowLooseSale?'allowed':'disabled'} · {component.active?'active':'inactive'} / {component.stockStatus||'stock status unspecified'}
    </li>)}</ol>
  </div>
}
