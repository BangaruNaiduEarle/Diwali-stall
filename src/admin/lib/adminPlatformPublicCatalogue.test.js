import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  filterActivePlatformBusinessSeasons,
  formatPublicCatalogueSeasonDisplay,
  publicCatalogueSeasonSaveConfirmMessage,
  publicCatalogueSelectionIsDirty,
  validatePublicCatalogueSeasonSelection,
} from './adminPlatformPublicCatalogue.js'

const active = { id: 'season-2026', code: '2026', label: 'Diwali 2026', status: /** @type {const} */ ('active'), createdAt: '', updatedAt: '' }
const archived = { id: 'season-old', code: 'old', label: 'Old', status: /** @type {const} */ ('archived'), createdAt: '', updatedAt: '' }

describe('adminPlatformPublicCatalogue', () => {
  it('filters dropdown options to active seasons only', () => {
    const filtered = filterActivePlatformBusinessSeasons([active, archived])
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].id, 'season-2026')
  })

  it('validates selection against active seasons', () => {
    const fail = validatePublicCatalogueSeasonSelection('season-old', [active])
    assert.equal(fail.ok, false)

    const ok = validatePublicCatalogueSeasonSelection('season-2026', [active])
    assert.equal(ok.ok, true)
    if (ok.ok) assert.equal(ok.publicCatalogueSeasonId, 'season-2026')
  })

  it('detects dirty selection for save', () => {
    assert.equal(publicCatalogueSelectionIsDirty('season-2026', 'season-2026'), false)
    assert.equal(publicCatalogueSelectionIsDirty('season-2026', 'season-2030'), true)
    assert.equal(publicCatalogueSelectionIsDirty(null, ''), false)
  })

  it('formats display and confirmation copy for public impact', () => {
    assert.equal(formatPublicCatalogueSeasonDisplay(active, active.id), 'Diwali 2026 (2026) · season-2026')
    const message = publicCatalogueSeasonSaveConfirmMessage({
      currentId: 'season-2026',
      nextId: 'season-2030',
      currentLabel: 'Diwali 2026 (2026) · season-2026',
      nextLabel: 'Diwali 2030 (2030) · season-2030',
    })
    assert.match(message, /Products/i)
    assert.match(message, /Family Packs/i)
    assert.match(message, /customer requests/i)
    assert.match(message, /do not change this setting automatically/i)
  })
})
