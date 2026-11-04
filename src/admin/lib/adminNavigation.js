import { canAccessOwnerWorkspace, hasWorkspaceCapability } from './adminWorkspaceAccess.js'

export function dailyAdminLinks(session) {
  if (!hasWorkspaceCapability(session, 'read')) return []
  const links = [
    { to: '/admin/quick-bill', label: 'Quick bill' },
    { to: '/admin/customer-requests', label: 'Requests' },
    { to: '/admin/products', label: 'Products' },
    { to: '/admin/categories', label: 'Categories' },
    { to: '/admin/family-packs', label: 'Family packs' },
  ]
  if (hasWorkspaceCapability(session, 'readUsers')) links.push({ to: '/admin/users', label: 'Users' })
  if (session.locationModeEnabled) links.push({to:'/admin/settings',label:'Stall settings'})
  if (session.locationModeEnabled) links.push({to:'/admin/reports',label:'Reports'})
  return links
}

export function workspaceMenuLinks(session) {
  return [
    ...(session.platformAdmin ? [{ to: '/admin/platform', label: 'Platform administration' }] : []),
    ...(canAccessOwnerWorkspace(session) ? [{ to: '/admin/business', label: 'Owner workspace' }] : []),
    ...(hasWorkspaceCapability(session, 'read') ? [{ to: '/admin/quick-bill', label: 'Stall operations' }] : []),
    { to: '/admin/context', label: 'Choose workspace' },
  ]
}

/** Native modal dialogs provide focus containment, Escape handling and inert backgrounds. */
export function openAdminDrawer(dialog, body) {
  if (!dialog || dialog.open) return null
  const previousOverflow = body.style.overflow
  dialog.showModal()
  body.style.overflow = 'hidden'
  return () => { body.style.overflow = previousOverflow }
}

/** Keep Tab within drawer controls instead of moving focus into browser chrome. */
export function handleAdminDrawerKeyDown(event, dialog) {
  if (event.key !== 'Tab' || !dialog?.open) return
  const controls = [...dialog.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
    .filter(control => !control.disabled && control.tabIndex >= 0 && control.getClientRects().length > 0)
  const first = controls[0]
  const last = controls.at(-1)
  const active = dialog.ownerDocument.activeElement
  if (!first) {
    event.preventDefault()
    return
  }
  if (event.shiftKey ? active === first || !controls.includes(active) : active === last || !controls.includes(active)) {
    event.preventDefault()
    const target = event.shiftKey ? last : first
    target.focus()
  }
}

export function closeAdminDrawer(dialog, trigger) {
  if (!dialog?.open) return
  dialog.close()
  trigger?.focus()
}

export function isDrawerBackdropClick(event, dialog) {
  if (event.target !== dialog) return false
  const rect = dialog.getBoundingClientRect()
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom
}
