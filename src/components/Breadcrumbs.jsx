import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

const ICON = { strokeWidth: 1.8 }

export default function Breadcrumbs({ items, editorial = false, className = '' }) {
  return (
    <nav aria-label="Breadcrumb" className={`mb-8 ${className}`.trim()}>
      <ol
        className={`flex flex-wrap items-center gap-1.5 ${
          editorial ? 'editorial-label text-[var(--color-muted)]' : 'text-sm text-[var(--color-muted)]'
        }`}
      >
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          const label = editorial ? item.label.toUpperCase() : item.label
          return (
            <li key={item.label} className="flex items-center gap-1.5">
              {index > 0 ? (
                <span className={editorial ? 'text-[var(--color-gold)]/50' : ''} aria-hidden="true">
                  {editorial ? '/' : <ChevronRight className="h-3.5 w-3.5 opacity-50" {...ICON} />}
                </span>
              ) : null}
              {isLast || !item.to ? (
                <span
                  className={isLast ? 'font-medium text-[var(--color-ink)]' : undefined}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {label}
                </span>
              ) : (
                <Link to={item.to} className="focus-ring transition-ui hover:text-[var(--color-gold)]">
                  {label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
