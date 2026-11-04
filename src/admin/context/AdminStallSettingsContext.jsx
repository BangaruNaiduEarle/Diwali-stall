import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useAdminSession } from './AdminSessionContext.jsx'
import { fetchStallSettings, patchStallSettings } from '../api/adminStallSettings.js'
import { createStallSettingsStore } from '../lib/stallSettings.js'
import { hasWorkspaceCapability } from '../lib/adminWorkspaceAccess.js'

const Context = createContext(null)
export function AdminStallSettingsProvider({children}) {
  const session = useAdminSession()
  const [store] = useState(() => createStallSettingsStore({load:fetchStallSettings,save:patchStallSettings}))
  const snapshot = useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot)
  const enabled = session.status === 'authenticated' && session.locationModeEnabled && !session.seasonSwitching && hasWorkspaceCapability(session,'read')
  const legacy = !session.locationModeEnabled
  const key = JSON.stringify([session.status,session.contextKey,session.locationModeEnabled,session.seasonSwitching,enabled])
  const scope = useMemo(() => ({key,legacy,enabled}),[key,legacy,enabled])
  useEffect(() => {store.setContext(scope);return () => store.invalidate()},[store,scope])
  // Hide the old scope during the render BEFORE effects process a switch.
  const current = snapshot.key === key ? snapshot : {key,status:scope.enabled?'loading':scope.legacy?'legacy':'idle',settings:null,error:null,blocked:false,conflict:false}
  const value = {...current,reload:store.reload,save:store.save,displaySettings:current.blocked ? null : current.settings}
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export const useOptionalStallSettings = () => useContext(Context)
export function useStallSettings() {
  const value = useOptionalStallSettings()
  if (!value) throw Error('Stall settings provider is required.')
  return value
}
