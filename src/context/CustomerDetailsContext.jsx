import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  emptyCustomerDetails,
  loadCustomerDetailsFromStorage,
  normalizeCustomerDetails,
  saveCustomerDetailsToStorage,
  validateCustomerDetails,
} from '../utils/customerDetailsHelpers'

const CustomerDetailsContext = createContext(null)

const FIELD_KEYS = [
  'name',
  'mobile',
  'area',
  'deliveryAddress',
  'deliveryLandmark',
  'deliveryMapsUrl',
  'pickupDate',
  'note',
]

export function CustomerDetailsProvider({ children }) {
  const [details, setDetailsState] = useState(() => loadCustomerDetailsFromStorage())
  const [touched, setTouched] = useState(false)
  const [fieldTouched, setFieldTouched] = useState({})
  const [requireDeliveryLocation, setRequireDeliveryLocation] = useState(false)

  useEffect(() => {
    saveCustomerDetailsToStorage(details)
  }, [details])

  const setField = useCallback((field, value) => {
    setDetailsState((prev) => normalizeCustomerDetails({ ...prev, [field]: value }))
  }, [])

  const setDetails = useCallback((next) => {
    setTouched(true)
    setDetailsState(normalizeCustomerDetails(next))
  }, [])

  const clearDetails = useCallback(() => {
    setTouched(false)
    setFieldTouched({})
    setDetailsState(emptyCustomerDetails())
  }, [])

  const markTouched = useCallback(() => {
    setTouched(true)
    setFieldTouched(Object.fromEntries(FIELD_KEYS.map((key) => [key, true])))
  }, [])

  const markFieldTouched = useCallback((field) => {
    setFieldTouched((prev) => ({ ...prev, [field]: true }))
  }, [])

  const allErrors = useMemo(
    () => validateCustomerDetails(details, { requireDeliveryLocation }),
    [details, requireDeliveryLocation],
  )

  const errors = useMemo(() => {
    if (touched) return allErrors
    const partial = {}
    for (const [key, message] of Object.entries(allErrors)) {
      if (fieldTouched[key]) partial[key] = message
    }
    return partial
  }, [allErrors, touched, fieldTouched])

  const isValid = useMemo(() => Object.keys(allErrors).length === 0, [allErrors])

  const value = useMemo(
    () => ({
      details,
      errors,
      isValid,
      touched,
      fieldTouched,
      setField,
      setDetails,
      clearDetails,
      markTouched,
      markFieldTouched,
      requireDeliveryLocation,
      setRequireDeliveryLocation,
    }),
    [
      details,
      errors,
      isValid,
      touched,
      fieldTouched,
      setField,
      setDetails,
      clearDetails,
      markTouched,
      markFieldTouched,
      requireDeliveryLocation,
    ],
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
