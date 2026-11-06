import { rupeesToPaise } from '../lib/billAdjustment.js'

// Presentation only. Captured prices and queued operations are never changed here.
export function posLine(item, catalogue) {
  const product = catalogue.find(row => row.id === item.productId)
  const pack = item.familyPackSnapshot
  const price = item.familyPackId ? pack?.sellingUnitPaise : item.unitType === 'piece'
    ? Math.floor(product?.selling_price_paise / product?.pieces_per_pack) : product?.selling_price_paise
  const override = rupeesToPaise(item.priceInr, true)
  const unitPrice = override ?? price
  const boxQuantity = item.unitType === 'piece' ? 0 : item.quantity
  const looseQuantity = item.unitType === 'piece' ? item.quantity : 0
  const validQuantity = Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 99
  const totalPieces = !item.familyPackId && validQuantity && Number.isSafeInteger(product?.pieces_per_pack) && product.pieces_per_pack > 0
    ? boxQuantity * product.pieces_per_pack + looseQuantity : null
  return { name: pack?.name ?? product?.name ?? item.productId ?? item.familyPackId,
    pack: pack?.variant?.label ?? product?.pack ?? '', product,
    boxQuantity, looseQuantity, totalPieces,
    unitPrice: Number.isSafeInteger(unitPrice) && unitPrice > 0 ? unitPrice : null,
    total: Number.isSafeInteger(unitPrice) && unitPrice > 0 && validQuantity && Number.isSafeInteger(unitPrice * item.quantity) ? unitPrice * item.quantity : null }
}

export function customerErrors(customer = {}) {
  const errors = {}
  const name = String(customer.name ?? '').trim()
  if (name.length < 2 || name.length > 80) errors.name = 'Enter a customer name between 2 and 80 characters.'
  if (!/^\d{10}$/.test(String(customer.mobile ?? '').replace(/\D/g, ''))) errors.mobile = 'Enter a valid 10-digit mobile number.'
  return errors
}

export function posSummary(draft, catalogue, operations) {
  const rows = operations.filter(row => row.draftId === draft.draftId && !['resolved','discarded'].includes(row.state)).sort((a, b) => a.order - b.order)
  const snapshot = draft.serverSnapshot
  const lines = draft.body.items.map(item => posLine(item, draft.sellingCatalogue??catalogue))
  const subtotal = lines.every(line => line.total !== null) ? lines.reduce((sum, line) => sum + line.total, 0) : null
  const baselineRevision = snapshot?.request?.revision ?? -1
  const agreement = rows.filter(row => ['CREATE','AGREEMENT'].includes(row.payload.kind) &&
    (['pending','syncing'].includes(row.state) || row.state === 'synced' && row.acknowledgement.revision > baselineRevision) && row.payload.body.acceptedAmountPaise > 0).at(-1)
  const handedBill=rows.find(row=>row.payload.kind==='HANDOVER'&&row.payload.body.transfer.payload.v===3&&(['pending','syncing'].includes(row.state)||row.state==='synced'&&row.acknowledgement.revision>baselineRevision))
  const amount = agreement?.payload.body.acceptedAmountPaise ?? handedBill?.payload.body.transfer.payload.bill.agreedAmountPaise ?? snapshot?.acceptedAmountPaise ?? null
  const additions = rows.filter(row => row.payload.kind === 'PAYMENT' && (['pending','syncing'].includes(row.state) || row.state === 'synced' && row.acknowledgement.revision > baselineRevision))
  const received = (snapshot?.paymentSummary?.receivedPaise ?? 0) + additions.filter(row => row.payload.body.entryType === 'PAYMENT').reduce((sum, row) => sum + row.payload.body.amountPaise, 0)
  let hold = snapshot?.paymentSummary?.onHold ?? false
  for (const row of additions) {
    if (row.payload.body.entryType === 'HOLD') hold = true
    if (row.payload.body.entryType === 'RELEASE_HOLD') hold = false
  }
  const confirmed = Boolean(snapshot && (!draft.lastAcknowledgement || snapshot.request.revision >= draft.lastAcknowledgement.revision) && rows.every(row => row.state === 'synced'))
  const lastItems = rows.filter(row => (['CREATE','EDIT'].includes(row.payload.kind)||row.payload.kind==='HANDOVER'&&row.payload.body.transfer.payload.v===3) && ['pending','syncing','synced'].includes(row.state)).at(-1)
  const useSnapshot = snapshot && (!lastItems || lastItems.state === 'synced' && lastItems.acknowledgement.revision <= baselineRevision)
  const lastItemBody=lastItems?.payload.kind==='HANDOVER'?lastItems.payload.body.transfer.payload.bill.operations.filter(op=>['CREATE','EDIT'].includes(op.kind)).at(-1).body:lastItems?.payload.body
  const savedItems = useSnapshot ? snapshot.request.items : lastItemBody?.items
  const comparable = item => [item.productId ?? item.familyPackId, item.quantity, item.unitType ?? 'box']
  const itemsSaved = Boolean(savedItems && JSON.stringify(savedItems.map(comparable)) === JSON.stringify(draft.body.items.map(comparable)) &&
    draft.body.items.every((item, i) => {
      const override = rupeesToPaise(item.priceInr, true)
      return useSnapshot ? override === null || override === savedItems[i].unitPricePaise : override === (savedItems[i].unitRatePaise ?? null)
    }) && (rupeesToPaise(draft.discountInr || '0') ?? -1) === (lastItemBody?.discountPaise ?? 0))
  return { rows, lines, subtotal, amount, received, outstanding: amount === null ? null : Math.max(0, amount - received), confirmed: confirmed && itemsSaved,
    paymentStatus: hold ? 'Payment hold' : amount === null ? 'Not finalized' : received >= amount ? 'Paid' : received > 0 ? 'Partially paid' : 'Unpaid',
    pending: rows.filter(row => ['pending','syncing'].includes(row.state)).length,
    failed: rows.some(row => ['failed','conflict'].includes(row.state)), itemsSaved }
}
