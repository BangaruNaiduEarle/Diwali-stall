import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { fetchAdminSession, logoutAdmin } from '../api/adminApi.js'

/** @typedef {'loading' | 'authenticated' | 'denied'} AdminSessionStatus */

/** @typedef {{ status: AdminSessionStatus, email: string | null, role: string | null, error: string | null, errorCode: string | null, httpStatus: number | null, retry: () => void, logout: () => Promise<void> }} AdminSessionValue */

const AdminSessionContext = createContext(/** @type {AdminSessionValue | null} */ (null))

export function AdminSessionProvider({ children }) {
  const [status, setStatus] = useState(/** @type {AdminSessionStatus} */ ('loading'))
  const [email, setEmail] = useState(/** @type {string | null} */ (null))
  const [role, setRole] = useState(/** @type {string | null} */ (null))
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const [errorCode, setErrorCode] = useState(/** @type {string | null} */ (null))
  const [httpStatus, setHttpStatus] = useState(/** @type {number | null} */ (null))
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

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
        setRole(result.role ?? 'admin')
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

  const logout = useCallback(async () => {
    await logoutAdmin()
    setEmail(null)
    setRole(null)
    setStatus('denied')
    setAttempt((n) => n + 1)
  }, [])

  const value = useMemo(
    () => ({ status, email, role, error, errorCode, httpStatus, retry, logout }),
    [status, email, role, error, errorCode, httpStatus, retry, logout],
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
