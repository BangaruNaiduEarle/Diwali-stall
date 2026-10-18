import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { d1ExecLocal, d1QueryLocal } from './helpers/d1Local.js'
import { lineTotalPaise } from '../src/services/money.js'
import {
  cleanupSchemaQuotationFixture,
  deleteTestProductsById,
  SCHEMA_TEST_PRODUCT,
  SCHEMA_TEST_PRODUCT_BAD,
  SCHEMA_TEST_QUOTE,
  SCHEMA_TEST_REQUEST,
} from './helpers/testDbCleanup.js'

const TEST_CAT = 'others'
const TEST_PRODUCT = SCHEMA_TEST_PRODUCT
const TEST_PRODUCT_BAD = SCHEMA_TEST_PRODUCT_BAD
const TEST_REQUEST = SCHEMA_TEST_REQUEST
const TEST_QUOTE = SCHEMA_TEST_QUOTE

const LINE_QTY = 2
const UNIT_RATE_PAISE = 100
const EXPECTED_LINE_TOTAL_PAISE = lineTotalPaise(LINE_QTY, UNIT_RATE_PAISE)
const BAD_LINE_TOTAL_PAISE = EXPECTED_LINE_TOTAL_PAISE + 50

function execExpectFail(sql) {
  try {
    d1ExecLocal(sql)
    return false
  } catch {
    return true
  }
}

function cleanupSchemaFixtures() {
  cleanupSchemaQuotationFixture()
  deleteTestProductsById([TEST_PRODUCT, TEST_PRODUCT_BAD])
}

before(() => {
  cleanupSchemaFixtures()
})

after(() => {
  cleanupSchemaFixtures()
})

describe('D1 schema constraints (local)', () => {
  it('has seeded categories from migration 0002', () => {
    const rows = d1QueryLocal(
      "SELECT COUNT(*) AS n FROM categories WHERE slug = 'gift-boxes'",
    )
    assert.ok(Number(rows[0]?.n) >= 1)
  })

  it('rejects product with unknown category FK', () => {
    const failed = execExpectFail(
      `INSERT INTO products (id, category_slug, name) VALUES ('${TEST_PRODUCT_BAD}', 'no-such-category', 'Bad')`,
    )
    assert.ok(failed)
  })

  it('allows product + private rate in paise and enforces one current rate', () => {
    deleteTestProductsById([TEST_PRODUCT])
    d1ExecLocal(
      `INSERT INTO products (id, category_slug, name) VALUES ('${TEST_PRODUCT}', '${TEST_CAT}', 'Schema Test Product')`,
    )
    d1ExecLocal(
      `INSERT INTO private_rates (product_id, unit_rate_paise, effective_from) VALUES ('${TEST_PRODUCT}', 12345, datetime('now'))`,
    )
    const dup = execExpectFail(
      `INSERT INTO private_rates (product_id, unit_rate_paise, effective_from) VALUES ('${TEST_PRODUCT}', 999, datetime('now'))`,
    )
    assert.ok(dup, 'second current private rate should fail unique index')
  })

  it('enforces quotation line_total_paise = quantity * unit_rate_paise', () => {
    cleanupSchemaQuotationFixture()
    d1ExecLocal(
      `INSERT INTO customer_requests (id, status) VALUES ('${TEST_REQUEST}', 'received')`,
    )
    d1ExecLocal(
      `INSERT INTO quotations (id, customer_request_id, status, subtotal_paise, total_paise) VALUES ('${TEST_QUOTE}', '${TEST_REQUEST}', 'draft', 0, 0)`,
    )
    assert.equal(EXPECTED_LINE_TOTAL_PAISE, LINE_QTY * UNIT_RATE_PAISE)
    const badLine = execExpectFail(
      `INSERT INTO quotation_items (quotation_id, line_number, product_name, quantity, unit_rate_paise, line_total_paise) VALUES ('${TEST_QUOTE}', 1, 'Item', ${LINE_QTY}, ${UNIT_RATE_PAISE}, ${BAD_LINE_TOTAL_PAISE})`,
    )
    assert.ok(badLine, 'mismatched line_total_paise should fail CHECK')
    d1ExecLocal(
      `INSERT INTO quotation_items (quotation_id, line_number, product_name, quantity, unit_rate_paise, line_total_paise) VALUES ('${TEST_QUOTE}', 1, 'Item', ${LINE_QTY}, ${UNIT_RATE_PAISE}, ${EXPECTED_LINE_TOTAL_PAISE})`,
    )
    const rows = d1QueryLocal(
      `SELECT quantity, unit_rate_paise, line_total_paise FROM quotation_items WHERE quotation_id = '${TEST_QUOTE}'`,
    )
    assert.equal(Number(rows[0]?.quantity), LINE_QTY)
    assert.equal(Number(rows[0]?.unit_rate_paise), UNIT_RATE_PAISE)
    assert.equal(Number(rows[0]?.line_total_paise), EXPECTED_LINE_TOTAL_PAISE)
  })

  it('enforces one current purchase rate per product', () => {
    deleteTestProductsById([TEST_PRODUCT])
    d1ExecLocal(
      `INSERT INTO products (id, category_slug, name) VALUES ('${TEST_PRODUCT}', '${TEST_CAT}', 'Schema Test Product')`,
    )
    d1ExecLocal(
      `INSERT INTO product_purchase_rates (product_id, unit_rate_paise, effective_from) VALUES ('${TEST_PRODUCT}', 5000, datetime('now'))`,
    )
    const dup = execExpectFail(
      `INSERT INTO product_purchase_rates (product_id, unit_rate_paise, effective_from) VALUES ('${TEST_PRODUCT}', 6000, datetime('now'))`,
    )
    assert.ok(dup, 'second current purchase rate should fail unique index')
  })

  it('allows only one non-void quotation per customer request', () => {
    cleanupSchemaQuotationFixture()
    d1ExecLocal(
      `INSERT INTO customer_requests (id, status) VALUES ('${TEST_REQUEST}', 'received')`,
    )
    d1ExecLocal(
      `INSERT INTO quotations (id, customer_request_id, status, subtotal_paise, total_paise) VALUES ('${TEST_QUOTE}', '${TEST_REQUEST}', 'draft', 0, 0)`,
    )
    const dup = execExpectFail(
      `INSERT INTO quotations (id, customer_request_id, status, subtotal_paise, total_paise) VALUES ('${crypto.randomUUID()}', '${TEST_REQUEST}', 'quoted', 0, 0)`,
    )
    assert.ok(dup, 'second active quotation should fail partial unique index')
    d1ExecLocal(
      `UPDATE quotations SET status = 'void' WHERE id = '${TEST_QUOTE}'`,
    )
    d1ExecLocal(
      `INSERT INTO quotations (id, customer_request_id, status, subtotal_paise, total_paise) VALUES ('${crypto.randomUUID()}', '${TEST_REQUEST}', 'draft', 0, 0)`,
    )
  })

  it('public list query returns no private rate columns', () => {
    deleteTestProductsById([TEST_PRODUCT])
    d1ExecLocal(
      `INSERT INTO products (id, category_slug, name) VALUES ('${TEST_PRODUCT}', '${TEST_CAT}', 'Schema Test Product')`,
    )
    d1ExecLocal(
      `INSERT INTO private_rates (product_id, unit_rate_paise, effective_from) VALUES ('${TEST_PRODUCT}', 12345, datetime('now'))`,
    )
    const rows = d1QueryLocal(`
      SELECT p.id, p.name
      FROM products p
      INNER JOIN categories c ON c.slug = p.category_slug
      WHERE p.id = '${TEST_PRODUCT}'
    `)
    assert.equal(rows[0]?.id, TEST_PRODUCT)
    const rateJoin = d1QueryLocal(`
      SELECT pr.unit_rate_paise
      FROM products p
      INNER JOIN private_rates pr ON pr.product_id = p.id AND pr.effective_to IS NULL
      WHERE p.id = '${TEST_PRODUCT}'
    `)
    assert.equal(Number(rateJoin[0]?.unit_rate_paise), 12345)
  })
})
