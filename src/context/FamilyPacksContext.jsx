import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { fetchPublicFamilyPacks } from '../api/publicFamilyPacks.js'
import { setFamilyPackCatalogue } from '../utils/familyPackCatalogue.js'

const FamilyPacksContext = createContext(null)

export function FamilyPacksProvider({ children }) {
  const [familyPacks, setFamilyPacks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await fetchPublicFamilyPacks()
    if (!result.ok) {
      setFamilyPacks([])
      setFamilyPackCatalogue([])
      setError(result.message)
      setLoading(false)
      return
    }
    setFamilyPacks(result.familyPacks)
    setFamilyPackCatalogue(result.familyPacks)
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const value = useMemo(
    () => ({
      familyPacks,
      loading,
      error,
      refresh,
    }),
    [familyPacks, loading, error, refresh],
  )

  return <FamilyPacksContext.Provider value={value}>{children}</FamilyPacksContext.Provider>
}

export function useFamilyPacks() {
  const ctx = useContext(FamilyPacksContext)
  if (!ctx) {
    throw new Error('useFamilyPacks must be used within FamilyPacksProvider')
  }
  return ctx
}
