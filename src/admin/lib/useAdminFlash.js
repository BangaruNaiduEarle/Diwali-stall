import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { readAdminNavigationFlash } from './adminNavigationFlash.js'

/**
 * Shows one-shot navigation flash (e.g. after create) and auto-dismisses page flash.
 */
export function useAdminFlash(autoDismissMs = 8000) {
  const location = useLocation()
  const navigate = useNavigate()
  const [flash, setFlash] = useState(/** @type {{ type: 'success' | 'error', message: string } | null} */ (null))

  useEffect(() => {
    const incoming = readAdminNavigationFlash(location.state)
    if (!incoming) return
    setFlash(incoming)
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: {} })
  }, [location.pathname, location.search, location.state, navigate])

  useEffect(() => {
    if (!flash || !autoDismissMs) return undefined
    const timer = window.setTimeout(() => setFlash(null), autoDismissMs)
    return () => window.clearTimeout(timer)
  }, [flash, autoDismissMs])

  return {
    flash,
    setFlash,
    clearFlash: () => setFlash(null),
  }
}
