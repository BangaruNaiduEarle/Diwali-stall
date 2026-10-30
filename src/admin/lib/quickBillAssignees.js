import { useEffect, useState } from 'react'
import { fetchAdminUserAssignees } from '../api/adminApi.js'

/** @typedef {{ id: string, email: string, displayName: string | null, role: string }} QuickBillAssignee */

/**
 * @param {boolean} enabled
 */
export function useQuickBillAssignees(enabled) {
  const [users, setUsers] = useState(/** @type {QuickBillAssignee[]} */ ([]))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(/** @type {string | null} */ (null))

  useEffect(() => {
    if (!enabled) {
      setUsers([])
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchAdminUserAssignees().then((res) => {
      if (cancelled) return
      setLoading(false)
      if (!res.ok) {
        setUsers([])
        setError(res.message || 'Could not load assignees.')
        return
      }
      setUsers(
        res.users
          .filter((u) => u && typeof u === 'object')
          .map((u) => ({
            id: String(/** @type {Record<string, unknown>} */ (u).id ?? ''),
            email: String(/** @type {Record<string, unknown>} */ (u).email ?? ''),
            displayName:
              /** @type {Record<string, unknown>} */ (u).displayName != null
                ? String(/** @type {Record<string, unknown>} */ (u).displayName)
                : null,
            role: String(/** @type {Record<string, unknown>} */ (u).role ?? ''),
          }))
          .filter((u) => u.id && u.email),
      )
    })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return { users, loading, error }
}

/** @param {QuickBillAssignee} user */
export function quickBillAssigneeLabel(user) {
  const name = user.displayName?.trim()
  if (name) return `${name} (${user.email})`
  return user.email
}
