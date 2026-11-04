import assert from 'node:assert/strict'
import { test } from 'node:test'
import { closeAdminDrawer, dailyAdminLinks, handleAdminDrawerKeyDown, isDrawerBackdropClick, openAdminDrawer, workspaceMenuLinks } from './adminNavigation.js'

const legacy = role => ({ status: 'authenticated', locationModeEnabled: false, activeSeasonId: 'season-2026',
  seasonRole: role, seasonStatus: 'active', memberships: [{ seasonId: 'season-2026', role, status: 'active' }] })

test('daily navigation excludes workspace links even for mixed platform and owner identities', () => {
  const session = { ...legacy('owner'), platformAdmin: true }
  assert.deepEqual(dailyAdminLinks(session).map(link => link.label), ['Quick bill', 'Requests', 'Products', 'Categories', 'Family packs', 'Users'])
  assert.deepEqual(workspaceMenuLinks(session).map(link => link.label), ['Platform administration', 'Owner workspace', 'Stall operations', 'Choose workspace'])
})

test('staff navigation retains operations without exposing owner or platform workspaces', () => {
  const session = legacy('admin')
  assert.equal(dailyAdminLinks(session).some(link => link.to === '/admin/users'), false)
  assert.deepEqual(workspaceMenuLinks(session).map(link => link.to), ['/admin/quick-bill', '/admin/context'])
})

test('platform-only sessions receive workspace switching without operational permissions', () => {
  const session = { status: 'authenticated', locationModeEnabled: true, platformAdmin: true, authorizedLocations: [], capabilities: {} }
  assert.deepEqual(dailyAdminLinks(session), [])
  assert.deepEqual(workspaceMenuLinks(session).map(link => link.to), ['/admin/platform', '/admin/context'])
})

test('lower location role controls navigation; sibling owner access remains in workspace menu', () => {
  const row = (id, role) => ({ location: { id }, business: { id: 'business' }, operatingSeason: { id: 'season-2026' }, effectiveRole: role, capabilities: { read: true, write: true } })
  const session = { locationModeEnabled: true, activeSeasonId: 'season-2026', activeBusinessId: 'business', activeLocationId: 'a',
    effectiveRole: 'admin', capabilities: { read: true, write: true }, authorizedLocations: [row('a', 'admin'), row('b', 'owner')] }
  assert.equal(dailyAdminLinks(session).some(link => link.to === '/admin/users'), false)
  assert.equal(workspaceMenuLinks(session).some(link => link.to === '/admin/business'), true)
})

test('drawer opens as modal, locks scrolling, closes and restores focus and prior scroll style', () => {
  const events = []
  const dialog = { open: false, showModal() { this.open = true; events.push('modal') }, close() { this.open = false; events.push('close') } }
  const body = { style: { overflow: 'auto' } }
  const restore = openAdminDrawer(dialog, body)
  assert.equal(body.style.overflow, 'hidden')
  assert.equal(openAdminDrawer(dialog, body), null)
  closeAdminDrawer(dialog, { focus: () => events.push('focus') })
  restore()
  assert.equal(body.style.overflow, 'auto')
  assert.deepEqual(events, ['modal', 'close', 'focus'])
  closeAdminDrawer(dialog, { focus: () => assert.fail('Closed drawer should not steal focus') })
})

test('only clicks outside the drawer rectangle dismiss the backdrop', () => {
  const dialog = { getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 800 }) }
  assert.equal(isDrawerBackdropClick({ target: dialog, clientX: 350, clientY: 200 }, dialog), true)
  assert.equal(isDrawerBackdropClick({ target: dialog, clientX: 200, clientY: 200 }, dialog), false)
  assert.equal(isDrawerBackdropClick({ target: {}, clientX: 350, clientY: 200 }, dialog), false)
})

test('drawer wraps Tab and Shift+Tab around usable controls without intercepting Escape', () => {
  const document = { activeElement: null }
  const control = overrides => ({ disabled: false, tabIndex: 0, getClientRects: () => [{}],
    focus() { document.activeElement = this }, ...overrides })
  const first = control(), last = control()
  const controls = [control({ disabled: true }), first, control({ getClientRects: () => [] }),
    control({ tabIndex: -1 }), last, control({ disabled: true })]
  const dialog = { open: true, ownerDocument: document, querySelectorAll: () => controls }
  let prevented = 0
  const event = overrides => ({ key: 'Tab', shiftKey: false, preventDefault() { prevented++ }, ...overrides })
  document.activeElement = last
  handleAdminDrawerKeyDown(event(), dialog)
  assert.equal(document.activeElement, first)
  handleAdminDrawerKeyDown(event({ shiftKey: true }), dialog)
  assert.equal(document.activeElement, last)
  assert.equal(prevented, 2)
  document.activeElement = first
  handleAdminDrawerKeyDown(event(), dialog)
  handleAdminDrawerKeyDown(event({ key: 'Escape' }), dialog)
  assert.equal(prevented, 2)
  document.activeElement = null
  handleAdminDrawerKeyDown(event(), dialog)
  assert.equal(document.activeElement, first)
  dialog.open = false
  handleAdminDrawerKeyDown(event({ shiftKey: true }), dialog)
  assert.equal(document.activeElement, first)
})
