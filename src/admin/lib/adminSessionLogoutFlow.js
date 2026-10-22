/**
 * Session poll counter after explicit sign-out.
 * Bumping the poll would immediately re-fetch /api/admin/session, which in local dev
 * can re-authenticate via the Vite proxy's injected dev JWT.
 *
 * @param {number} attempt
 */
export function sessionPollAttemptAfterLogout(attempt) {
  return attempt
}

/**
 * @param {number} attempt
 */
export function sessionPollAttemptAfterRetry(attempt) {
  return attempt + 1
}
