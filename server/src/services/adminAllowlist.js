/**
 * @param {D1Database} db
 * @param {string} email
 */
export async function isAdminEmailAllowed(db, email) {
  const normalized = String(email ?? '').trim().toLowerCase()
  if (!normalized) return false
  const row = await db
    .prepare('SELECT 1 AS ok FROM admin_users WHERE lower(email) = ? LIMIT 1')
    .bind(normalized)
    .first()
  return Boolean(row?.ok)
}
