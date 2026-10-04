import { useEffect } from 'react'
import { getBrandDisplayName } from '../data/siteConfig'

export function usePageTitle(pageTitle) {
  const brand = getBrandDisplayName()

  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} | ${brand}` : brand
  }, [pageTitle, brand])
}
