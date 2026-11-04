import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import { workflowDb } from './helpers/workflowSqlite.js'
import { hashPassword } from '../src/lib/passwordHash.js'
import { parseAdminSessionPayload } from '../../src/admin/lib/adminSeasonSession.js'
import { showAdminProductFinalRate, showAdminProductSensitiveColumns } from '../../src/admin/lib/adminProductTableColumns.js'

test('Final Price access: rendered UI and authenticated Worker APIs on disposable in-memory D1', async t => {
  // Existing fixture and runtime patterns only. No Wrangler config, persistence
  // directory, original D1, production binding or retained backup is opened.
  const source = await workflowDb(t, { migrate: false })
  const foundation = readFileSync(new URL('../database/migrations/0020_business_location_foundation.sql', import.meta.url), 'utf8')
  const membershipSchema = foundation.match(/CREATE TABLE location_members \([\s\S]*?\n\);/)[0]
  await source.script(`CREATE UNIQUE INDEX fixture_location_seasons_key ON location_seasons(location_id,season_id);
    ALTER TABLE location_members RENAME TO fixture_old_members;
    ${membershipSchema}
    INSERT INTO location_members(location_id,season_id,admin_user_id,role,disabled_at)
      SELECT location_id,season_id,admin_user_id,role,disabled_at FROM fixture_old_members;
    DROP TABLE fixture_old_members;
    INSERT INTO location_members(location_id,season_id,admin_user_id,role)
      VALUES('loc-b','season-2026','admin','admin'),('loc-b','season-2026','owner','owner');`)
  const password = 'Final-price-runtime-fixture-2026', hash = await hashPassword(password)
  await source.prepare('UPDATE admin_users SET password_hash = ?').bind(hash).run()
  const schema = (await source.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name`).bind().all()).results
  const tables = []
  for (const name of ['business_seasons','platform_settings','businesses','business_locations','location_seasons','admin_users','season_members','location_members','categories','products']) {
    tables.push({ name, rows: (await source.prepare(`SELECT * FROM ${name}`).bind().all()).results })
  }
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/index.js', import.meta.url))], bundle: true,
    write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' })
  // Reuse the AdminRequestPayments component-rendering pattern, sharing React/router.
  const require = createRequire(import.meta.url)
  const component = await build({ entryPoints: [fileURLToPath(new URL('../../src/admin/components/AdminProductCard.jsx', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent', define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'shared-react', setup(builder) {
      builder.onResolve({ filter: /^(?:react(?:\/.*)?|react-dom(?:\/.*)?|react-router-dom|lucide-react)$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }))
    } }],
  })
  const Card = await import('data:text/javascript;base64,' + Buffer.from(component.outputFiles[0].text).toString('base64'))
    .then(module => module.default).catch(error => { throw new Error(error.message) })
  const runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-05-01', host: '127.0.0.1', port: 0,
    d1Databases: ['DB'], d1Persist: false, cachePersist: false, kvPersist: false, r2Persist: false, durableObjectsPersist: false,
    bindings: { ADMIN_LOCATION_MODE: true, ADMIN_LOCAL_DEV_AUTH: false } })
  try {
    const base = await runtime.ready, db = await runtime.getD1Database('DB')
    for (const row of schema) await db.prepare(row.sql).run()
    for (const { name, rows } of tables) for (const row of rows) {
      const keys = Object.keys(row)
      await db.prepare(`INSERT INTO ${name} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...Object.values(row)).run()
    }
    const cookies = {}
    const api = async (actor, path, method = 'GET', body, location = 'loc-a') => {
      const response = await fetch(new URL(path, base), { method, headers: { Origin: base.origin, 'Content-Type': 'application/json',
        Cookie: cookies[actor] ?? '', 'X-Admin-Location-Id': location, 'X-Admin-Season-Id': 'season-2026' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      return { status: response.status, data: await response.json(), cache: response.headers.get('cache-control') }
    }
    const login = async actor => {
      const response = await fetch(new URL('/api/admin/auth/login', base), { method: 'POST', headers: { Origin: base.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: actor + '@test.com', password }) })
      assert.equal(response.status, 200)
      cookies[actor] = response.headers.get('set-cookie').split(';')[0]
    }
    const grant = (actor, enabled, location = 'loc-a') => api(actor, '/api/admin/users/admin/final-rate-access', 'POST', { enabled }, location)
    const session = async (actor = 'admin', location = 'loc-a') => {
      const result = await api(actor, '/api/admin/session', 'GET', undefined, location)
      assert.equal(result.status, 200, JSON.stringify(result.data))
      return parseAdminSessionPayload(result.data)
    }
    const render = (session, product) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Card, {
      product, showSensitiveColumns: showAdminProductSensitiveColumns(session.effectiveRole),
      showFinalRate: showAdminProductFinalRate(session.effectiveRole, session.capabilities),
      activeInlineEdit: { id: product.id, field: 'finalPriceInr' }, onActivateInlineEdit() {}, onInlineSaved() {},
    })))
    await t.test('0027 migrates populated D1 memberships safely, defaults denied and enforces boolean constraints', async () => {
      const before = (await db.prepare('SELECT * FROM location_members ORDER BY location_id,admin_user_id').all()).results
      await db.prepare(readFileSync(new URL('../database/migrations/0027_location_final_rate_access.sql', import.meta.url), 'utf8')).run()
      const after = (await db.prepare('SELECT * FROM location_members ORDER BY location_id,admin_user_id').all()).results
      assert.deepEqual(after.map(({ can_view_final_rate, ...row }) => { assert.equal(can_view_final_rate, 0); return row }), before)
      await assert.rejects(db.prepare('UPDATE location_members SET can_view_final_rate=2').run())
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
    })
    for (const actor of ['owner','super','admin']) await login(actor)
    await t.test('Admin default denied in real APIs and rendered product UI', async () => {
      for (const path of ['/api/admin/products/P001','/api/admin/products','/api/admin/products?page=1']) {
        const result = await api('admin', path)
        assert.equal(result.status, 200, JSON.stringify(result.data)); assert.equal(result.cache, 'no-store')
        const product = result.data.product ?? result.data.products.find(p => p.id === 'P001')
        assert.equal(product.finalPricePaise, undefined)
        assert.doesNotMatch(render(await session(), product), /<dt>Final Rate<\/dt>/)
      }
      assert.equal((await grant('admin', true)).status, 403)
    })
    await t.test('Owner and Super Admin grant read-only Final Price in direct API responses and rendered UI', async () => {
      for (const actor of ['owner','super']) {
        assert.equal((await grant(actor, true)).status, 200)
        const product = (await api('admin','/api/admin/products/P001')).data.product
        assert.equal(product.finalPricePaise, 8000)
        const html = render(await session(), product)
        assert.match(html, /<dt>Final Rate<\/dt><dd[^>]*>\u20b980<\/dd>/)
        assert.doesNotMatch(html, /<dt>Purchase<\/dt>|finalPriceInr|admin-inline-cell--editing/)
        assert.equal((await grant(actor, false)).status, 200)
      }
    })
    await t.test('Purchase Price, mappings and pricing edit APIs stay forbidden after grant', async () => {
      await grant('owner', true)
      const product = (await api('admin','/api/admin/products/P001')).data.product
      for (const key of ['purchaseRatePaise','purchaseRateInr','hasPurchaseRate','x4SellingPricePaise','x4SellingPriceInr','privateX4Paise','pricingMapping']) assert.equal(product[key], undefined)
      for (const path of ['/api/admin/products/P001/purchase-rate','/api/admin/products/P001/private-rate']) assert.equal((await api('admin',path)).status,403)
      for (const body of [{finalPriceInr:1},{final_price_inr:1},{sellingPriceInr:1}]) assert.equal((await api('admin','/api/admin/products/P001','PATCH',body)).status,403)
    })
    await t.test('Revocation affects the existing cookie immediately and refresh/re-login removes Final Price UI', async () => {
      assert.equal((await session()).capabilities.viewFinalRate, true)
      assert.equal((await grant('super', false)).status, 200)
      const product = (await api('admin','/api/admin/products/P001')).data.product
      assert.equal(product.finalPricePaise, undefined)
      const refreshed = await session()
      assert.equal(refreshed.capabilities.viewFinalRate, false)
      assert.doesNotMatch(render(refreshed, product), /<dt>Final Rate<\/dt>/)
      await login('admin')
      assert.equal((await session()).capabilities.viewFinalRate, false)
    })
    await t.test('Stall A grant leaves Stall B denied; actors cannot change an unauthorized stall', async () => {
      await grant('owner', true)
      assert.equal((await session()).capabilities.viewFinalRate, true)
      const b = await session('admin','loc-b'), product = (await api('admin','/api/admin/products/P002','GET',undefined,'loc-b')).data.product
      assert.equal(b.capabilities.viewFinalRate, false); assert.equal(product.finalPricePaise, undefined)
      assert.doesNotMatch(render(b, product), /<dt>Final Rate<\/dt>/)
      assert.equal((await grant('super', true, 'loc-b')).status, 403)
      assert.equal((await api('owner','/api/admin/users/admin/final-rate-access','POST',{enabled:true,locationId:'loc-b'})).status,400)
      assert.equal((await db.prepare("SELECT can_view_final_rate FROM location_members WHERE location_id='loc-b' AND admin_user_id='admin'").first()).can_view_final_rate,0)
    })
    await t.test('Owner/Super Admin retain Final Price and private pricing without grants', async () => {
      for (const actor of ['owner','super']) {
        const product = (await api(actor,'/api/admin/products/P001')).data.product
        assert.equal(product.finalPricePaise, 8000)
        assert.ok(Object.hasOwn(product,'purchaseRateInr')); assert.ok(Object.hasOwn(product,'pricingMapping'))
        assert.equal((await session(actor)).capabilities.viewFinalRate, true)
      }
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, [])
    })
  } finally { await runtime.dispose() }
})
