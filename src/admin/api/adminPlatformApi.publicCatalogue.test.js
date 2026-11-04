import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

/** @type {typeof fetch | undefined} */
let originalFetch

const SETTING_PATH = '/api/admin/platform/settings/public-catalogue-season'

describe('adminPlatformApi public catalogue setting', () => {
  before(() => {
    originalFetch = globalThis.fetch
  })

  after(() => {
    if (originalFetch) globalThis.fetch = originalFetch
  })

  it('loads publicCatalogueSeasonId from GET', async () => {
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), new RegExp(`${SETTING_PATH.replace(/\//g, '\\/')}$`))
      assert.equal(init?.method ?? 'GET', 'GET')
      return new Response(JSON.stringify({ publicCatalogueSeasonId: 'season-2026' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const stamp = Date.now()
    const { fetchPlatformPublicCatalogueSeasonSetting } = await import(
      `./adminPlatformApi.js?pc-get=${stamp}`
    )
    const result = await fetchPlatformPublicCatalogueSeasonSetting()
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.publicCatalogueSeasonId, 'season-2026')
  })

  it('patches publicCatalogueSeasonId on save', async () => {
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /public-catalogue-season/)
      assert.equal(init?.method, 'PATCH')
      const body = JSON.parse(String(init?.body))
      assert.equal(body.publicCatalogueSeasonId, 'season-2030')
      return new Response(JSON.stringify({ publicCatalogueSeasonId: 'season-2030' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const stamp = Date.now()
    const { updatePlatformPublicCatalogueSeasonSetting } = await import(
      `./adminPlatformApi.js?pc-patch=${stamp}`
    )
    const result = await updatePlatformPublicCatalogueSeasonSetting('season-2030')
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.publicCatalogueSeasonId, 'season-2030')
  })

  it('surfaces API errors from GET and PATCH', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'not_found', message: 'Public catalogue season is not configured.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })

    const stamp = Date.now()
    const { fetchPlatformPublicCatalogueSeasonSetting } = await import(
      `./adminPlatformApi.js?pc-err-get=${stamp}`
    )
    const getFail = await fetchPlatformPublicCatalogueSeasonSetting()
    assert.equal(getFail.ok, false)
    if (getFail.ok) return
    assert.match(getFail.message, /not configured/i)

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: 'validation_error',
          message: 'Public catalogue season must be an active business season.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )

    const stamp2 = Date.now()
    const { updatePlatformPublicCatalogueSeasonSetting } = await import(
      `./adminPlatformApi.js?pc-err-patch=${stamp2}`
    )
    const patchFail = await updatePlatformPublicCatalogueSeasonSetting('season-archived')
    assert.equal(patchFail.ok, false)
    if (patchFail.ok) return
    assert.match(patchFail.message, /active/i)
  })
})
