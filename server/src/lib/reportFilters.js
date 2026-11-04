export const REPORT_TYPES = ['sales-by-date','bills','collections','products','seasons','profit']
export const REPORT_TIME_ZONE = 'Asia/Kolkata'
const fail = message => { throw Object.assign(Error(message),{status:400,code:'validation_error'}) }
function boundary(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0,4)) < 1970) fail('Use a valid business date in YYYY-MM-DD format (1970 or later).')
  const date = new Date(value+'T00:00:00Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) fail('Invalid calendar date.')
  return new Date(date.getTime()-330*60*1000).toISOString()
}
export function parseReportFilters(type, params) {
  const allowed = new Set(['from','toExclusive','dateBasis','page','limit','requestId',
    ...(type === 'collections' ? ['paymentMethod','recordingMode'] : []),
    ...(type === 'products' ? ['productId','familyPackId','unitType'] : [])])
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) fail('Unsupported or repeated report filter.')
  const number = (name,fallback,max) => {
    if (!params.has(name)) return fallback
    const value=params.get(name)
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value)>max) fail('Invalid report '+name+'.')
    return Number(value)
  }
  const page=number('page',1,10000),limit=number('limit',25,100)
  const from=params.has('from')?boundary(params.get('from')):null,toExclusive=params.has('toExclusive')?boundary(params.get('toExclusive')):null
  if (from && toExclusive && from >= toExclusive) fail('from must precede toExclusive.')
  const dateBasis=params.get('dateBasis') ?? (type === 'collections'?'received':'finalized')
  if (!(type === 'collections'?['received','occurred']:['finalized']).includes(dateBasis)) fail('Invalid date basis for this report.')
  const result={page,limit,offset:(page-1)*limit,from,toExclusive,dateBasis}
  for (const key of ['requestId','productId','familyPackId','unitType','paymentMethod','recordingMode']) if (params.has(key)) {
    const value=params.get(key)
    if (!value || value.length>128 || /\s/.test(value) || [...value].some(character=>character.charCodeAt(0)<32)) fail('Invalid '+key+'.')
    result[key]=value
  }
  if (result.paymentMethod && !['CASH','UPI','CARD','BANK','OTHER'].includes(result.paymentMethod)) fail('Invalid payment method.')
  if (result.recordingMode && !['ONLINE','OFFLINE'].includes(result.recordingMode)) fail('Invalid recording mode.')
  if (result.unitType && !['box','piece','unknown'].includes(result.unitType)) fail('Invalid unit type.')
  if (result.productId && result.familyPackId) fail('Choose productId or familyPackId.')
  return result
}
