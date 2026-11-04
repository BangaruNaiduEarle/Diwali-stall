import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  clearAdminActiveSeasonId,
  getAdminActiveSeasonId,
  setAdminActiveSeasonId,
  setAdminLocationSelection,
  setAdminContextSwitching,
  getAdminRequestContext,
} from '../api/adminSeasonRequest.js'
import { fetchAdminSession, logoutAdmin } from '../api/adminApi.js'
import { normalizeAdminRole } from '../lib/adminRoles.js'
import { adminLogoutAttempt } from '../lib/adminLogout.js'
import { performAdminSeasonSwitch } from '../lib/adminSeasonSelector.js'
import { sessionPollAttemptAfterRetry } from '../lib/adminSessionLogoutFlow.js'
import { adminOperationalContextKey } from '../lib/adminSeasonSession.js'
import { openOfflineStorage } from '../offline/storage.js'

/** @typedef {'loading' | 'authenticated' | 'denied'} AdminSessionStatus */

/** @typedef {{ serverConfirmed: boolean, notice: string | null, skipped?: boolean }} AdminLogoutOutcome */

/** @typedef {import('../lib/adminSeasonSession.js').AdminSeasonMembership} AdminSeasonMembership */

/** @typedef {{ status: AdminSessionStatus, email: string | null, role: string | null, platformAdmin: boolean, activeSeasonId: string | null, seasonRole: string | null, seasonStatus: string | null, memberships: AdminSeasonMembership[], seasonSwitching: boolean, error: string | null, errorCode: string | null, httpStatus: number | null, retry: () => void, refreshSession: () => Promise<{ ok: boolean }>, selectActiveSeason: (seasonId: string) => Promise<{ ok: boolean, message?: string, code?: string }>, logout: () => Promise<AdminLogoutOutcome> }} AdminSessionValue */

/** @typedef {{ locationModeEnabled: boolean, authorizedLocations: object[], activeBusinessId: string | null,
 * activeLocationId: string | null, business: object | null, location: object | null, association: object | null,
 * effectiveRole: string | null, locationRole: string | null, capabilities: object, locationSelectionRequired: boolean,
 * permissionRole: string | null, contextKey: string, selectActiveLocation: (locationId: string) => Promise<{ ok: boolean, message?: string }> }} AdminLocationSessionValue */
const AdminSessionContext = createContext(/** @type {(AdminSessionValue & AdminLocationSessionValue) | null} */ (null))

export function AdminSessionProvider({ children }) {
  const [status, setStatus] = useState(/** @type {AdminSessionStatus} */ ('loading'))
  const [email, setEmail] = useState(/** @type {string | null} */ (null))
  const [userId, setUserId] = useState(null)
  const [role, setRole] = useState(/** @type {string | null} */ (null))
  const [platformAdmin, setPlatformAdmin] = useState(false)
  const [activeSeasonId, setActiveSeasonId] = useState(/** @type {string | null} */ (null))
  const [seasonRole, setSeasonRole] = useState(/** @type {string | null} */ (null))
  const [seasonStatus, setSeasonStatus] = useState(/** @type {string | null} */ (null))
  const [memberships, setMemberships] = useState(/** @type {AdminSeasonMembership[]} */ ([]))
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const [errorCode, setErrorCode] = useState(/** @type {string | null} */ (null))
  const [httpStatus, setHttpStatus] = useState(/** @type {number | null} */ (null))
  const [attempt, setAttempt] = useState(0)
  const [seasonSwitching, setSeasonSwitching] = useState(false)
  const [locationSession, setLocationSession] = useState({ locationModeEnabled: false, authorizedLocations: [],
    activeLocationId: null, activeBusinessId: null, business: null, location: null, association: null,
    effectiveRole: null, locationRole: null, capabilities: {}, locationSelectionRequired: false })
  const locationSessionRef = useRef(locationSession)
  const switchingRef = useRef(false)
  const membershipsRef = useRef(memberships)
  const platformAdminRef = useRef(platformAdmin)
  /** Monotonic guard: stale in-flight session fetches must not call applySessionFields after a season switch. */
  const sessionFetchGenerationRef = useRef(0)

  const isSessionFetchGenerationCurrent = useCallback(
    (capturedGeneration) => capturedGeneration === sessionFetchGenerationRef.current,
    [],
  )

  const invalidateSessionFetches = useCallback(() => {
    sessionFetchGenerationRef.current += 1
    return sessionFetchGenerationRef.current
  }, [])

  const retry = useCallback(() => setAttempt((n) => sessionPollAttemptAfterRetry(n)), [])

  const applySessionFields = useCallback((result) => {
    setEmail(result.email)
    setUserId(result.userId ?? null)
    setRole(normalizeAdminRole(result.role))
    setPlatformAdmin(Boolean(result.platformAdmin))
    setActiveSeasonId(result.activeSeasonId)
    setSeasonRole(result.seasonRole)
    setSeasonStatus(result.seasonStatus)
    setMemberships(result.memberships)
    membershipsRef.current = result.memberships
    platformAdminRef.current = Boolean(result.platformAdmin)
    setAdminActiveSeasonId(result.activeSeasonId)
    const next = Object.fromEntries(['locationModeEnabled', 'authorizedLocations', 'activeLocationId', 'activeBusinessId',
      'business', 'location', 'association', 'effectiveRole', 'locationRole', 'capabilities', 'locationSelectionRequired']
      .map(key => [key, result[key]]))
    locationSessionRef.current = next
    setLocationSession(next)
    setAdminLocationSelection(result)
  }, [])

  const clearSessionFields = useCallback(() => {
    setEmail(null)
    setUserId(null)
    setRole(null)
    setPlatformAdmin(false)
    setActiveSeasonId(null)
    setSeasonRole(null)
    setSeasonStatus(null)
    setMemberships([])
    membershipsRef.current = []
    platformAdminRef.current = false
    const empty = { locationModeEnabled: false, authorizedLocations: [], activeLocationId: null, activeBusinessId: null,
      business: null, location: null, association: null, effectiveRole: null, locationRole: null, capabilities: {}, locationSelectionRequired: false }
    locationSessionRef.current = empty
    setLocationSession(empty)
    clearAdminActiveSeasonId()
  }, [])

  const refreshSession = useCallback(async () => {
    if (switchingRef.current) return { ok: false }
    const fetchGeneration = sessionFetchGenerationRef.current
    const result = await fetchAdminSession()
    if (!isSessionFetchGenerationCurrent(fetchGeneration)) {
      return { ok: false }
    }
    if (result.ok) {
      applySessionFields(result)
      setStatus('authenticated')
      setError(null)
      setErrorCode(null)
      setHttpStatus(null)
      return { ok: true }
    }
    clearSessionFields()
    setStatus('denied')
    setError(result.message)
    setErrorCode(result.error)
    setHttpStatus(result.status)
    return { ok: false }
  }, [applySessionFields, clearSessionFields, isSessionFetchGenerationCurrent])

  const selectContext = useCallback(
    async (seasonId, locationId) => {
      if (switchingRef.current) return { ok: false, message: 'A context switch is already in progress.' }
      switchingRef.current = true
      const switchGeneration = invalidateSessionFetches()
      setSeasonSwitching(true)
      const previous = getAdminRequestContext()
      setAdminContextSwitching(true)
      try {
        const outcome = await performAdminSeasonSwitch({
          seasonId,
          locationId,
          locationModeEnabled: locationSessionRef.current.locationModeEnabled,
          authorizedLocations: locationSessionRef.current.authorizedLocations,
          previousLocationId: previous.activeLocationId,
          previousBusinessId: previous.activeBusinessId,
          memberships: membershipsRef.current,
          platformAdmin: platformAdminRef.current,
          previousSeasonId: getAdminActiveSeasonId(),
          fetchSession: fetchAdminSession,
          setSeasonHeader: setAdminActiveSeasonId,
          setLocationHeader: setAdminLocationSelection,
          isCurrent: () => isSessionFetchGenerationCurrent(switchGeneration),
        })
        if (!isSessionFetchGenerationCurrent(switchGeneration)) return { ok: false, code: 'stale_context' }

        if (outcome.ok) {
          if (outcome.session && isSessionFetchGenerationCurrent(switchGeneration)) {
            applySessionFields(outcome.session)
          }
          return { ok: true }
        }

        if (
          'restoredSession' in outcome &&
          outcome.restoredSession &&
          isSessionFetchGenerationCurrent(switchGeneration)
        ) {
          applySessionFields(outcome.restoredSession)
        } else if (outcome.attempted) {
          clearSessionFields()
          setStatus('denied')
          setError('The previous stall could not be verified. Sign in again to continue.')
        }

        return {
          ok: false,
          code: 'code' in outcome ? outcome.code : 'season_switch_denied',
          message: 'message' in outcome ? outcome.message : 'Could not switch season.',
        }
      } catch {
        if (isSessionFetchGenerationCurrent(switchGeneration)) {
          clearSessionFields()
          setStatus('denied')
          setError('The selected context could not be verified. Sign in again to continue.')
        }
        return { ok: false, message: 'Could not verify the selected context.' }
      } finally {
        switchingRef.current = false
        setAdminContextSwitching(false)
        setSeasonSwitching(false)
      }
    },
    [applySessionFields, clearSessionFields, invalidateSessionFetches, isSessionFetchGenerationCurrent],
  )
  const selectActiveSeason = useCallback(seasonId => selectContext(seasonId), [selectContext])
  const selectActiveLocation = useCallback(locationId => selectContext(getAdminActiveSeasonId(), locationId), [selectContext])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    setErrorCode(null)
    setHttpStatus(null)

    const fetchGeneration = sessionFetchGenerationRef.current
    fetchAdminSession().then((result) => {
      if (cancelled) return
      if (!isSessionFetchGenerationCurrent(fetchGeneration)) return
      if (result.ok) {
        applySessionFields(result)
        setStatus('authenticated')
        return
      }
      clearSessionFields()
      setStatus('denied')
      setError(result.message)
      setErrorCode(result.error)
      setHttpStatus(result.status)
    })

    return () => {
      cancelled = true
    }
  }, [attempt, applySessionFields, clearSessionFields, isSessionFetchGenerationCurrent])

  const logoutInProgressRef = useRef(false)

  const logout = useCallback(async () => {
    if (logoutInProgressRef.current) {
      return { serverConfirmed: false, notice: null, skipped: true }
    }
    logoutInProgressRef.current = true
    invalidateSessionFetches()
    setAdminContextSwitching(true)
    try {
      const outcome = await adminLogoutAttempt(logoutAdmin)
      // Keep unsynchronized records, but remove automatic local workspace access.
      try { const offline = await openOfflineStorage(); await offline.clearActiveProfile(); offline.close() } catch { /* Logout must still complete if storage is unavailable. */ }
      clearSessionFields()
      setStatus('denied')
      setError(null)
      setErrorCode(null)
      setHttpStatus(null)
      // Do not bump `attempt` — that re-runs session fetch and can re-authenticate via local dev JWT proxy.
      return outcome
    } finally {
      logoutInProgressRef.current = false
    }
  }, [clearSessionFields, invalidateSessionFetches])

  const value = useMemo(
    () => ({
      status,
      email,
      userId,
      role,
      platformAdmin,
      activeSeasonId,
      seasonRole,
      seasonStatus,
      memberships,
      seasonSwitching,
      error,
      errorCode,
      httpStatus,
      retry,
      refreshSession,
      selectActiveSeason,
      logout,
      ...locationSession,
      permissionRole: locationSession.locationModeEnabled ? locationSession.effectiveRole : seasonRole,
      contextKey: adminOperationalContextKey({ ...locationSession, email, activeSeasonId }),
      selectActiveLocation,
    }),
    [
      status,
      email,
      userId,
      role,
      platformAdmin,
      activeSeasonId,
      seasonRole,
      seasonStatus,
      memberships,
      seasonSwitching,
      error,
      errorCode,
      httpStatus,
      retry,
      refreshSession,
      selectActiveSeason,
      logout,
      locationSession,
      selectActiveLocation,
    ],
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
