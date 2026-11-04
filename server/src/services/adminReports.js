import { adminOperationScope } from '../lib/adminOperationScope.js'
import { canViewSensitiveProductPricing } from '../lib/adminRoles.js'
import { REPORT_TIME_ZONE, REPORT_TYPES, parseReportFilters } from '../lib/reportFilters.js'

const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code})}
const ROLE="CASE WHEN sm.role = 'admin' OR lm.role = 'admin' THEN 'admin' WHEN sm.role = 'super_admin' OR lm.role = 'super_admin' THEN 'super_admin' ELSE 'owner' END"
// Every data statement has its own live authorization CTE. A captured role or
// a preliminary role check cannot expose costs after a concurrent demotion.
const authorization=privileged=>`SELECT b.id business_id,l.id location_id,s.id season_id,s.code season_code,s.label season_label,${ROLE} effective_role
  FROM admin_users u JOIN season_members sm ON sm.admin_user_id=u.id
  JOIN business_seasons s ON s.id=sm.season_id
  JOIN location_members lm ON lm.admin_user_id=u.id AND lm.season_id=s.id
  JOIN business_locations l ON l.id=lm.location_id JOIN businesses b ON b.id=l.business_id
  JOIN location_seasons ls ON ls.location_id=l.id AND ls.season_id=s.id
  WHERE b.id=? AND l.id=? AND s.id=? AND u.id=?
    AND (u.disabled_at IS NULL OR u.disabled_at='') AND (sm.disabled_at IS NULL OR sm.disabled_at='') AND (lm.disabled_at IS NULL OR lm.disabled_at='')
    AND sm.role IN ('admin','super_admin','owner') AND lm.role IN ('admin','super_admin','owner')
    AND b.status IN ('active','archived') AND l.status IN ('active','archived') AND s.status IN ('active','archived') AND ls.status IN ('active','archived')
    ${privileged?"AND sm.role IN ('owner','super_admin') AND lm.role IN ('owner','super_admin')":''}`

const billBase=canFinancial=>`SELECT r.id request_id,r.public_reference,r.customer_name,r.creator_user_id,r.assigned_to_user_id,r.closed_by_email,
  auth.business_id,auth.location_id,auth.season_id,auth.season_code,auth.season_label,
  CASE WHEN julianday(r.closed_at) IS NOT NULL THEN strftime('%Y-%m-%dT%H:%M:%fZ',r.closed_at)
    ELSE (SELECT strftime('%Y-%m-%dT%H:%M:%fZ',e.received_at) FROM request_workflow_events e
      WHERE e.request_id=r.id AND e.business_id=auth.business_id AND e.location_id=auth.location_id AND e.season_id=auth.season_id
        AND e.event_type='request_closed' ORDER BY e.revision DESC LIMIT 1) END finalized_at,
  q.id quotation_id,a.amount_due_paise,
  CASE WHEN ${canFinancial?'1':'0'} AND auth.effective_role IN ('owner','super_admin') THEN q.total_paise END quotation_total_paise,
  CASE WHEN ${canFinancial?'1':'0'} AND auth.effective_role IN ('owner','super_admin') THEN q.adjustment_paise END adjustment_paise,
  CASE WHEN ${canFinancial?'1':'0'} AND auth.effective_role IN ('owner','super_admin') THEN 1 ELSE 0 END financial_visible,
  ps.received_paise,ps.outstanding_paise,CASE WHEN a.request_id IS NOT NULL THEN ps.payment_status END payment_status
  FROM authorized auth JOIN customer_requests r ON r.location_id=auth.location_id AND r.season_id=auth.season_id
  LEFT JOIN request_payment_accounts a ON a.request_id=r.id AND a.business_id=auth.business_id AND a.location_id=auth.location_id AND a.season_id=auth.season_id
  LEFT JOIN quotations q ON q.id=a.quotation_id AND q.customer_request_id=r.id AND q.location_id=auth.location_id AND q.season_id=auth.season_id
  LEFT JOIN request_payment_summaries ps ON ps.request_id=r.id AND ps.business_id=auth.business_id AND ps.location_id=auth.location_id AND ps.season_id=auth.season_id
  WHERE r.status='closed' AND r.finalization_status='finalized'`
const BILL_AGG=`COUNT(*) billCount,COUNT(*)-COUNT(amount_due_paise) unavailableAmountBillCount,
  COALESCE(SUM(amount_due_paise),0) knownAmountDuePaise,
  CASE WHEN COUNT(*)=COUNT(amount_due_paise) THEN COALESCE(SUM(amount_due_paise),0) END amountDuePaise`

function dateWhere(column,filters,values) {
  const conditions=[]
  if(filters.from){conditions.push(`julianday(${column})>=julianday(?)`);values.push(filters.from)}
  if(filters.toExclusive){conditions.push(`julianday(${column})<julianday(?)`);values.push(filters.toExclusive)}
  return conditions.length?' WHERE '+conditions.join(' AND '):''
}
function safeNumbers(value) {
  if(Array.isArray(value)){value.forEach(safeNumbers);return}
  if(value&&typeof value==='object'){Object.values(value).forEach(safeNumbers);return}
  if(typeof value==='number'&&!Number.isSafeInteger(value))fail(503,'report_total_out_of_range','A report value exceeds exact integer limits.')
}
function queryPlan(type,filters,auth,canFinancial) {
  const values=[],billWhere=dateWhere('finalized_at',filters,values)
  let sql=`WITH authorized AS (${auth}), bill_base AS (${billBase(canFinancial)}), billed AS (
    SELECT *,date(finalized_at,'+330 minutes') business_date FROM bill_base${billWhere})`
  if(filters.requestId){sql+=`, selected_bills AS (SELECT * FROM billed WHERE request_id=?)`;values.push(filters.requestId)}
  else sql+=', selected_bills AS (SELECT * FROM billed)'
  const billCoverage=`(SELECT COUNT(*) FROM bill_base WHERE finalized_at IS NULL) unknownFinalizationDateBillCountInScope`
  let rows,summary,order
  if(type==='bills'){
    rows=`SELECT request_id requestId,public_reference billReference,customer_name customerName,creator_user_id creatorUserId,
      assigned_to_user_id handoverRecipientUserId,closed_by_email finalizerEmail,finalized_at finalizedAt,business_date businessDate,
      quotation_id quotationId,amount_due_paise amountDuePaise,quotation_total_paise recordedQuotationTotalPaise,adjustment_paise recordedAdjustmentPaise,
      received_paise receivedPaise,outstanding_paise outstandingPaise,payment_status paymentStatus FROM selected_bills`
    summary=`SELECT ${BILL_AGG},${billCoverage} FROM selected_bills`
    order='finalizedAt IS NULL,finalizedAt,requestId'
  }else if(type==='sales-by-date'){
    rows=`SELECT business_date businessDate,${BILL_AGG} FROM selected_bills GROUP BY business_date`
    summary=`SELECT ${BILL_AGG},${billCoverage} FROM selected_bills`;order='businessDate IS NULL,businessDate'
  }else if(type==='seasons'){
    rows=`SELECT auth.season_id seasonId,auth.season_code seasonCode,auth.season_label seasonLabel,
      COUNT(b.request_id) billCount,COUNT(b.request_id)-COUNT(b.amount_due_paise) unavailableAmountBillCount,
      COALESCE(SUM(b.amount_due_paise),0) knownAmountDuePaise,
      CASE WHEN COUNT(b.request_id)=COUNT(b.amount_due_paise) THEN COALESCE(SUM(b.amount_due_paise),0) END amountDuePaise
      FROM authorized auth LEFT JOIN selected_bills b ON b.season_id=auth.season_id GROUP BY auth.season_id,auth.season_code,auth.season_label`
    summary=`SELECT ${BILL_AGG},${billCoverage} FROM selected_bills`;order='seasonId'
  }else if(type==='collections'){
    const paymentValues=[],paymentWhere=dateWhere(filters.dateBasis==='occurred'?'occurred_at':'received_at',filters,paymentValues)
    // Collections dates filter the receipt, never the bill's finalization date.
    values.length=0
    sql=`WITH authorized AS (${auth}), scoped_payments AS (
      SELECT p.* FROM authorized auth JOIN request_payment_ledger p ON p.business_id=auth.business_id AND p.location_id=auth.location_id AND p.season_id=auth.season_id
      JOIN request_payment_accounts a ON a.request_id=p.request_id AND a.business_id=p.business_id AND a.location_id=p.location_id AND a.season_id=p.season_id
      WHERE p.entry_type='PAYMENT'), filtered_payments AS (SELECT * FROM scoped_payments${paymentWhere}`
    values.push(...paymentValues)
    const additional=[]
    for(const [key,column]of [['requestId','request_id'],['paymentMethod','payment_method'],['recordingMode','recording_mode']])if(filters[key]){additional.push(column+'=?');values.push(filters[key])}
    if(additional.length)sql+=(paymentWhere?' AND ':' WHERE ')+additional.join(' AND ')
    sql+=')'
    const dateColumn=filters.dateBasis==='occurred'?'occurred_at':'received_at'
    rows=`SELECT date(${dateColumn},'+330 minutes') businessDate,payment_method paymentMethod,recording_mode recordingMode,
      COUNT(*) paymentCount,SUM(amount_paise) collectedPaise FROM filtered_payments GROUP BY businessDate,payment_method,recording_mode`
    summary=`SELECT COUNT(*) paymentCount,COALESCE(SUM(amount_paise),0) collectedPaise,
      (SELECT COUNT(*) FROM scoped_payments WHERE julianday(${dateColumn}) IS NULL) unknownTimestampPaymentCountInScope FROM filtered_payments`
    order='businessDate IS NULL,businessDate,paymentMethod,recordingMode'
  }else if(type==='products'){
    sql+=`, sale_lines AS (SELECT b.request_id,i.product_id,
      CASE WHEN i.product_id IS NULL AND json_valid(i.pack_snapshot) THEN json_extract(i.pack_snapshot,'$.familyPackId') END family_pack_id,
      i.product_name,COALESCE(i.unit_type,'unknown') unit_type,i.quantity,
      CASE WHEN b.financial_visible=1 THEN i.line_total_paise END line_total_paise
      FROM selected_bills b JOIN quotation_items i ON i.quotation_id=b.quotation_id), filtered_lines AS (SELECT * FROM sale_lines`
    const conditions=[]
    for(const [key,column]of [['productId','product_id'],['familyPackId','family_pack_id'],['unitType','unit_type']])if(filters[key]){conditions.push(column+'=?');values.push(filters[key])}
    if(conditions.length)sql+=' WHERE '+conditions.join(' AND ')
    sql+=')'
    rows=`SELECT product_id productId,family_pack_id familyPackId,product_name recordedName,unit_type unitType,
      CASE WHEN product_id IS NOT NULL THEN 'product' WHEN family_pack_id IS NOT NULL THEN 'family_pack' ELSE 'unknown' END lineType,
      COUNT(DISTINCT request_id) billCount,COUNT(*) lineCount,SUM(quantity) quantity,SUM(line_total_paise) recordedLineSalesPaise,
      NULL allocatedFinalRevenuePaise FROM filtered_lines GROUP BY product_id,family_pack_id,product_name,unit_type`
    summary=`SELECT COUNT(*) lineCount,COUNT(DISTINCT request_id) billCount,COALESCE(SUM(line_total_paise),0) recordedLineSalesPaise,
      (SELECT COUNT(*) FROM selected_bills WHERE quotation_id IS NULL) unavailableBillLineBasisCount,${billCoverage} FROM filtered_lines`
    order='lineType,productId,familyPackId,recordedName,unitType'
  }else if(type==='profit'){
    sql+=`, cost_totals AS (
      SELECT c.request_id,COUNT(*) snapshot_count,MIN(c.bill_line_count) min_expected,MAX(c.bill_line_count) max_expected,
        SUM(c.purchase_line_paise) cost_paise,
        SUM(CASE WHEN c.unavailable_reason IS NULL AND i.product_id IS NOT NULL
          AND typeof(c.purchase_unit_paise)='integer' AND c.purchase_unit_paise>=0
          AND typeof(c.purchase_line_paise)='integer' AND c.purchase_line_paise=c.purchase_unit_paise*c.quantity THEN 0 ELSE 1 END) invalid_count
      FROM authorized auth JOIN bill_item_purchase_costs c ON c.business_id=auth.business_id AND c.location_id=auth.location_id AND c.season_id=auth.season_id
      JOIN selected_bills b ON b.request_id=c.request_id AND b.quotation_id=c.quotation_id
      JOIN quotation_items i ON i.id=c.quotation_item_id AND i.quotation_id=c.quotation_id AND i.product_id IS c.product_id
        AND i.quantity=c.quantity AND i.unit_type IS c.unit_type AND i.request_line_id IS c.request_line_id GROUP BY c.request_id),
      valued AS (SELECT b.*,CASE WHEN b.amount_due_paise IS NOT NULL AND c.invalid_count=0 AND c.snapshot_count>0
        AND c.snapshot_count=c.min_expected AND c.snapshot_count=c.max_expected
        AND c.snapshot_count=(SELECT COUNT(*) FROM quotation_items i WHERE i.quotation_id=b.quotation_id)
        THEN c.cost_paise END cost_paise FROM selected_bills b LEFT JOIN cost_totals c ON c.request_id=b.request_id)
    `
    rows=`SELECT request_id requestId,public_reference billReference,finalized_at finalizedAt,business_date businessDate,
      amount_due_paise amountDuePaise,cost_paise purchaseCostPaise,amount_due_paise-cost_paise profitPaise,
      CASE WHEN cost_paise IS NOT NULL THEN 1 ELSE 0 END costAvailable,
      CASE WHEN cost_paise IS NULL THEN 'historical_cost_unavailable_or_incomplete' END unavailableReason FROM valued`
    summary=`SELECT ${BILL_AGG},COUNT(cost_paise) completeCostBillCount,COUNT(*)-COUNT(cost_paise) unavailableCostBillCount,
      COALESCE(SUM(cost_paise),0) knownPurchaseCostPaise,COALESCE(SUM(CASE WHEN cost_paise IS NOT NULL THEN amount_due_paise-cost_paise END),0) knownProfitPaise,
      CASE WHEN COUNT(*)=COUNT(cost_paise) THEN COALESCE(SUM(cost_paise),0) END purchaseCostPaise,
      CASE WHEN COUNT(*)=COUNT(cost_paise) THEN COALESCE(SUM(amount_due_paise-cost_paise),0) END profitPaise,${billCoverage} FROM valued`
    order='finalizedAt IS NULL,finalizedAt,requestId'
  }
  return {sql,values,rows,summary,order}
}

export async function getStandaloneReport(db,type,params,options) {
  const scope=adminOperationScope(db,options.seasonId,options.context)
  if(!scope.locationId)fail(503,'location_required','Reports require an authorized stall and season workspace.')
  if(type&&!REPORT_TYPES.includes(type))fail(404,'not_found','Report not found.')
  // Aggregate financial reporting is not an existing Admin permission.
  const privileged=['sales-by-date','collections','seasons','profit'].includes(type)
  if(privileged&&!canViewSensitiveProductPricing(scope.effectiveRole))fail(403,'forbidden','Financial aggregate and profit reports require Owner or Super Admin authority.')
  const auth=authorization(privileged),bindings=[scope.businessId,scope.locationId,scope.seasonId,scope.userId]
  if(!type){
    if([...params].length)fail(400,'validation_error','Select a report before applying filters.')
    const live=await db.prepare(auth).bind(...bindings).first()
    if(!live)fail(403,'forbidden','Current stall and season membership is required.')
    return {ok:true,scope:{businessId:scope.businessId,locationId:scope.locationId,seasonId:scope.seasonId},timeZone:REPORT_TIME_ZONE,
      reports:REPORT_TYPES.filter(name=>['bills','products'].includes(name)||canViewSensitiveProductPricing(live.effective_role)&&canViewSensitiveProductPricing(scope.effectiveRole))}
  }
  const canFinancial=canViewSensitiveProductPricing(scope.effectiveRole)
  const filters=parseReportFilters(type,params),plan=queryPlan(type,filters,auth,canFinancial)
  const common=[...bindings,...plan.values]
  const statements=[db.prepare(auth).bind(...bindings),
    db.prepare(plan.sql+' '+plan.summary).bind(...common),
    db.prepare(plan.sql+` SELECT COUNT(*) total FROM (${plan.rows})`).bind(...common),
    db.prepare(plan.sql+' '+plan.rows+' ORDER BY '+plan.order+' LIMIT ? OFFSET ?').bind(...common,filters.limit,filters.offset)]
  // A filter ID never bypasses the scope. Missing/ineligible/foreign bill IDs
  // have the same 404, avoiding a cross-stall existence oracle.
  if(filters.requestId)statements.push(db.prepare(`WITH authorized AS (${auth}) SELECT r.id FROM authorized a JOIN customer_requests r
    ON r.location_id=a.location_id AND r.season_id=a.season_id WHERE r.id=? AND r.status='closed' AND r.finalization_status='finalized'`).bind(...bindings,filters.requestId))
  const result=await db.batch(statements)
  if(!result[0].results?.length)fail(403,'forbidden','Current stall/season membership and report authority are required.')
  if(filters.requestId&&!result[4].results?.length)fail(404,'not_found','Finalized bill not found in this workspace.')
  const summary=result[1].results[0],total=result[2].results[0].total,rows=result[3].results
  const financialValuesVisible=canFinancial&&canViewSensitiveProductPricing(result[0].results[0].effective_role)
  if(!financialValuesVisible){
    if(type==='bills'){
      delete summary.knownAmountDuePaise;delete summary.amountDuePaise
      for(const row of rows){delete row.recordedQuotationTotalPaise;delete row.recordedAdjustmentPaise}
    }
    if(type==='products'){delete summary.recordedLineSalesPaise;for(const row of rows){delete row.recordedLineSalesPaise;delete row.allocatedFinalRevenuePaise}}
  }
  safeNumbers({summary,total,rows})
  if(type==='profit')for(const row of rows)row.costAvailable=Boolean(row.costAvailable)
  return {ok:true,report:type,scope:{businessId:scope.businessId,locationId:scope.locationId,seasonId:scope.seasonId},timeZone:REPORT_TIME_ZONE,currency:'INR',
    dateBasis:type==='collections'?'payment_'+filters.dateBasis+'_at':'server_finalization',
    filters:{...Object.fromEntries(params),from:params.get('from'),toExclusive:params.get('toExclusive'),fromUtc:filters.from,toExclusiveUtc:filters.toExclusive},
    valueBasis:type==='products'?(financialValuesVisible?'saved_quotation_lines_before_bill_adjustment_and_agreement':'recorded_quantities_only'):type==='collections'?'recorded_payment_entries':type==='profit'?'finalized_amount_minus_immutable_purchase_snapshots':'frozen_finalized_amount',
    summary,rows,pagination:{page:filters.page,limit:filters.limit,total,totalPages:Math.ceil(total/filters.limit)},generatedAt:new Date().toISOString()}
}
