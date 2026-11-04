import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import worker from '../src/index.js'
import { hashPassword } from '../src/lib/passwordHash.js'
import { validateQuickBillCheckoutBody } from '../src/lib/quickBillValidation.js'
import { verifiedDisposableRelease } from './helpers/verifiedDisposableRelease.js'

test('focused two-stall billing acceptance: eight independent logins per stall', async t => {
  const { db, query, preserve, sourceSha256, migrationHashes } = await verifiedDisposableRelease(t)
  const runId = randomUUID(), prefix = 'eight-' + runId.slice(0, 8), season = 'season-2026'
  const number = Date.now()
  const stalls = [{ key: 'A', id: prefix + '-a', price: 10000, productId: `P${number}1`, stockId: `P${number}2` },
    { key: 'B', id: prefix + '-b', price: 25000, productId: `P${number}3`, stockId: `P${number}4` }]
  const actors = [], results = [], base = 'https://eight-stall.example.test', password = 'Disposable-eight-login-only-' + runId
  const hash = await hashPassword(password)
  await db.prepare("INSERT INTO businesses(id,slug,name,business_type) VALUES(?,?,?,'seasonal')").bind(prefix, prefix, 'Eight-login acceptance').run()
  for (const stall of stalls) {
    await db.batch([
      db.prepare('INSERT INTO business_locations(id,business_id,slug,name) VALUES(?,?,?,?)').bind(stall.id, prefix, stall.id, 'Disposable Stall ' + stall.key),
      db.prepare('INSERT INTO location_seasons(location_id,season_id,operating_year) VALUES(?,?,2026)').bind(stall.id, season),
      db.prepare('INSERT INTO categories(slug,label,season_id,location_id) VALUES(?,?,?,?)').bind(stall.id, 'Disposable category', season, stall.id),
      db.prepare(`INSERT INTO products(id,category_slug,name,pack,selling_price_paise,final_price_paise,season_id,location_id)
        VALUES(?,?,?,'Box',?,?,?,?)`).bind(stall.productId, stall.id, 'Disposable product ' + stall.key, stall.price, stall.price - 1000, season, stall.id),
      db.prepare(`INSERT INTO products(id,category_slug,name,pack,selling_price_paise,stock_status,season_id,location_id)
        VALUES(?,?,?,'Box',1000,?,?,?)`).bind(stall.stockId, stall.id, 'Stock marker', stall.key === 'A' ? 'soldout' : 'available', season, stall.id),
      db.prepare('INSERT INTO product_purchase_rates(product_id,unit_rate_paise,effective_from,season_id,location_id) VALUES(?,?,?, ?,?)')
        .bind(stall.productId, stall.price - 2000, '2026-01-01', season, stall.id),
    ])
    for (let n = 0; n < 8; n++) {
      const role = n === 0 ? 'owner' : n === 1 ? 'super_admin' : 'admin'
      const actor = { id: stall.id + '-user-' + n, email: `${stall.id}-${n}@example.test`, role, stall,
        deviceId: stall.id + '-device-' + n, deviceToken: 'ab'.repeat(32), operationId: randomUUID() }
      actors.push(actor)
      await db.batch([
        db.prepare("INSERT INTO admin_users(id,email,display_name,role,password_hash) VALUES(?,?,?,'admin',?)").bind(actor.id, actor.email, 'Disposable ' + role, hash),
        db.prepare('INSERT INTO season_members(season_id,admin_user_id,role) VALUES(?,?,?)').bind(season, actor.id, role),
        db.prepare('INSERT INTO location_members(location_id,season_id,admin_user_id,role) VALUES(?,?,?,?)').bind(stall.id, season, actor.id, role),
      ])
    }
  }
  const env = { DB: db, ADMIN_LOCATION_MODE: true, ADMIN_LOCAL_DEV_AUTH: false, CORS_ALLOWED_ORIGINS: base,
    PUBLIC_REQUEST_BUSINESS_ID: prefix, PUBLIC_REQUEST_LOCATION_ID: stalls[0].id, PUBLIC_REQUEST_SEASON_ID: season }
  const api = async (actor, path, { method = 'GET', body, revision, stall = actor?.stall.id, headers = {} } = {}) => {
    const response = await worker.fetch(new Request(base + path, { method, headers: { Origin: base, 'Content-Type': 'application/json',
      Cookie: actor?.cookie ?? '', 'X-Admin-Season-Id': season, ...(stall ? { 'X-Admin-Location-Id': stall } : {}),
      ...(revision == null ? {} : { 'If-Match': String(revision) }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, {})
    const data = await response.json()
    return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  const expect = (result, status = 200) => { assert.equal(result.status, status, `HTTP status: ${result.status}, error: ${result.data.error ?? 'none'}`); return result.data }
  const detail = async actor => expect(await api(actor, `/api/admin/customer-requests/${actor.requestId}`)).request
  let failed = false
  const check = async (id, name, fn) => {
    if (failed) { await t.test(name, { skip: 'Earlier acceptance check failed' }, () => {}); return }
    await t.test(name, async () => {
      try { const evidence = await fn(); results.push({ id, name, status: 'PASS', evidence }) }
      catch (error) { failed = true; results.push({ id, name, status: 'FAIL', error: error.message }); throw error }
    })
  }

  await check('E8-01', 'sixteen real password sessions, effective roles and foreign-stall rejection', async () => {
    await Promise.all(actors.map(async actor => {
      const login = await api(null, '/api/admin/auth/login', { method: 'POST', body: { email: actor.email, password } })
      expect(login); assert.ok(login.cookie); actor.cookie = login.cookie
      const session = expect(await api(actor, '/api/admin/session'))
      assert.equal(session.effectiveRole, actor.role)
      const foreign = stalls.find(stall => stall.id !== actor.stall.id)
      expect(await api(actor, '/api/admin/products', { stall: foreign.id }), 403)
    }))
    assert.equal(new Set(actors.map(actor => actor.cookie)).size, 16)
    return { accounts: 16, accountsPerStall: 8, roleSplitPerStall: { owner: 1, superAdmin: 1, admin: 6 }, foreignStallDenials: 16 }
  })

  await check('E8-02', 'all sixteen sessions see only own catalogue, prices and independent stock status', async () => {
    await Promise.all(actors.map(async actor => {
      const listed = expect(await api(actor, '/api/admin/products')).products
      assert.equal(listed.length, 2)
      assert.ok(listed.every(product => [actor.stall.productId, actor.stall.stockId].includes(product.id)))
      const product = listed.find(product => product.id === actor.stall.productId)
      assert.equal(product.sellingPricePaise, actor.stall.price)
      assert.equal(listed.find(product => product.id === actor.stall.stockId).stockStatus, actor.stall.key === 'A' ? 'soldout' : 'available')
      const foreign = stalls.find(stall => stall.id !== actor.stall.id)
      expect(await api(actor, '/api/admin/products/' + foreign.productId), 404)
      if (actor.role === 'admin') {
        assert.equal(product.finalPricePaise, undefined)
        assert.equal(product.purchaseRatePaise, undefined)
      }
    }))
    return { scopedCatalogues: 16, foreignProductDenials: 16, adminPricingRedactions: 12, independentStockMarkers: 2 }
  })

  await check('E8-03', 'eight per-stall device contexts reconnect concurrently and commit one request per identity', async () => {
    await Promise.all(actors.map(async actor => {
      expect(await api(actor, '/api/admin/offline/devices', { method: 'POST', body: { deviceId: actor.deviceId, deviceToken: actor.deviceToken } }))
      const catalogue = expect(await api(actor, '/api/admin/offline/catalogue')).products.filter(product => product.id === actor.stall.productId)
      assert.equal(catalogue.length, 1, 'Only cart products belong in the queued catalogue snapshot')
      actor.operation = { operationId: actor.operationId, kind: 'CREATE', deviceToken: actor.deviceToken,
        occurredAt: '2026-11-04T09:00:00.000Z', scope: { businessId: prefix, locationId: actor.stall.id, seasonId: season, userId: actor.id, deviceId: actor.deviceId },
        catalogue, body: { customer: { name: 'Disposable eight-login customer', mobile: '9876543210' },
          items: [{ productId: actor.stall.productId, quantity: 1 }],
          ...(actor.role === 'admin' ? {} : { pricingMode: 'bargain', acceptedAmountPaise: actor.stall.price }) } }
      const valid = validateQuickBillCheckoutBody(actor.operation.body, actor.role)
      assert.equal(valid.ok, true, `Fixture checkout validation: ${JSON.stringify(valid.errors ?? {})}`)
    }))
    // Actual queued protocol envelopes in memory; this does not simulate browser
    // airplane mode or claim 16-profile IndexedDB/PWA acceptance.
    await Promise.all(actors.map(async actor => {
      const result = expect(await api(actor, '/api/admin/offline/sync', { method: 'POST', body: actor.operation }))
      actor.requestId = result.requestId; assert.ok(actor.requestId)
    }))
    assert.equal(new Set(actors.map(actor => actor.requestId)).size, 16)
    await Promise.all(actors.map(async actor => {
      const replay = expect(await api(actor, '/api/admin/offline/sync', { method: 'POST', body: actor.operation }))
      assert.equal(replay.idempotentReplay, true); assert.equal(replay.requestId, actor.requestId)
    }))
    assert.equal((await query('SELECT COUNT(*) AS n FROM offline_sync_receipts WHERE business_id=?', prefix))[0].n, 16)
    for (const stall of stalls) assert.equal((await query('SELECT COUNT(*) AS n FROM customer_requests WHERE location_id=?', stall.id))[0].n, 8)
    return { concurrentCreates: 16, requestsPerStall: 8, distinctRequests: 16, receipts: 16, stableIdentityReplays: 16 }
  })

  await check('E8-04', 'eight-session stall reads, role denials and exact customer/bill history isolation', async () => {
    await Promise.all(actors.map(async actor => {
      const own = await detail(actor)
      assert.equal(own.customerName, 'Disposable eight-login customer')
      const listed = expect(await api(actor, '/api/admin/customer-requests?limit=100'))
      assert.equal(listed.pagination.total, 8)
      const ownIds = actors.filter(other => other.stall.id === actor.stall.id).map(other => other.requestId)
      assert.ok(listed.requests.every(request => ownIds.includes(request.id)))
      const foreign = actors.find(other => other.stall.id !== actor.stall.id)
      expect(await api(actor, `/api/admin/customer-requests/${foreign.requestId}`), 404)
      const history = expect(await api(actor, `/api/admin/customer-requests/${actor.requestId}/history?limit=100`))
      assert.ok(history.events.length > 0)
      assert.deepEqual(history.events.map(event => event.revision), history.events.map((_, i) => i + 1))
      if (actor.role === 'admin') {
        expect(await api(actor, `/api/admin/customer-requests/${actor.requestId}/finalize`, { method: 'PATCH', revision: own.revision, body: {} }), 403)
        expect(await api(actor, `/api/admin/products/${actor.stall.productId}/purchase-rate`), 403)
      }
    }))
    return { requestListsWithEightOwnRequests: 16, foreignRequestDenials: 16, histories: 16, adminFinalizeDenials: 12, purchaseRateDenials: 12 }
  })

  await check('E8-05', 'Owner and Super Admin in each eight-login stall finalize and record exact partial payment', async () => {
    const financial = actors.filter(actor => actor.role !== 'admin')
    for (const actor of financial) {
      const own = await detail(actor)
      expect(await api(actor, `/api/admin/customer-requests/${actor.requestId}/finalize`, { method: 'PATCH', revision: own.revision, body: {} }))
      const before = expect(await api(actor, `/api/admin/customer-requests/${actor.requestId}/payments`)).summary
      assert.equal(before.amountDuePaise, actor.stall.price)
      const operation = { operationId: randomUUID(), entryType: 'PAYMENT', amountPaise: actor.stall.price / 2, recordingMode: 'ONLINE', paymentMethod: 'CASH' }
      expect(await api(actor, `/api/admin/customer-requests/${actor.requestId}/payments`, { method: 'POST', revision: before.revision, body: operation }), 201)
      const after = expect(await api(actor, `/api/admin/customer-requests/${actor.requestId}/payments`)).summary
      assert.equal(after.receivedPaise, actor.stall.price / 2); assert.equal(after.outstandingPaise, actor.stall.price / 2)
      const history = expect(await api(actor, `/api/admin/customer-requests/${actor.requestId}/history?limit=100`))
      assert.ok(history.events.some(event => event.eventType === 'request_closed'))
      assert.ok(history.events.some(event => event.eventType === 'payment_recorded'))
      const foreign = actors.find(other => other.stall.id !== actor.stall.id && other.role === 'owner')
      expect(await api(foreign, `/api/admin/customer-requests/${actor.requestId}/payments`), 404)
    }
    for (const actor of actors.filter(actor => actor.role === 'admin')) {
      const own = await detail(actor)
      expect(await api(actor, `/api/admin/customer-requests/${actor.requestId}/payments`, { method: 'POST', revision: own.revision,
        body: { operationId: randomUUID(), entryType: 'PAYMENT', amountPaise: 1, recordingMode: 'ONLINE', paymentMethod: 'CASH' } }), 403)
    }
    return { finalizedBills: 4, payments: 4, partialBalancesCorrect: 4, foreignPaymentDenials: 4, adminPaymentDenials: 12 }
  })

  await check('E8-06', 'basic reports reconcile each stall and retained database records remain unchanged', async () => {
    const reconciled = []
    for (const stall of stalls) {
      const owner = actors.find(actor => actor.stall === stall && actor.role === 'owner')
      const admin = actors.find(actor => actor.stall === stall && actor.role === 'admin')
      const bills = expect(await api(owner, '/api/admin/reports/bills?limit=100'))
      assert.equal(bills.summary.billCount, 2)
      assert.equal(bills.summary.amountDuePaise, stall.price * 2)
      const collections = expect(await api(owner, '/api/admin/reports/collections'))
      assert.equal(collections.summary.collectedPaise, stall.price)
      expect(await api(admin, '/api/admin/reports/collections'), 403)
      expect(await api(admin, '/api/admin/reports/bills?limit=100'))
      reconciled.push({ stall: stall.key, finalizedBills: 2, duePaise: stall.price * 2, receivedPaise: stall.price })
    }
    await preserve()
    return { reconciled, retainedRowsUnchanged: true, foreignKeyViolations: 0 }
  })

  const report = { status: failed ? 'FAIL' : 'PASS', runId, setup: { sourceSha256, migrationHashes,
    migrationAcceptanceRepeated: false, execution: 'Actual Worker.fetch with password cookies; native nonpersistent D1; no browser transport',
    distinctLogins: 16, loginsPerStall: 8 }, results,
    retainedEvidence: ['MULTI_STALL_ACCEPTANCE_2026-11-03.md', 'ROLES_SEASONS_ISOLATION_ACCEPTANCE_2026-11-03.md',
      'BILLING_PAYMENT_ACCEPTANCE_2026-11-03.md', 'FOUR_ADMIN_CONCURRENCY_ACCEPTANCE_2026-11-03.md',
      'OFFLINE_QR_FAMILY_PACK_ACCEPTANCE_2026-11-03.md', 'REPORTS_SETTINGS_FINAL_ACCEPTANCE_2026-11-03.md'],
    notTested: ['Sixteen simultaneous browser/IndexedDB/PWA profiles', 'Physical Android and optical QR', 'Deployed-runtime parity', 'Soak/representative-volume performance'] }
  const folder = new URL('../../docs/report-evidence/two-stall-eight-logins-2026-11-04/', import.meta.url)
  mkdirSync(folder, { recursive: true })
  writeFileSync(new URL(runId + '.json', folder), JSON.stringify(report, null, 2), { flag: 'wx' })
  assert.equal(results.length, 6)
  assert.equal(failed, false)
})
