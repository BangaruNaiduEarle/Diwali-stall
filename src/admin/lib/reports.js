import { canViewSensitiveProductPricing } from './adminRoles.js'
import { formatPaymentPaise } from './payments.js'

// Labels and projections only. All monetary calculations belong to the API.
const field = (key,label,type='text',privateValue=false) => ({key,label,type,privateValue})
const amount = field('amountDuePaise','Finalized sales','money')
const count = field('billCount','Bills','number')
const identity = [field('billReference','Bill reference'),field('requestId','Request ID')]
const totals = [count,amount,field('unavailableAmountBillCount','Bills with unavailable amount','number'),field('knownAmountDuePaise','Known sales subset','money')]
const coverage = field('unknownFinalizationDateBillCountInScope','Bills with unknown finalization date in this stall/season','number')
export const REPORTS = {
  'sales-by-date': {label:'Date-wise Sales Summary',summary:[...totals,coverage],columns:[field('businessDate','Business date'),...totals]},
  bills: {label:'Bill-wise Report',summary:[...totals,coverage],columns:[...identity,field('businessDate','Business date'),field('customerName','Customer'),amount,
    field('receivedPaise','Received to date','money'),field('outstandingPaise','Outstanding now','money'),field('paymentStatus','Payment status'),
    field('recordedQuotationTotalPaise','Saved quotation total','money',true),field('recordedAdjustmentPaise','Saved quotation adjustment','money',true),
    field('creatorUserId','Creator'),field('handoverRecipientUserId','Recorded handover recipient'),field('finalizerEmail','Finalizer')]},
  collections: {label:'Payment Collection Report',summary:[field('paymentCount','Payments','number'),field('collectedPaise','Collected','money'),field('unknownTimestampPaymentCountInScope','Payments with unknown selected timestamp in this stall/season','number')],
    columns:[field('businessDate','Business date'),field('paymentMethod','Payment method'),field('recordingMode','Recording mode'),field('paymentCount','Payments','number'),field('collectedPaise','Collected','money')]},
  products: {label:'Product-wise Sales Report',summary:[count,field('lineCount','Saved lines','number'),field('recordedLineSalesPaise','Saved line gross (before bill agreement)','money',true),field('unavailableBillLineBasisCount','Bills without reliable saved line basis','number'),coverage],
    columns:[field('recordedName','Recorded product / pack name'),field('productId','Product ID'),field('familyPackId','Family Pack ID'),field('lineType','Line type'),field('unitType','Unit'),field('quantity','Quantity','number'),count,field('lineCount','Saved lines','number'),field('recordedLineSalesPaise','Saved line gross (before bill agreement)','money',true)]},
  seasons: {label:'Season-wise Sales Report',summary:[...totals,coverage],columns:[field('seasonLabel','Season'),field('seasonId','Season ID'),...totals]},
  profit: {label:'Historical Profit Report',summary:[...totals,field('purchaseCostPaise','Complete purchase cost','money',true),field('profitPaise','Complete historical profit','money',true),
    field('completeCostBillCount','Bills with complete frozen costs','number'),field('unavailableCostBillCount','Bills with unavailable costs','number'),field('knownPurchaseCostPaise','Purchase cost — complete-cost bills only','money',true),field('knownProfitPaise','Profit — complete-cost bills only','money',true),coverage],
    columns:[...identity,field('businessDate','Business date'),amount,field('purchaseCostPaise','Frozen purchase cost','money',true),field('profitPaise','Historical profit','money',true),field('costAvailable','Cost snapshot complete','boolean')]},
}
export const allowedReports = role => Object.keys(REPORTS).filter(type => canViewSensitiveProductPricing(role) || ['bills','products'].includes(type))
export const reportFields = (type,section,role) => (REPORTS[type]?.[section] ?? []).filter(column => !column.privateValue || canViewSensitiveProductPricing(role))
export function reportValue(value,type='text') {
  if (value == null || value === '') return 'Unavailable'
  if (type === 'money') return Number.isSafeInteger(value) ? (value<0?'−'+formatPaymentPaise(-value):formatPaymentPaise(value)) : 'Unavailable'
  if (type === 'boolean') return value === true ? 'Yes' : value === false ? 'No — unavailable' : 'Unavailable'
  return String(value)
}
export function reportQuery(filters,page=1) {
  const params=new URLSearchParams()
  for(const [key,value] of Object.entries(filters))if(value !== '')params.set(key,String(value))
  params.set('page',String(page))
  return params.toString()
}
