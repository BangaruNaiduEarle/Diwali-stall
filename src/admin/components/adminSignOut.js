/**
 * @param {{ setNavOpen: (value: boolean) => void }} nav
 */
export function closeMobileNavForSignOut(nav) {
  nav.setNavOpen(false)
}
