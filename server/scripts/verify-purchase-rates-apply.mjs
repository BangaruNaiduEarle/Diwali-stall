#!/usr/bin/env node
/** Read-only post-apply verification — counts only, no rate values printed. */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'
import { d1QueryLocalSelect } from '../src/lib/d1LocalSelect.js'
import { inrToPaise } from '../src/services/money.js'

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const report = JSON.parse(
  fs.readFileSync(path.join(SERVER_ROOT, 'reports/purchase-rates-dry-run.json'), 'utf8'),
)
const readyIds = (report.ready_for_import ?? []).map((r) => String(r.product_id))

const purchaseCount = Number(
  d1QueryLocalSelect(
    'SELECT COUNT(*) AS n FROM product_purchase_rates WHERE effective_to IS NULL',
  )[0]?.n,
)
const x4Count = Number(
  d1QueryLocalSelect('SELECT COUNT(*) AS n FROM private_rates WHERE effective_to IS NULL')[0]?.n,
)
const dup = d1QueryLocalSelect(
  `SELECT product_id, COUNT(*) AS c FROM product_purchase_rates WHERE effective_to IS NULL GROUP BY product_id HAVING c > 1`,
)
const p142 = Number(
  d1QueryLocalSelect(
    "SELECT COUNT(*) AS n FROM product_purchase_rates WHERE product_id = 'P142' AND effective_to IS NULL",
  )[0]?.n,
)
const x4Phase2 = Number(
  d1QueryLocalSelect(
    "SELECT COUNT(*) AS n FROM private_rates WHERE effective_to IS NULL AND notes LIKE 'x4_import_phase2%'",
  )[0]?.n,
)
const purchasePhase53 = Number(
  d1QueryLocalSelect(
    "SELECT COUNT(*) AS n FROM product_purchase_rates WHERE effective_to IS NULL AND notes LIKE 'purchase_rate_import_phase53%'",
  )[0]?.n,
)

const missing = []
const paiseMismatch = []
for (const row of report.ready_for_import ?? []) {
  const id = String(row.product_id)
  const rows = d1QueryLocalSelect(
    `SELECT unit_rate_paise FROM product_purchase_rates WHERE product_id = '${id.replace(/'/g, "''")}' AND effective_to IS NULL`,
  )
  if (rows.length !== 1) missing.push({ id, count: rows.length })
  else if (Number(rows[0].unit_rate_paise) !== Number(row.unit_rate_paise)) {
    paiseMismatch.push(id)
  }
  const expectedFromRate = inrToPaise(Number(row.purchase_rate_inr))
  if (expectedFromRate !== Number(row.unit_rate_paise)) {
    paiseMismatch.push(`${id}:plan_inconsistent`)
  }
}

const out = {
  purchase_current: purchaseCount,
  x4_current: x4Count,
  duplicate_current_purchase_products: dup.length,
  p142_current_purchase: p142,
  ready_ids_with_exactly_one_current_rate: readyIds.length - missing.length,
  ready_ids_missing_or_extra: missing,
  paise_mismatch_ids: [...new Set(paiseMismatch)],
  purchase_phase53_provenance_count: purchasePhase53,
  x4_phase2_provenance_count: x4Phase2,
  all_checks_ok:
    purchaseCount === 70 &&
    x4Count === 138 &&
    dup.length === 0 &&
    p142 === 0 &&
    missing.length === 0 &&
    paiseMismatch.length === 0 &&
    purchasePhase53 === 70,
}
console.log(JSON.stringify(out, null, 2))
process.exit(out.all_checks_ok ? 0 : 1)
