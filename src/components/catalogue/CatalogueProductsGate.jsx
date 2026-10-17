import { Loader2, RefreshCw, WifiOff } from 'lucide-react'
import Button from '../ui/Button'

const ICON = { strokeWidth: 1.8 }

/**
 * Loading / error shell while the D1-backed catalogue is fetched.
 * @param {{ loading: boolean, error: string | null, onRetry: () => void, children: import('react').ReactNode, compact?: boolean }} props
 */
export default function CatalogueProductsGate({ loading, error, onRetry, children, compact = false }) {
  if (loading) {
    return (
      <div
        className={`flex flex-col items-center justify-center text-center ${compact ? 'py-10' : 'py-16 sm:py-20'}`}
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-10 w-10 animate-spin text-[var(--color-gold)]" {...ICON} aria-hidden="true" />
        <p className="mt-4 text-sm font-medium text-[var(--color-charcoal)]">Loading catalogue…</p>
        <p className="mt-1 text-xs text-[var(--color-muted)]">Fetching the latest products from our server.</p>
      </div>
    )
  }

  if (error) {
    return (
      <div
        className={`mx-auto max-w-md text-center ${compact ? 'py-10' : 'py-16 sm:py-20'}`}
        role="alert"
      >
        <WifiOff className="mx-auto h-12 w-12 text-[var(--color-gold)]" {...ICON} aria-hidden="true" />
        <h2 className="mt-6 text-lg font-semibold text-[var(--color-charcoal)]">Could not load products</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[var(--color-muted)]">{error}</p>
        <Button type="button" variant="secondary" className="mt-6" icon={RefreshCw} onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  }

  return children
}
