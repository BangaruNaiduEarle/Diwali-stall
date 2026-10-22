/**
 * Internal login failure classification for server logs only (no secrets).
 * @param {{ rateLimited?: boolean, user?: { passwordHash?: string | null, disabledAt?: string | null } | null, passwordVerified?: boolean }} ctx
 * @returns {'ok' | 'rate_limited' | 'user_not_found' | 'user_disabled' | 'no_password_hash' | 'password_mismatch'}
 */
export function classifyAdminLoginFailure(ctx) {
  if (ctx.rateLimited) return 'rate_limited'
  if (!ctx.user) return 'user_not_found'
  if (ctx.user.disabledAt) return 'user_disabled'
  if (!ctx.user.passwordHash || !String(ctx.user.passwordHash).trim()) return 'no_password_hash'
  if (!ctx.passwordVerified) return 'password_mismatch'
  return 'ok'
}

/**
 * @param {string} reason @param {{ emailNormalized: string, userId?: string | null }} meta
 */
export function logAdminLoginFailure(reason, meta) {
  if (reason === 'ok') return
  console.warn(
    '[admin-login]',
    JSON.stringify({
      outcome: reason,
      email: meta.emailNormalized,
      userId: meta.userId ?? null,
    }),
  )
}
