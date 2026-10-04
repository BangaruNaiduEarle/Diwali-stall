import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  emptyCustomerDetails,
  loadCustomerDetailsFromStorage,
  normalizeCustomerDetails,
  saveCustomerDetailsToStorage,
  validateCustomerDetails,
} from '../utils/customerDetailsHelpers'

const CustomerDetailsContext = createContext(null)

export function CustomerDetailsProvider({ children }) {
  const [details, setDetailsState] = useState(() => loadCustomerDetailsFromStorage())
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    saveCustomerDetailsToStorage(details)
  }, [details])

  const setField = useCallback((field, value) => {
    setTouched(true)
    setDetailsState((prev) => normalizeCustomerDetails({ ...prev, [field]: value }))
  }, [])

  const setDetails = useCallback((next) => {
    setTouched(true)
    setDetailsState(normalizeCustomerDetails(next))
  }, [])

  const clearDetails = useCallback(() => {
    setTouched(false)
    setDetailsState(emptyCustomerDetails())
  }, [])

  const errors = useMemo(() => (touched ? validateCustomerDetails(details) : {}), [details, touched])
  const isValid = useMemo(() => Object.keys(validateCustomerDetails(details)).length === 0, [details])

  const value = useMemo(
    () => ({
      details,
      errors,
      isValid,
      touched,
      setField,
      setDetails,
      clearDetails,
      markTouched: () => setTouched(true),
    }),
    [details, errors, isValid, touched, setField, setDetails, clearDetails],
  )

  return (
    <CustomerDetailsContext.Provider value={value}>{children}</CustomerDetailsContext.Provider>
  )
}

export function useCustomerDetails() {
  const ctx = useContext(CustomerDetailsContext)
  if (!ctx) {
    throw new Error('useCustomerDetails must be used within CustomerDetailsProvider')
  }
  return ctx
}
