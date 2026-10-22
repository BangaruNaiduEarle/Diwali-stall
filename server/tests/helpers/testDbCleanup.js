/**
 * Targeted cleanup of IDs created by backend tests (never GLOB-delete catalogue rows).
 * Inspect existing ids before delete.
 */
import { d1ExecLocal, d1QueryLocal } from './d1Local.js'

/** Leftover id from older admin tests; catalogue import may still see it. */
export const LEGACY_ADMIN_FIXTURE_PRODUCT_ID = 'P900'
export const ADMIN_ARCHIVE_PRODUCT_ID = 'P901'
export const ADMIN_UPDATE_PRODUCT_ID = 'P902'
export const ADMIN_IMAGE_ORDER_PRODUCT_ID = 'P903'
/** @see adminProductDelete.test.js */
export const ADMIN_DELETE_SAFE_PRODUCT_ID = 'P905'
export const ADMIN_DELETE_REF_PRODUCT_ID = 'P906'

export const SCHEMA_TEST_PRODUCT = 'TEST-PHASE2A-P001'
export const SCHEMA_TEST_PRODUCT_BAD = 'TEST-PHASE2A-P001-bad'
export const SCHEMA_TEST_REQUEST = 'TEST-REQ-001'
export const SCHEMA_TEST_QUOTE = 'TEST-QUO-001'

const KNOWN_TEST_PRODUCT_IDS = [
  LEGACY_ADMIN_FIXTURE_PRODUCT_ID,
  ADMIN_ARCHIVE_PRODUCT_ID,
  ADMIN_UPDATE_PRODUCT_ID,
  ADMIN_IMAGE_ORDER_PRODUCT_ID,
  ADMIN_DELETE_SAFE_PRODUCT_ID,
  ADMIN_DELETE_REF_PRODUCT_ID,
  SCHEMA_TEST_PRODUCT,
  SCHEMA_TEST_PRODUCT_BAD,
]

function sqlQuote(id) {
  return `'${String(id).replace(/'/g, "''")}'`
}

/** @param {string[]} ids */
export function listExistingTestProductIds(ids) {
  if (!ids.length) return []
  const list = ids.map(sqlQuote).join(', ')
  return d1QueryLocal(`SELECT id FROM products WHERE id IN (${list}) ORDER BY id`).map((r) =>
    String(r.id),
  )
}

/**
 * Delete only the given product ids (and their private_rates), if present.
 * @param {string[]} ids
 */
export function deleteTestProductsById(ids) {
  const existing = listExistingTestProductIds(ids)
  if (existing.length === 0) {
    return { removedProductIds: [] }
  }
  const list = existing.map(sqlQuote).join(', ')
  // Dependent rows (0009 family_pack_items; quotation/request lines reference products).
  d1ExecLocal(`DELETE FROM quotation_items WHERE product_id IN (${list})`)
  d1ExecLocal(`DELETE FROM customer_request_items WHERE product_id IN (${list})`)
  d1ExecLocal(`DELETE FROM family_pack_items WHERE product_id IN (${list})`)
  d1ExecLocal(`DELETE FROM private_rates WHERE product_id IN (${list})`)
  d1ExecLocal(`DELETE FROM product_purchase_rates WHERE product_id IN (${list})`)
  d1ExecLocal(`DELETE FROM products WHERE id IN (${list})`)
  return { removedProductIds: existing }
}

/** Removes schema quotation/request rows for the known test ids only. */
export function cleanupSchemaQuotationFixture() {
  d1ExecLocal(
    `DELETE FROM customer_request_items WHERE request_id = ${sqlQuote(SCHEMA_TEST_REQUEST)}`,
  )
  d1ExecLocal(`DELETE FROM quotation_items WHERE quotation_id = ${sqlQuote(SCHEMA_TEST_QUOTE)}`)
  d1ExecLocal(
    `DELETE FROM quotation_items WHERE quotation_id IN (SELECT id FROM quotations WHERE customer_request_id = ${sqlQuote(SCHEMA_TEST_REQUEST)})`,
  )
  d1ExecLocal(`DELETE FROM quotations WHERE id = ${sqlQuote(SCHEMA_TEST_QUOTE)}`)
  d1ExecLocal(`DELETE FROM quotations WHERE customer_request_id = ${sqlQuote(SCHEMA_TEST_REQUEST)}`)
  d1ExecLocal(`DELETE FROM customer_requests WHERE id = ${sqlQuote(SCHEMA_TEST_REQUEST)}`)
}

/** Known test fixtures only (explicit ids — not a catalogue wipe). */
export function cleanupKnownTestRows() {
  cleanupSchemaQuotationFixture()
  return deleteTestProductsById(KNOWN_TEST_PRODUCT_IDS)
}

export { KNOWN_TEST_PRODUCT_IDS }
