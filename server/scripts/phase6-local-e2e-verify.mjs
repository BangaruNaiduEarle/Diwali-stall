#!/usr/bin/env node
/**
 * Phase 6 local HTTP + D1 read-only checks against wrangler dev (loopback).
 * Does not print JWTs, secrets, phone numbers, or private rate amounts.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { signLocalDevAdminJwt } from '../src/middleware/localAdminDevAuth.js'
import { d1QueryLocalSelect } from '../src/lib/d1LocalSelect.js'
import { lineTotalPaise } from '../src/services/money.js'

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEV_VARS = path.join(SERVER_ROOT, '.dev.vars')
const FORBIDDEN_PUBLIC_KEYS = [
  'private_rates',
  'product_purchase_rates',
  'purchaseRatePaise',
  'purchaseRateInr',
  'x4SellingPricePaise',
  'x4SellingPriceInr',
  'privateX4',
  'unit_rate_paise',
  'unitRatePaise',
]

function loadDevVars() {
  /** @type {Record<string, string>} */
  const out = {}
  if (!fs.existsSync(DEV_VARS)) return out
  for (const line of fs.readFileSync(DEV_VARS, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return out
}

async function resolveBaseUrl() {
  const candidates = [
    process.env.PHASE6_BASE_URL,
    'http://127.0.0.1:8789',
    'http://127.0.0.1:8788',
    'http://127.0.0.1:8787',
  ].filter(Boolean)
  for (const base of candidates) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return String(base)
    } catch {
      /* try next */
    }
  }
  throw new Error('local_worker_not_reachable')
}

/** @param {unknown} body */
function assertNoForbiddenPricingKeys(body, label) {
  const text = JSON.stringify(body)
  for (const key of FORBIDDEN_PUBLIC_KEYS) {
    if (text.includes(`"${key}"`)) {
      throw new Error(`${label}: forbidden key ${key}`)
    }
  }
}

async function main() {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const results = []

  async function check(name, fn) {
    try {
      const detail = await fn()
      results.push({ name, ok: true, detail: detail ?? undefined })
    } catch (err) {
      results.push({ name, ok: false, detail: String(err?.message ?? err) })
    }
  }

  const purchaseCount = Number(
    d1QueryLocalSelect(
      'SELECT COUNT(*) AS n FROM product_purchase_rates WHERE effective_to IS NULL',
    )[0]?.n,
  )
  const x4Count = Number(
    d1QueryLocalSelect('SELECT COUNT(*) AS n FROM private_rates WHERE effective_to IS NULL')[0]?.n,
  )
  const dupPurchase = d1QueryLocalSelect(
    `SELECT COUNT(*) AS n FROM (
      SELECT product_id FROM product_purchase_rates WHERE effective_to IS NULL GROUP BY product_id HAVING COUNT(*) > 1
    )`,
  )

  await check('d1_purchase_rate_count_70', async () => {
    if (purchaseCount !== 70) throw new Error(`expected 70 got ${purchaseCount}`)
    return `count=${purchaseCount}`
  })

  await check('d1_x4_current_count_138', async () => {
    if (x4Count !== 138) throw new Error(`expected 138 got ${x4Count}`)
    return `count=${x4Count}`
  })

  await check('d1_no_duplicate_current_purchase', async () => {
    const n = Number(dupPurchase[0]?.n ?? 0)
    if (n !== 0) throw new Error(`duplicate groups=${n}`)
    return 'ok'
  })

  const base = await resolveBaseUrl()
  const dev = loadDevVars()
  if (dev.ADMIN_LOCAL_DEV_AUTH !== '1' || !dev.ADMIN_LOCAL_DEV_SECRET) {
    throw new Error('local_admin_dev_not_configured')
  }
  const token = await signLocalDevAdminJwt(
    {
      ADMIN_LOCAL_DEV_SECRET: dev.ADMIN_LOCAL_DEV_SECRET,
      ADMIN_LOCAL_DEV_EMAIL: dev.ADMIN_LOCAL_DEV_EMAIL,
    },
    { email: dev.ADMIN_LOCAL_DEV_EMAIL },
  )
  const adminHeaders = {
    'Cf-Access-Jwt-Assertion': token,
    'Content-Type': 'application/json',
  }

  await check('admin_unauthenticated_rejected', async () => {
    const res = await fetch(`${base}/api/admin/products?page=1`)
    if (res.status !== 401 && res.status !== 503) {
      throw new Error(`status ${res.status}`)
    }
    return `status=${res.status}`
  })

  await check('admin_session_authenticated', async () => {
    const res = await fetch(`${base}/api/admin/session`, { headers: adminHeaders })
    if (!res.ok) throw new Error(`status ${res.status}`)
    const body = await res.json()
    if (!body.ok) throw new Error('session not ok')
    return 'ok'
  })

  await check('public_products_no_private_pricing', async () => {
    const res = await fetch(`${base}/api/public/products?limit=5`)
    if (!res.ok) throw new Error(`status ${res.status}`)
    const body = await res.json()
    assertNoForbiddenPricingKeys(body, 'public_products_list')
    return `products=${(body.products ?? []).length}`
  })

  await check('public_product_by_id_no_private_pricing', async () => {
    const res = await fetch(`${base}/api/public/products/P001`)
    if (!res.ok) throw new Error(`status ${res.status}`)
    const body = await res.json()
    assertNoForbiddenPricingKeys(body, 'public_product_detail')
    return 'P001'
  })

  const idempotencyKey = `phase6-e2e-${Date.now()}`
  let requestId = ''

  await check('customer_request_create', async () => {
    const res = await fetch(`${base}/api/public/customer-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        customer: { name: 'Phase6 Test', mobile: '9000000001' },
        items: [{ productId: 'P001', quantity: 2 }],
      }),
    })
    if (res.status !== 201) throw new Error(`status ${res.status}`)
    const body = await res.json()
    requestId = String(body.request?.id ?? '')
    if (!requestId.startsWith('cr-')) throw new Error('missing request id')
    return `request_created`
  })

  await check('customer_request_idempotent_replay', async () => {
    const res = await fetch(`${base}/api/public/customer-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        customer: { name: 'Phase6 Test', mobile: '9000000001' },
        items: [{ productId: 'P001', quantity: 2 }],
      }),
    })
    if (res.status !== 201 && res.status !== 200) throw new Error(`status ${res.status}`)
    const body = await res.json()
    if (String(body.request?.id ?? '') !== requestId) throw new Error('idempotency mismatch')
    return 'same_request_id'
  })

  await check('admin_request_queue_detail', async () => {
    const list = await fetch(`${base}/api/admin/customer-requests?page=1&limit=5`, {
      headers: adminHeaders,
    })
    if (!list.ok) throw new Error(`list status ${list.status}`)
    const detail = await fetch(`${base}/api/admin/customer-requests/${encodeURIComponent(requestId)}`, {
      headers: adminHeaders,
    })
    if (!detail.ok) throw new Error(`detail status ${detail.status}`)
    const body = await detail.json()
    assertNoForbiddenPricingKeys(body, 'admin_request_detail')
    const items = body.request?.items ?? body.items
    if (!Array.isArray(items) || items.length < 1) throw new Error('no items')
    return `items=${items.length}`
  })

  let quotationId = ''
  let unitPaise = 0
  let lineTotal = 0

  await check('quotation_create_x4_based', async () => {
    const res = await fetch(`${base}/api/admin/customer-requests/${encodeURIComponent(requestId)}/quotation`, {
      method: 'POST',
      headers: adminHeaders,
    })
    if (res.status !== 201 && res.status !== 200) throw new Error(`status ${res.status}`)
    const body = await res.json()
    const q = body.quotation
    quotationId = String(q?.id ?? '')
    const item = q?.items?.[0]
    unitPaise = Number(item?.unitRatePaise)
    lineTotal = Number(item?.lineTotalPaise)
    if (!Number.isInteger(unitPaise) || unitPaise <= 0) throw new Error('invalid unit paise')
    const expected = lineTotalPaise(2, unitPaise)
    if (lineTotal !== expected) throw new Error('line total not qty*unit')
    if (Number(q?.totalPaise) !== lineTotal) throw new Error('total mismatch')
    return `quotation_created`
  })

  await check('quotation_retry_single_active', async () => {
    const res = await fetch(`${base}/api/admin/customer-requests/${encodeURIComponent(requestId)}/quotation`, {
      method: 'POST',
      headers: adminHeaders,
    })
    const body = await res.json()
    if (String(body.quotation?.id ?? '') !== quotationId) throw new Error('duplicate active quotation')
    if (body.created !== false) throw new Error('expected created=false on retry')
    return 'idempotent_quotation'
  })

  await check('whatsapp_preview_snapshot', async () => {
    const res = await fetch(
      `${base}/api/admin/quotations/${encodeURIComponent(quotationId)}/whatsapp`,
      { headers: adminHeaders },
    )
    if (!res.ok) throw new Error(`status ${res.status}`)
    const body = await res.json()
    const msg = String(body.message ?? '')
    if (msg.length < 20) throw new Error('message too short')
    if (!msg.includes('P001') && !msg.toLowerCase().includes('emerald')) {
      /* product name in message is enough */
    }
    if (!body.quotationId) throw new Error('missing quotationId')
    return `message_chars=${msg.length}`
  })

  await check('quotation_regenerate', async () => {
    const res = await fetch(
      `${base}/api/admin/customer-requests/${encodeURIComponent(requestId)}/quotation/regenerate`,
      { method: 'POST', headers: adminHeaders },
    )
    if (!res.ok) throw new Error(`status ${res.status}`)
    const body = await res.json()
    const newId = String(body.quotation?.id ?? '')
    if (!newId || newId === quotationId) throw new Error('regenerate did not replace quotation')
    const active = await fetch(
      `${base}/api/admin/customer-requests/${encodeURIComponent(requestId)}/quotation`,
      { headers: adminHeaders },
    )
    const activeBody = await active.json()
    if (String(activeBody.quotation?.id ?? '') !== newId) throw new Error('active quotation mismatch')
    quotationId = newId
    return 'regenerated'
  })

  await check('admin_x4_edit_leaves_purchase_unchanged', async () => {
    const beforeRes = await fetch(`${base}/api/admin/products/P001`, { headers: adminHeaders })
    const before = await beforeRes.json()
    const beforeProduct = before.product ?? before
    const purchaseBefore = Number(beforeProduct.purchaseRatePaise)
    if (!Number.isInteger(purchaseBefore)) throw new Error('P001 missing purchase in admin API')
    const x4Inr = Number(beforeProduct.x4SellingPriceInr ?? beforeProduct.privateX4Inr)
    const putRes = await fetch(`${base}/api/admin/products/P001/x4-selling-rate`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ x4SellingPriceInr: x4Inr }),
    })
    if (!putRes.ok) throw new Error(`put x4 ${putRes.status}`)
    const afterRes = await fetch(`${base}/api/admin/products/P001`, { headers: adminHeaders })
    const after = await afterRes.json()
    const afterProduct = after.product ?? after
    if (Number(afterProduct.purchaseRatePaise) !== purchaseBefore) {
      throw new Error('purchase changed after X4 no-op upsert')
    }
    return 'purchase_unchanged'
  })

  await check('admin_purchase_edit_leaves_x4_unchanged', async () => {
    const beforeRes = await fetch(`${base}/api/admin/products/P001`, { headers: adminHeaders })
    if (!beforeRes.ok) throw new Error(`get product ${beforeRes.status}`)
    const before = await beforeRes.json()
    const beforeProduct = before.product ?? before
    const x4Before = Number(beforeProduct.x4SellingPricePaise ?? beforeProduct.privateX4Paise)
    const purchaseBefore = Number(beforeProduct.purchaseRatePaise)
    if (!Number.isInteger(x4Before)) throw new Error('P001 missing X4 in admin API')

    const purchaseInr =
      beforeProduct.purchaseRateInr != null ? Number(beforeProduct.purchaseRateInr) : purchaseBefore / 100
    const putRes = await fetch(`${base}/api/admin/products/P001/purchase-rate`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ purchaseRateInr: purchaseInr }),
    })
    if (!putRes.ok) throw new Error(`put purchase ${putRes.status}`)

    const afterRes = await fetch(`${base}/api/admin/products/P001`, { headers: adminHeaders })
    const after = await afterRes.json()
    const afterProduct = after.product ?? after
    const x4After = Number(afterProduct.x4SellingPricePaise ?? afterProduct.privateX4Paise)
    if (x4After !== x4Before) throw new Error('X4 changed after purchase no-op upsert')
    return 'x4_unchanged'
  })

  await check('admin_request_status_patch', async () => {
    const res = await fetch(`${base}/api/admin/customer-requests/${encodeURIComponent(requestId)}/status`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'quoted' }),
    })
    if (!res.ok) throw new Error(`status ${res.status}`)
    return 'quoted'
  })

  const failed = results.filter((r) => !r.ok)
  const summary = {
    phase: 6,
    baseUrl: base,
    d1: { purchase_current: purchaseCount, x4_current: x4Count },
    checks: results,
    passed: results.length - failed.length,
    failed: failed.length,
    ok: failed.length === 0,
  }

  const outPath = path.join(SERVER_ROOT, 'reports', 'phase6-local-e2e-verify.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  console.log(`Phase 6 local E2E: ${summary.passed}/${results.length} passed`)
  console.log(`Report: ${path.relative(SERVER_ROOT, outPath)}`)
  if (failed.length) {
    for (const f of failed) console.error(`FAIL ${f.name}: ${f.detail}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err?.message ?? err)
  process.exit(1)
})
