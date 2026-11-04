import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

/** @type {typeof fetch | undefined} */
let originalFetch

const SAMPLE_SEASON = {
  id: 'season-2026',
  code: '2026',
  label: 'Diwali 2026',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('adminPlatformApi business seasons', () => {
  before(() => {
    originalFetch = globalThis.fetch
  })

  after(() => {
    if (originalFetch) globalThis.fetch = originalFetch
  })

  it('lists seasons from GET /api/admin/platform/seasons', async () => {
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /\/api\/admin\/platform\/seasons$/)
      assert.equal(init?.method ?? 'GET', 'GET')
      return new Response(JSON.stringify({ seasons: [SAMPLE_SEASON] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const stamp = Date.now()
    const { fetchPlatformBusinessSeasons } = await import(`./adminPlatformApi.js?list=${stamp}`)
    const result = await fetchPlatformBusinessSeasons()
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.seasons.length, 1)
    assert.equal(result.seasons[0].code, '2026')
  })

  it('creates a season via POST', async () => {
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /\/api\/admin\/platform\/seasons$/)
      assert.equal(init?.method, 'POST')
      const body = JSON.parse(String(init?.body))
      assert.equal(body.id, 'season-2030')
      return new Response(
        JSON.stringify({
          season: { ...SAMPLE_SEASON, id: 'season-2030', code: '2030', label: 'Diwali 2030' },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const stamp = Date.now()
    const { createPlatformBusinessSeason } = await import(`./adminPlatformApi.js?create=${stamp}`)
    const result = await createPlatformBusinessSeason({
      id: 'season-2030',
      code: '2030',
      label: 'Diwali 2030',
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.season.id, 'season-2030')
  })

  it('patches code and label only', async () => {
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /\/api\/admin\/platform\/seasons\/season-2026$/)
      assert.equal(init?.method, 'PATCH')
      const body = JSON.parse(String(init?.body))
      assert.deepEqual(body, { code: '2026', label: 'Updated label' })
      return new Response(
        JSON.stringify({ season: { ...SAMPLE_SEASON, label: 'Updated label' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const stamp = Date.now()
    const { updatePlatformBusinessSeason } = await import(`./adminPlatformApi.js?patch=${stamp}`)
    const result = await updatePlatformBusinessSeason('season-2026', {
      code: '2026',
      label: 'Updated label',
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.season.label, 'Updated label')
  })

  it('archives and reactivates via POST subpaths', async () => {
    /** @type {string[]} */
    const paths = []

    globalThis.fetch = async (url, init) => {
      const path = String(url)
      paths.push(path)
      assert.equal(init?.method, 'POST')
      const archived = path.includes('/archive')
      return new Response(
        JSON.stringify({
          season: { ...SAMPLE_SEASON, status: archived ? 'archived' : 'active' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const stamp = Date.now()
    const { archivePlatformBusinessSeason, reactivatePlatformBusinessSeason } = await import(
      `./adminPlatformApi.js?status=${stamp}`
    )

    const archive = await archivePlatformBusinessSeason('season-2026')
    assert.equal(archive.ok, true)
    if (archive.ok) assert.equal(archive.season.status, 'archived')

    const reactivate = await reactivatePlatformBusinessSeason('season-2026')
    assert.equal(reactivate.ok, true)
    if (reactivate.ok) assert.equal(reactivate.season.status, 'active')

    assert.ok(paths.some((p) => p.includes('/archive')))
    assert.ok(paths.some((p) => p.includes('/reactivate')))
    assert.ok(!paths.some((p) => p.includes('/delete')))
  })

  it('surfaces API error messages on failed create', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'conflict', message: 'A season with this code already exists.' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      })

    const stamp = Date.now()
    const { createPlatformBusinessSeason } = await import(`./adminPlatformApi.js?err=${stamp}`)
    const result = await createPlatformBusinessSeason({
      id: 'season-x',
      code: '2026',
      label: 'Dup',
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 409)
    assert.match(result.message, /code already exists/i)
  })
})
