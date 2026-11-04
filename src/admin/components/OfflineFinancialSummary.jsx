import { offlineFinancialPreview } from '../offline/financialPreview.js'

export default function OfflineFinancialSummary({profile,draft,catalogue}) {
  if(!profile.handover?.privateCatalogue?.length)return <p>Prepare secure QR handover online to cache the authorized purchase/final-price estimate for this Owner / Super Admin profile.</p>
  const result=offlineFinancialPreview(draft,catalogue,profile.handover.privateCatalogue)
  const money=amount=>amount===null?'unavailable':`₹${(amount/100).toFixed(2)}`
  return <aside aria-label="Owner financial estimate">
    <h3>Owner financial estimate</h3>
    <p>Purchase snapshot prepared {profile.handover.preparedAt}. Estimates may be stale; server pricing and ledger remain authoritative.</p>
    <ul>{result.lines.map((line,index)=><li key={`${line.productId}:${index}`}>{line.productId} · selling {money(line.sellingUnit)} · purchase {money(line.purchaseUnit)} · negotiated unit {money(line.negotiatedUnit)}</li>)}</ul>
    <p>Selling subtotal {money(result.selling)} · negotiated preview {money(result.total)} · purchase {money(result.purchase)} · profit {money(result.profit)} · margin {result.margin===null?'unavailable':`${result.margin.toFixed(1)}%`}</p>
    <p>Final Price + ₹500: {money(result.reference)} — reference only during Bargaining / Hold. It never changes bill or payment totals. Queue financial changes explicitly before finalization.</p>
  </aside>
}
