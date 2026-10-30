import { normalizedProductCompany } from '../lib/adminProductCompanyDisplay.js'

/**
 * @param {{ name: unknown, company?: unknown, nameClassName?: string, companyClassName?: string, className?: string }} props
 */
export default function AdminProductNameWithCompany({
  name,
  company,
  className = '',
  nameClassName = '',
  companyClassName = 'admin-product-name-with-company__company',
}) {
  const displayName = String(name ?? '').trim() || '—'
  const companyLabel = normalizedProductCompany(company)
  const rootClass = className
    ? `admin-product-name-with-company ${className}`
    : 'admin-product-name-with-company'

  return (
    <span className={rootClass}>
      <span className={nameClassName || 'admin-product-name-with-company__name'}>{displayName}</span>
      {companyLabel ? (
        <span className={companyClassName} title={`Company: ${companyLabel}`}>
          {companyLabel}
        </span>
      ) : null}
    </span>
  )
}
