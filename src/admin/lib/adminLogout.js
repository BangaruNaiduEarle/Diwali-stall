/**
 * @param {() => Promise<{ ok: boolean, status?: number, message?: string }>} logoutAdmin
 * @returns {Promise<{ serverConfirmed: boolean, notice: string | null }>}
 */
export async function adminLogoutAttempt(logoutAdmin) {
  const result = await logoutAdmin()
  if (result.ok) {
    return { serverConfirmed: true, notice: null }
  }
  const notice =
    result.status === 0
      ? 'Sign-out could not be confirmed with the server. You have been signed out on this device.'
      : result.message || 'Sign-out may not have completed on the server. You have been signed out on this device.'
  return { serverConfirmed: false, notice }
}
