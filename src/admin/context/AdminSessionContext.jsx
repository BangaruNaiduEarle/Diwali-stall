import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fetchAdminSession, logoutAdmin } from '../api/adminApi.js'
import { normalizeAdminRole } from '../lib/adminRoles.js'
import { adminLogoutAttempt } from '../lib/adminLogout.js'
import { sessionPollAttemptAfterRetry } from '../lib/adminSessionLogoutFlow.js'

/** @typedef {'loading' | 'authenticated' | 'denied'} AdminSessionStatus */

/** @typedef {{ serverConfirmed: boolean, notice: string | null, skipped?: boolean }} AdminLogoutOutcome */

/** @typedef {{ status: AdminSessionStatus, email: string | null, role: string | null, error: string | null, errorCode: string | null, httpStatus: number | null, retry: () => void, refreshSession: () => Promise<{ ok: boolean }>, logout: () => Promise<AdminLogoutOutcome> }} AdminSessionValue */

const AdminSessionContext = createContext(/** @type {AdminSessionValue | null} */ (null))

export function AdminSessionProvider({ children }) {
  const [status, setStatus] = useState(/** @type {AdminSessionStatus} */ ('loading'))
  const [email, setEmail] = useState(/** @type {string | null} */ (null))
  const [role, setRole] = useState(/** @type {string | null} */ (null))
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const [errorCode, setErrorCode] = useState(/** @type {string | null} */ (null))
  const [httpStatus, setHttpStatus] = useState(/** @type {number | null} */ (null))
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => setAttempt((n) => sessionPollAttemptAfterRetry(n)), [])

  const refreshSession = useCallback(async () => {
    const result = await fetchAdminSession()
    if (result.ok) {
      setEmail(result.email)
      setRole(normalizeAdminRole(result.role))
      setStatus('authenticated')
      setError(null)
      setErrorCode(null)
      setHttpStatus(null)
      return { ok: true }
    }
    setEmail(null)
    setRole(null)
    setStatus('denied')
    setError(result.message)
    setErrorCode(result.error)
    setHttpStatus(result.status)
    return { ok: false }
  }, [])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    setErrorCode(null)
    setHttpStatus(null)

    fetchAdminSession().then((result) => {
      if (cancelled) return
      if (result.ok) {
        setEmail(result.email)
        setRole(normalizeAdminRole(result.role))
        setStatus('authenticated')
        return
      }
      setEmail(null)
      setRole(null)
      setStatus('denied')
      setError(result.message)
      setErrorCode(result.error)
      setHttpStatus(result.status)
    })

    return () => {
      cancelled = true
    }
  }, [attempt])

  const logoutInProgressRef = useRef(false)

  const logout = useCallback(async () => {
    if (logoutInProgressRef.current) {
      return { serverConfirmed: false, notice: null, skipped: true }
    }
    logoutInProgressRef.current = true
    try {
      const outcome = await adminLogoutAttempt(logoutAdmin)
      setEmail(null)
      setRole(null)
      setStatus('denied')
      setError(null)
      setErrorCode(null)
      setHttpStatus(null)
      // Do not bump `attempt` — that re-runs session fetch and can re-authenticate via local dev JWT proxy.
      return outcome
    } finally {
      logoutInProgressRef.current = false
    }
  }, [])

  const value = useMemo(
    () => ({ status, email, role, error, errorCode, httpStatus, retry, refreshSession, logout }),
    [status, email, role, error, errorCode, httpStatus, retry, refreshSession, logout],
  )

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>
}

export function useAdminSession() {
  const ctx = useContext(AdminSessionContext)
  if (!ctx) {
    throw new Error('useAdminSession must be used within AdminSessionProvider')
  }
  return ctx
}
